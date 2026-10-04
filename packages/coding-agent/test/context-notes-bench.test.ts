import { describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import {
	CONTEXT_NOTES_ENTRY_TYPE,
	getContextNotes,
	MAX_CONTEXT_NOTES_BYTES,
	renderContextNotes,
} from "../src/session/context-notes";
import type { ContextNotesEntry } from "../src/session/context-notes";
import { buildSessionContext } from "../src/session/session-context";
import type { CustomEntry, ResetBoundaryEntry, SessionEntry } from "../src/session/session-entries";
import { SessionManager } from "../src/session/session-manager";
import { ContextNotesTool, NewContextTool } from "../src/tools/context-notes";
import type { ToolSession } from "../src/tools/index";
import { TempDir } from "@oh-my-pi/pi-utils";

import { cfgCompactionExperimentalContextManagement } from "../src/session/context-settings";

const NOW = "2026-09-04T00:00:00.000Z";

function noteEntry(id: string, parentId: string | null, text: string): CustomEntry<ContextNotesEntry> {
	return {
		type: "custom",
		customType: CONTEXT_NOTES_ENTRY_TYPE,
		data: { version: 1, text },
		id,
		parentId,
		timestamp: NOW,
	};
}

function resetEntry(id: string, parentId: string | null): ResetBoundaryEntry {
	return { type: "reset_boundary", id, parentId, timestamp: NOW };
}

function toolSession(
	settings: Settings,
	sessionManager: SessionManager,
	ownerId = sessionManager.getSessionId(),
): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings,
		getSessionFile: () => sessionManager.getSessionFile() ?? null,
		getSessionId: () => ownerId,
		getSessionSpawns: () => null,
		sessionManager,
	};
}

describe("experimental context notes", () => {
	it("retains active-branch source references across resume and rejects foreign entry IDs", async () => {
		using tempDir = TempDir.createSync("@omp-context-notes-sources-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		const manager = SessionManager.create(tempDir.path(), sessionDir);
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const sourceId = manager.appendMessage({ role: "user", content: "Preserve API compatibility", timestamp: 1 });
		await expect(
			tool.execute("foreign", { text: "API must stay compatible", sourceEntryIds: ["other-branch"] }),
		).rejects.toThrow("not on the active session branch");
		await expect(
			tool.execute("duplicate", { text: "API must stay compatible", sourceEntryIds: [sourceId, sourceId] }),
		).rejects.toThrow("distinct active-branch entry IDs");
		await expect(
			tool.execute("unsafe-link", { text: "API must stay compatible", sourceEntryIds: ["`unsafe`"] }),
		).rejects.toThrow("distinct active-branch entry IDs");
		const saved = await tool.execute("sourced", { text: "API must stay compatible", sourceEntryIds: [sourceId] });
		expect(saved.details?.sourceEntryIds).toEqual([sourceId]);
		const read = await tool.execute("read-sourced", {});
		expect(read.content).toMatchObject([{ type: "text", text: expect.stringContaining(sourceId) }]);
		await expect(tool.execute("clear-with-sources", { text: "", sourceEntryIds: [sourceId] })).rejects.toThrow(
			"cannot retain source entry IDs",
		);
		const file = manager.getSessionFile();
		if (!file) throw new Error("expected persisted session file");
		const reopened = await SessionManager.open(file, sessionDir);
		try {
			expect(getContextNotes(reopened.getBranch())).toMatchObject({
				text: "API must stay compatible",
				sourceEntryIds: [sourceId],
			});
			expect(renderContextNotes(reopened.getBranch())).toContain(sourceId);
		} finally {
			await reopened.close();
			await manager.close();
		}
	});
	it("rejects an oversized UTF-8 replacement while retaining the current notebook revision", async () => {
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const session = toolSession(settings, sessionManager);
		const tool = ContextNotesTool.createIf(session);
		if (!tool) throw new Error("expected context notes tool");

		await tool.execute("initial", { text: "Retain this notebook after an invalid replacement." });
		const multibyteCharacter = "€";
		const oversized = multibyteCharacter.repeat(
			Math.floor(MAX_CONTEXT_NOTES_BYTES / Buffer.byteLength(multibyteCharacter, "utf8")) + 1,
		);
		await expect(tool.execute("overflow", { text: oversized })).rejects.toThrow(
			`${MAX_CONTEXT_NOTES_BYTES} UTF-8 bytes`,
		);
		expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(MAX_CONTEXT_NOTES_BYTES);
		expect(getContextNotes(sessionManager.getBranch())?.text).toBe(
			"Retain this notebook after an invalid replacement.",
		);
		expect(
			sessionManager
				.getBranch()
				.filter(entry => entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE),
		).toHaveLength(1);
	});

	it("bounds the rendered notebook against the active model window", async () => {
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("expected bundled model");
		let activeModel = { ...bundled, contextWindow: 8_192 };
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const session = { ...toolSession(settings, sessionManager), getActiveModel: () => activeModel };
		const tool = ContextNotesTool.createIf(session);
		if (!tool) throw new Error("expected context notes tool");
		await tool.execute("initial", { text: "Keep the current objective." });

		const candidate = Array.from({ length: 800 }, (_, index) => `finding-${index.toString(36)}`).join(" ");
		expect(Buffer.byteLength(candidate, "utf8")).toBeLessThan(MAX_CONTEXT_NOTES_BYTES);
		await expect(tool.execute("small-window", { text: candidate })).rejects.toThrow("notebook limit");
		await expect(
			tool.execute("small-window-findings", {
				findings: [{ text: candidate, retention: "pinned" }],
			}),
		).rejects.toThrow("notebook limit");
		expect(getContextNotes(sessionManager.getBranch())?.text).toBe("Keep the current objective.");

		activeModel = { ...bundled, contextWindow: 128_000 };
		await tool.execute("larger-window", { text: candidate });
		expect(getContextNotes(sessionManager.getBranch())?.text).toBe(candidate);
	});

	it("expires window-scoped notes at compaction without restoring an older pinned revision", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const sourceId = manager.appendMessage({ role: "user", content: "Investigate the failing build", timestamp: 1 });
		await tool.execute("pinned", { text: "Keep the build objective." });
		await tool.execute("temporary", {
			text: "Hypothesis: stale build cache",
			retention: "window",
			sourceEntryIds: [sourceId],
		});
		expect(getContextNotes(manager.getBranch())).toMatchObject({ retention: "window", sourceEntryIds: [sourceId] });
		expect(renderContextNotes(manager.getBranch())).toContain("Hypothesis: stale build cache");
		expect(
			buildSessionContext(manager.getBranch()).messages.some(
				message =>
					message.role === "custom" &&
					typeof message.content === "string" &&
					message.content.includes("Hypothesis: stale build cache"),
			),
		).toBe(true);

		manager.appendCompaction("Earlier investigation summarized", undefined, sourceId, 100);
		expect(getContextNotes(manager.getBranch())).toBeUndefined();
		expect(renderContextNotes(manager.getBranch())).toBe("");
		expect(
			buildSessionContext(manager.getBranch()).messages.some(
				message =>
					message.role === "custom" &&
					typeof message.content === "string" &&
					message.content.includes("Hypothesis: stale build cache"),
			),
		).toBe(false);
		expect((await tool.execute("read-expired", {})).details?.text).toBe("");

		await tool.execute("new-pinned", { text: "The build objective remains active." });
		manager.appendCompaction("Later work summarized", undefined, sourceId, 100);
		expect(getContextNotes(manager.getBranch())?.text).toBe("The build objective remains active.");
	});

	it("retains window-scoped expiry after resuming a session", async () => {
		using tempDir = TempDir.createSync("@omp-context-notes-window-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		const manager = SessionManager.create(tempDir.path(), sessionDir);
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const sourceId = manager.appendMessage({ role: "user", content: "Check the build", timestamp: 1 });
		await tool.execute("temporary", { text: "Try a clean rebuild", retention: "window", sourceEntryIds: [sourceId] });
		const file = manager.getSessionFile();
		if (!file) throw new Error("expected persisted session file");
		const reopened = await SessionManager.open(file, sessionDir);
		try {
			expect(getContextNotes(reopened.getBranch())).toMatchObject({
				text: "Try a clean rebuild",
				retention: "window",
				sourceEntryIds: [sourceId],
			});
			reopened.appendCompaction("Build investigation summarized", undefined, sourceId, 100);
			expect(getContextNotes(reopened.getBranch())).toBeUndefined();
		} finally {
			await reopened.close();
			await manager.close();
		}
	});

	it("retains pinned findings while expiring window findings in rebuilt context", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const sourceId = manager.appendMessage({ role: "user", content: "Keep the public API stable", timestamp: 1 });
		await expect(
			tool.execute("foreign-finding", {
				findings: [{ text: "Unsupported claim", retention: "pinned", sourceEntryIds: ["other-branch"] }],
			}),
		).rejects.toThrow("not on the active session branch");
		await tool.execute("findings", {
			findings: [
				{ text: "Preserve the public API", retention: "pinned", sourceEntryIds: [sourceId] },
				{ text: "Suspect a stale generated file", retention: "window" },
			],
		});
		const before = renderContextNotes(manager.getBranch());
		expect(before).toContain("Preserve the public API");
		expect(before).toContain("Suspect a stale generated file");
		expect(before).toContain(`history://current/entry/${sourceId}`);
		expect((await tool.execute("read-findings", {})).details?.findings).toHaveLength(2);

		manager.appendCompaction("Investigation summarized", undefined, sourceId, 100);
		const after = renderContextNotes(manager.getBranch());
		expect(after).toContain("Preserve the public API");
		expect(after).not.toContain("Suspect a stale generated file");
		expect(getContextNotes(manager.getBranch())?.findings).toHaveLength(1);
		expect((await tool.execute("read-after-compaction", {})).details?.findings).toHaveLength(1);
		expect(
			buildSessionContext(manager.getBranch()).messages.some(
				message =>
					message.role === "custom" &&
					typeof message.content === "string" &&
					message.content.includes("Suspect a stale generated file"),
			),
		).toBe(false);
	});

	it("puts findings backed by the current user turn first without removing older findings", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const earlier = manager.appendMessage({ role: "user", content: "Keep the public API stable", timestamp: 1 });
		const current = manager.appendMessage({ role: "user", content: "Investigate the parser", timestamp: 2 });
		await tool.execute("findings", {
			findings: [
				{ text: "Public API must remain stable", retention: "pinned", sourceEntryIds: [earlier] },
				{ text: "Parser rejects the new syntax", retention: "pinned", sourceEntryIds: [current] },
			],
		});
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Parser rejects the new syntax")).toBeLessThan(
			rendered.indexOf("Public API must remain stable"),
		);
		expect(
			buildSessionContext(manager.getBranch()).messages.find(
				message => message.role === "custom" && message.customType === CONTEXT_NOTES_ENTRY_TYPE,
			),
		).toMatchObject({ content: rendered });
		expect(rendered).toContain(`history://current/entry/${earlier}`);
		expect(rendered).toContain(`history://current/entry/${current}`);
		manager.appendMessage({ role: "user", content: "Review the result", timestamp: 3 });
		const nextTurn = renderContextNotes(manager.getBranch());
		expect(nextTurn.indexOf("Public API must remain stable")).toBeLessThan(
			nextTurn.indexOf("Parser rejects the new syntax"),
		);
	});

	it("matches task terms against cited successful tool evidence", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Explore the repository", timestamp: 1 });
		const cacheSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-cache",
			toolName: "read",
			content: [{ type: "text", text: "The stale cache invalidates generated manifests." }],
			isError: false,
			timestamp: 2,
		});
		const apiSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-api",
			toolName: "read",
			content: [{ type: "text", text: "The public API requires stable compatibility." }],
			isError: false,
			timestamp: 3,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "Preserve this finding", retention: "pinned", sourceEntryIds: [apiSource] },
				{ text: "Preserve this other finding", retention: "pinned", sourceEntryIds: [cacheSource] },
			],
		});
		manager.appendMessage({ role: "user", content: "Fix the stale cache manifest", timestamp: 4 });
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Preserve this other finding")).toBeLessThan(rendered.indexOf("Preserve this finding"));
	});

	it("uses valid task prerequisites to carry relevance into dependent assignments", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Plan the data migration", timestamp: 1 });
		manager.appendMessage({
			role: "assistant",
			api: "openai-completions",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "task-batch",
					name: "task",
					arguments: {
						context: "Roll out the migration safely.",
						tasks: [
							{ name: "InspectSchema", task: "Inspect database schema constraints before implementation." },
							{
								name: "Migration",
								task: "Implement migration rollout after schema review.",
								dependsOn: ["InspectSchema"],
							},
						],
					},
				},
			],
			timestamp: 2,
		});
		const unrelatedSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "api-notes",
			toolName: "read",
			content: [{ type: "text", text: "Public API compatibility requires preserving the old response envelope." }],
			isError: false,
			timestamp: 3,
		});
		const dependentSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "migration-notes",
			toolName: "read",
			content: [{ type: "text", text: "Migration rollout must preserve existing rows and support safe retries." }],
			isError: false,
			timestamp: 4,
		});
		await tool.execute("dependency-findings", {
			findings: [
				{ text: "Keep the API response contract", retention: "pinned", sourceEntryIds: [unrelatedSource] },
				{
					text: "Preserve the migration rollout constraints",
					retention: "pinned",
					sourceEntryIds: [dependentSource],
				},
			],
		});
		manager.appendMessage({ role: "user", content: "Continue database schema checks", timestamp: 5 });
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Preserve the migration rollout constraints")).toBeLessThan(
			rendered.indexOf("Keep the API response contract"),
		);
		manager.appendMessage({
			role: "assistant",
			api: "openai-completions",
			provider: "openai",
			model: "gpt-test",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "invalid-task-graph",
					name: "task",
					arguments: {
						tasks: [
							{ name: "InspectSchema", task: "Inspect database schema constraints.", dependsOn: ["Migration"] },
							{ name: "Migration", task: "Implement migration rollout.", dependsOn: ["InspectSchema"] },
						],
					},
				},
			],
			timestamp: 6,
		});
		const invalidGraph = renderContextNotes(manager.getBranch());
		expect(invalidGraph.indexOf("Keep the API response contract")).toBeLessThan(
			invalidGraph.indexOf("Preserve the migration rollout constraints"),
		);
	});

	it("does not use failed tool output as notebook relevance evidence", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Inspect the project", timestamp: 1 });
		const successfulSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-api",
			toolName: "read",
			content: [{ type: "text", text: "The public API requires stable compatibility." }],
			isError: false,
			timestamp: 2,
		});
		const failedSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-failed",
			toolName: "read",
			content: [{ type: "text", text: "The stale cache invalidates generated manifests." }],
			isError: true,
			timestamp: 3,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "Preserve this finding", retention: "pinned", sourceEntryIds: [successfulSource] },
				{ text: "Preserve this other finding", retention: "pinned", sourceEntryIds: [failedSource] },
			],
		});
		manager.appendMessage({ role: "user", content: "Fix the stale cache manifest", timestamp: 4 });
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Preserve this finding")).toBeLessThan(rendered.indexOf("Preserve this other finding"));
	});

	it("decays task-term relevance with age when both findings match", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Investigate project behavior", timestamp: 1 });
		const olderSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-old",
			toolName: "read",
			content: [{ type: "text", text: "Cache invalidation behavior is documented here." }],
			isError: false,
			timestamp: 2,
		});
		manager.appendMessage({ role: "user", content: "Continue the investigation", timestamp: 3 });
		const newerSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-new",
			toolName: "read",
			content: [{ type: "text", text: "Cache invalidation behavior is implemented here." }],
			isError: false,
			timestamp: 4,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "Older finding", retention: "pinned", sourceEntryIds: [olderSource] },
				{ text: "Newer finding", retention: "pinned", sourceEntryIds: [newerSource] },
			],
		});
		manager.appendMessage({ role: "user", content: "Investigate cache invalidation behavior", timestamp: 5 });
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Newer finding")).toBeLessThan(rendered.indexOf("Older finding"));
	});

	it("prioritizes a sourced finding when the current turn edits the same file", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Inspect the project", timestamp: 1 });
		const otherSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-other",
			toolName: "read",
			content: [{ type: "text", text: "other source" }],
			details: { resolvedPath: "/project/other.ts" },
			isError: false,
			timestamp: 2,
		});
		const parserSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-parser",
			toolName: "read",
			content: [{ type: "text", text: "parser source" }],
			details: { resolvedPath: "/project/parser.ts" },
			isError: false,
			timestamp: 3,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "Other file has an invariant", retention: "pinned", sourceEntryIds: [otherSource] },
				{ text: "Parser needs a syntax fix", retention: "pinned", sourceEntryIds: [parserSource] },
			],
		});
		manager.appendMessage({ role: "user", content: "Fix the parser", timestamp: 4 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "edit-parser",
			toolName: "edit",
			content: [{ type: "text", text: "changed parser" }],
			details: { perFileResults: [{ path: "/project/parser.ts" }, { path: "/project/irrelevant.ts" }] },
			isError: false,
			timestamp: 5,
		});
		const rendered = renderContextNotes(manager.getBranch());
		expect(rendered.indexOf("Parser needs a syntax fix")).toBeLessThan(
			rendered.indexOf("Other file has an invariant"),
		);
		manager.appendMessage({ role: "user", content: "Review the outcome", timestamp: 6 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "failed-edit",
			toolName: "edit",
			content: [{ type: "text", text: "failed" }],
			details: { path: "/project/parser.ts" },
			isError: true,
			timestamp: 7,
		});
		const nextTurn = renderContextNotes(manager.getBranch());
		expect(nextTurn.indexOf("Other file has an invariant")).toBeLessThan(
			nextTurn.indexOf("Parser needs a syntax fix"),
		);
	});

	it("uses an unambiguous user file mention to prioritize a sourced finding", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Inspect both parsers", timestamp: 1 });
		const otherSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-b",
			toolName: "read",
			content: [{ type: "text", text: "B source" }],
			details: { resolvedPath: "/project/b/parser.ts" },
			isError: false,
			timestamp: 2,
		});
		const targetSource = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-a",
			toolName: "read",
			content: [{ type: "text", text: "A source" }],
			details: { resolvedPath: "/project/a/parser.ts" },
			isError: false,
			timestamp: 3,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "Parser B handles old syntax", retention: "pinned", sourceEntryIds: [otherSource] },
				{ text: "Parser A needs a fix", retention: "pinned", sourceEntryIds: [targetSource] },
			],
		});
		manager.appendMessage({ role: "user", content: "Fix @a/parser.ts", timestamp: 4 });
		const matched = renderContextNotes(manager.getBranch());
		expect(matched.indexOf("Parser A needs a fix")).toBeLessThan(matched.indexOf("Parser B handles old syntax"));
		manager.appendMessage({ role: "user", content: "Review @parser.ts", timestamp: 5 });
		const ambiguous = renderContextNotes(manager.getBranch());
		expect(ambiguous.indexOf("Parser B handles old syntax")).toBeLessThan(ambiguous.indexOf("Parser A needs a fix"));
	});

	it("follows the active todo's explicit file reference as work advances", async () => {
		const manager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		manager.appendMessage({ role: "user", content: "Work through both files", timestamp: 1 });
		const sourceA = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-a",
			toolName: "read",
			content: [{ type: "text", text: "A source" }],
			details: { resolvedPath: "/project/a.ts" },
			isError: false,
			timestamp: 2,
		});
		const sourceB = manager.appendMessage({
			role: "toolResult",
			toolCallId: "read-b",
			toolName: "read",
			content: [{ type: "text", text: "B source" }],
			details: { resolvedPath: "/project/b.ts" },
			isError: false,
			timestamp: 3,
		});
		await tool.execute("findings", {
			findings: [
				{ text: "A has an invariant", retention: "pinned", sourceEntryIds: [sourceA] },
				{ text: "B needs a parser fix", retention: "pinned", sourceEntryIds: [sourceB] },
			],
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "todo-start",
			toolName: "todo",
			content: [{ type: "text", text: "started" }],
			details: {
				op: "init",
				phases: [
					{
						name: "Work",
						tasks: [
							{ content: "Fix @b.ts", status: "in_progress" },
							{ content: "Check @a.ts", status: "pending" },
						],
					},
				],
			},
			isError: false,
			timestamp: 4,
		});
		manager.appendMessage({ role: "user", content: "Continue", timestamp: 5 });
		const first = renderContextNotes(manager.getBranch());
		expect(first.indexOf("B needs a parser fix")).toBeLessThan(first.indexOf("A has an invariant"));
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "todo-next",
			toolName: "todo",
			content: [{ type: "text", text: "advanced" }],
			details: {
				op: "done",
				phases: [
					{
						name: "Work",
						tasks: [
							{ content: "Fix @b.ts", status: "completed" },
							{ content: "Check @a.ts", status: "in_progress" },
						],
					},
				],
			},
			isError: false,
			timestamp: 6,
		});
		const second = renderContextNotes(manager.getBranch());
		expect(second.indexOf("A has an invariant")).toBeLessThan(second.indexOf("B needs a parser fix"));
	});

	it("resumes structured findings with their individual retention", async () => {
		using tempDir = TempDir.createSync("@omp-context-notes-findings-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		const manager = SessionManager.create(tempDir.path(), sessionDir);
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, manager));
		if (!tool) throw new Error("expected context notes tool");
		const sourceId = manager.appendMessage({ role: "user", content: "Preserve API behavior", timestamp: 1 });
		await tool.execute("findings", {
			findings: [
				{ text: "Preserve API behavior", retention: "pinned", sourceEntryIds: [sourceId] },
				{ text: "Check generated output", retention: "window" },
			],
		});
		const file = manager.getSessionFile();
		if (!file) throw new Error("expected persisted session file");
		const reopened = await SessionManager.open(file, sessionDir);
		try {
			expect(getContextNotes(reopened.getBranch())?.findings).toHaveLength(2);
			reopened.appendCompaction("Investigation summarized", undefined, sourceId, 100);
			expect(getContextNotes(reopened.getBranch())?.findings).toMatchObject([
				{ text: "Preserve API behavior", retention: "pinned", sourceEntryIds: [sourceId] },
			]);
		} finally {
			await reopened.close();
			await manager.close();
		}
	});

	it("leaves the branch journal unchanged when reading a missing notebook", async () => {
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, sessionManager));
		if (!tool) throw new Error("expected context notes tool");

		await tool.execute("read-missing", {});
		expect(getContextNotes(sessionManager.getBranch())).toBeUndefined();
		expect(sessionManager.getBranch()).toHaveLength(0);
	});

	it("uses only the active branch's latest notebook and hides it after a context reset", () => {
		const shared = noteEntry("base", null, "shared context");
		const branchA: SessionEntry[] = [shared, noteEntry("a", "base", "branch A context")];
		const branchB: SessionEntry[] = [shared, noteEntry("b", "base", "branch B context")];
		const resetBranch: SessionEntry[] = [
			shared,
			resetEntry("reset", "base"),
			noteEntry("after", "reset", "fresh context"),
		];

		expect(getContextNotes(branchA)).toEqual({ entryId: "a", text: "branch A context" });
		expect(getContextNotes(branchB)).toEqual({ entryId: "b", text: "branch B context" });
		expect(getContextNotes(resetBranch)).toEqual({ entryId: "after", text: "fresh context" });
		expect(getContextNotes([shared, resetEntry("clear", "base")])).toBeUndefined();
	});

	it("ignores a persisted notebook revision whose source is absent from its branch", () => {
		const previous = noteEntry("first", null, "verified earlier note");
		const corrupt: CustomEntry<ContextNotesEntry> = {
			...noteEntry("second", "first", "unsupported later note"),
			data: { version: 2, text: "unsupported later note", sourceEntryIds: ["missing"] },
		};
		expect(getContextNotes([previous, corrupt])).toEqual({ entryId: "first", text: "verified earlier note" });
	});

	it("persists a replacement for resume and refuses disabled or parent-bound tool sessions", async () => {
		using tempDir = TempDir.createSync("@omp-context-notes-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		const sessionManager = SessionManager.create(tempDir.path(), sessionDir);
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const session = toolSession(settings, sessionManager);
		const tool = ContextNotesTool.createIf(session);
		if (!tool) throw new Error("expected context notes tool");

		await tool.execute("save", { text: "preserve this across resume" });
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("expected persisted session file");
		const resumed = await SessionManager.open(sessionFile, sessionDir);
		try {
			expect(getContextNotes(resumed.getBranch())).toMatchObject({ text: "preserve this across resume" });
		} finally {
			await resumed.close();
			await sessionManager.close();
		}

		const disabled = toolSession(
			Settings.isolated({ "compaction.experimentalContextManagement": false }),
			SessionManager.inMemory(),
		);
		expect(ContextNotesTool.createIf(disabled)).toBeNull();
		expect(NewContextTool.createIf(disabled)).toBeNull();

		const advisorBound = toolSession(settings, SessionManager.inMemory(), "advisor-session");
		expect(ContextNotesTool.createIf(advisorBound)).toBeNull();
	});
	it("does not append notes when the branch changes while disk preparation is pending", async () => {
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, sessionManager));
		if (!tool) throw new Error("expected context notes tool");
		const pendingEnsure = Promise.withResolvers<void>();
		const ensureSpy = vi.spyOn(sessionManager, "ensureOnDisk").mockImplementation(() => pendingEnsure.promise);
		try {
			const pendingWrite = tool.execute("stale-branch", { text: "must not persist" });
			await Promise.resolve();
			sessionManager.appendCustomEntry("test_branch_change");
			pendingEnsure.resolve();
			await expect(pendingWrite).rejects.toThrow("session branch changed");
			expect(getContextNotes(sessionManager.getBranch())).toBeUndefined();
		} finally {
			ensureSpy.mockRestore();
		}
	});

	it("does not append a note when the active model window shrinks during disk preparation", async () => {
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("expected bundled model");
		let activeModel = { ...bundled, contextWindow: 128_000 };
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const session = { ...toolSession(settings, sessionManager), getActiveModel: () => activeModel };
		const tool = ContextNotesTool.createIf(session);
		if (!tool) throw new Error("expected context notes tool");
		const pendingEnsure = Promise.withResolvers<void>();
		const ensureSpy = vi.spyOn(sessionManager, "ensureOnDisk").mockImplementation(() => pendingEnsure.promise);
		try {
			const text = Array.from({ length: 800 }, (_, index) => `finding-${index.toString(36)}`).join(" ");
			const pendingWrite = tool.execute("model-change", { text });
			await Promise.resolve();
			activeModel = { ...bundled, contextWindow: 8_192 };
			pendingEnsure.resolve();
			await expect(pendingWrite).rejects.toThrow("notebook limit");
			expect(getContextNotes(sessionManager.getBranch())).toBeUndefined();
		} finally {
			ensureSpy.mockRestore();
		}
	});

	it("does not append notes when experimental context management is disabled while preparing disk", async () => {
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated({ "compaction.experimentalContextManagement": true });
		const tool = ContextNotesTool.createIf(toolSession(settings, sessionManager));
		if (!tool) throw new Error("expected context notes tool");
		const pendingEnsure = Promise.withResolvers<void>();
		const ensureSpy = vi.spyOn(sessionManager, "ensureOnDisk").mockImplementation(() => pendingEnsure.promise);
		try {
			const pendingWrite = tool.execute("disabled-mid-write", { text: "must not persist" });
			await Promise.resolve();
			cfgCompactionExperimentalContextManagement.override(settings, false);
			pendingEnsure.resolve();
			await expect(pendingWrite).rejects.toThrow("Experimental context management is disabled.");
			expect(getContextNotes(sessionManager.getBranch())).toBeUndefined();
		} finally {
			ensureSpy.mockRestore();
		}
	});
});
