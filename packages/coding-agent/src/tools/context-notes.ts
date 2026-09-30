import { type } from "@oh-my-pi/omptype";
import { Tokenizer } from "@oh-my-pi/pi-agent-core";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolApprovalDecision,
} from "@oh-my-pi/pi-agent-core";
import {
	CONTEXT_NOTES_ENTRY_TYPE,
	contextNotesTokenBudget,
	getContextNotes,
	isContextNotesFindings,
	isContextNotesSourceIds,
	MAX_CONTEXT_NOTES_BYTES,
	renderContextFindingsContent,
	renderContextNotes,
	renderContextNotesContent,
	type ContextNotesEntry,
	type ContextNotesFinding,
	type ContextNotesRetention,
} from "../session/context-notes";
import contextNotesDescription from "../prompts/tools/context-notes.md" with { type: "text" };
import newContextDescription from "../prompts/tools/new-context.md" with { type: "text" };
import type { ToolSession } from ".";
import { convertToLlm, createCustomMessage } from "../session/messages";
import { throwIfAborted } from "./tool-errors";
import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";

import { cfgCompactionExperimentalContextManagement } from "../session/context-settings";

const contextNotesSchema = type({
	"text?": type("string").describe("Entire replacement notebook text. Omit to read; use an empty string to clear."),
	"sourceEntryIds?": type("string").array().describe("Active-branch entry IDs supporting this replacement notebook."),
	"retention?": type("'pinned' | 'window'").describe(
		"Pinned notes survive compaction; window notes expire at the next compaction.",
	),
	"findings?": type({
		text: "string>0",
		retention: "'pinned' | 'window'",
		"sourceEntryIds?": type("string").array(),
	})
		.array()
		.describe("Replacement findings with individual retention and optional source entries."),
});

const newContextSchema = type({});

export type ContextNotesParams = typeof contextNotesSchema.infer;
export type NewContextParams = typeof newContextSchema.infer;

export interface ContextNotesToolDetails {
	entryId?: string;
	text: string;
	bytes?: number;
	sourceEntryIds?: string[];
	retention?: ContextNotesRetention;
	findings?: ContextNotesFinding[];
}

export interface NewContextToolDetails {
	requested: true;
}

type ExperimentalContextSessionManager = NonNullable<ToolSession["sessionManager"]>;

function resolveExperimentalContextSession(session: ToolSession): ExperimentalContextSessionManager | undefined {
	if (cfgCompactionExperimentalContextManagement.get(session.settings) !== true || session.isDisposed?.()) {
		return undefined;
	}
	const manager = session.sessionManager;
	const ownerId = session.getSessionId?.();
	if (!manager || !ownerId || manager.getSessionId?.() !== ownerId) return undefined;
	return manager;
}

/**
 * Resolves the live session journal only when experimental context management is enabled and
 * owned by this ToolSession. The identity comparison prevents advisor tools from writing the
 * parent agent's notebook or resolving its raw history.
 */
export function getExperimentalContextSession(session: ToolSession): ExperimentalContextSessionManager {
	const manager = resolveExperimentalContextSession(session);
	if (manager) return manager;
	if (cfgCompactionExperimentalContextManagement.get(session.settings) !== true) {
		throw new ToolError("Experimental context management is disabled.");
	}
	if (session.isDisposed?.()) {
		throw new ToolError("Experimental context management is unavailable because this session is disposed.");
	}
	throw new ToolError("Experimental context management is unavailable for this session.");
}

function createIfSupported<T extends ContextNotesTool | NewContextTool>(
	session: ToolSession,
	ToolClass: new (session: ToolSession) => T,
): T | null {
	return resolveExperimentalContextSession(session) ? new ToolClass(session) : null;
}

/** Reads or replaces the current branch's durable experimental notebook. */
export class ContextNotesTool implements AgentTool<typeof contextNotesSchema, ContextNotesToolDetails> {
	readonly name = "context_notes";
	readonly approval = (args: unknown): ToolApprovalDecision =>
		args !== null && typeof args === "object" && (Object.hasOwn(args, "text") || Object.hasOwn(args, "findings"))
			? "write"
			: "read";
	readonly label = "Context Notes";
	readonly description = contextNotesDescription;
	readonly parameters = contextNotesSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Read or replace experimental context notes";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): ContextNotesTool | null {
		return createIfSupported(session, ContextNotesTool);
	}

	#assertContextBudget(rendered: string): void {
		if (rendered.length === 0) return;
		const model = this.session.getActiveModel?.();
		const limit = contextNotesTokenBudget(model?.contextWindow ?? 0);
		if (!model || limit === undefined) return;
		const message = createCustomMessage(
			CONTEXT_NOTES_ENTRY_TYPE,
			rendered,
			false,
			undefined,
			new Date().toISOString(),
		);
		const tokens = new Tokenizer(model).countMessages(convertToLlm([message]));
		if (tokens > limit) {
			throw new ToolError(
				`Context notes would use ${tokens} tokens on the active model; the notebook limit is ${limit} tokens. Shorten the notebook and use history://current/entry/<id> to recover details.`,
			);
		}
	}

	async execute(
		_id: string,
		params: ContextNotesParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ContextNotesToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ContextNotesToolDetails>> {
		const manager = getExperimentalContextSession(this.session);
		throwIfAborted(signal);
		if (params.text !== undefined && typeof params.text !== "string") {
			throw new ToolError("context_notes text must be a string.");
		}
		if (params.retention !== undefined && params.retention !== "pinned" && params.retention !== "window") {
			throw new ToolError("context_notes retention must be pinned or window.");
		}
		if (params.text === undefined && params.findings === undefined) {
			if (params.sourceEntryIds !== undefined) throw new ToolError("sourceEntryIds requires replacement text.");
			if (params.retention !== undefined) throw new ToolError("retention requires replacement text.");
			const branch = manager.getBranch();
			const notes = getContextNotes(branch);
			return {
				content: [
					{
						type: "text",
						text:
							notes?.sourceEntryIds || notes?.findings
								? renderContextNotes(branch)
								: (notes?.text ?? "No context notes are stored for this session branch."),
					},
				],
				details: notes
					? {
							entryId: notes.entryId,
							text: notes.text,
							...(notes.sourceEntryIds ? { sourceEntryIds: notes.sourceEntryIds } : {}),
							...(notes.retention ? { retention: notes.retention } : {}),
							...(notes.findings ? { findings: notes.findings } : {}),
						}
					: { entryId: undefined, text: "" },
			};
		}
		if (params.text !== undefined && params.findings !== undefined)
			throw new ToolError("Supply either text or findings, not both.");
		if (params.findings !== undefined && (params.sourceEntryIds !== undefined || params.retention !== undefined))
			throw new ToolError("Use each finding's retention and sourceEntryIds when supplying findings.");
		if (params.findings !== undefined && !Array.isArray(params.findings))
			throw new ToolError("Context findings must be an array.");
		const findings = params.findings?.map(finding => {
			if (
				finding === null ||
				typeof finding !== "object" ||
				Array.isArray(finding) ||
				(finding.sourceEntryIds !== undefined && !isContextNotesSourceIds(finding.sourceEntryIds))
			)
				throw new ToolError("Each context finding needs valid source entry IDs.");
			return {
				text: finding.text,
				retention: finding.retention,
				sourceEntryIds: [...(finding.sourceEntryIds ?? [])],
			};
		});
		if (findings !== undefined && !isContextNotesFindings(findings))
			throw new ToolError(
				"Context findings must contain 1–32 nonempty items within the 16 KiB text and 16 source-reference limits.",
			);
		const sourceEntryIds = params.sourceEntryIds;
		const retention = params.retention ?? "pinned";
		if (sourceEntryIds !== undefined && !isContextNotesSourceIds(sourceEntryIds))
			throw new ToolError("Context note sources must be distinct active-branch entry IDs within the source limit.");
		if (params.text === "" && sourceEntryIds && sourceEntryIds.length > 0)
			throw new ToolError("Clearing context notes cannot retain source entry IDs.");

		const bytes = findings
			? findings.reduce((total, finding) => total + Buffer.byteLength(finding.text, "utf8"), 0)
			: Buffer.byteLength(params.text ?? "", "utf8");
		if (bytes > MAX_CONTEXT_NOTES_BYTES) {
			throw new ToolError(
				`Context notes are ${bytes} bytes; the limit is ${MAX_CONTEXT_NOTES_BYTES} UTF-8 bytes. Shorten the notebook and use history://current/full to recover raw detail.`,
			);
		}
		const rendered = findings
			? renderContextFindingsContent(findings)
			: renderContextNotesContent(params.text ?? "", sourceEntryIds, retention);
		this.#assertContextBudget(rendered);

		const ownerId = this.session.getSessionId?.();
		const branch = manager.getBranch();
		const branchLeafId = branch.at(-1)?.id;
		const branchIds = new Set(branch.map(entry => entry.id));
		const allSourceIds = findings ? findings.flatMap(finding => finding.sourceEntryIds) : (sourceEntryIds ?? []);
		if (allSourceIds.some(id => !branchIds.has(id))) {
			throw new ToolError("Context note source entry is not on the active session branch.");
		}
		await manager.ensureOnDisk();
		throwIfAborted(signal);
		const currentManager = getExperimentalContextSession(this.session);
		if (
			currentManager !== manager ||
			this.session.isDisposed?.() ||
			!ownerId ||
			this.session.getSessionId?.() !== ownerId ||
			manager.getSessionId?.() !== ownerId ||
			manager.getBranch().at(-1)?.id !== branchLeafId
		) {
			throw new ToolError("Experimental context notes were not saved because the session branch changed.");
		}
		this.#assertContextBudget(rendered);

		const data: ContextNotesEntry = findings
			? { version: 4, findings }
			: params.text !== "" && retention === "window"
				? { version: 3, text: params.text ?? "", sourceEntryIds: [...(sourceEntryIds ?? [])], retention }
				: sourceEntryIds && sourceEntryIds.length > 0
					? { version: 2, text: params.text ?? "", sourceEntryIds: [...sourceEntryIds] }
					: { version: 1, text: params.text ?? "" };
		const entryId = manager.appendCustomEntry(CONTEXT_NOTES_ENTRY_TYPE, data);
		await manager.flush();
		return {
			content: [{ type: "text", text: "Context notes saved." }],
			details: {
				entryId,
				text: params.text ?? findings?.map(finding => finding.text).join("\n") ?? "",
				bytes,
				...(data.version === 2 ? { sourceEntryIds: data.sourceEntryIds } : {}),
				...(data.version === 3
					? {
							retention: data.retention,
							...(data.sourceEntryIds.length > 0 ? { sourceEntryIds: data.sourceEntryIds } : {}),
						}
					: {}),
				...(data.version === 4 ? { findings: data.findings } : {}),
			},
		};
	}
}

/** Requests a fresh context window; the owning lifecycle consumes this turn-local signal. */
export class NewContextTool implements AgentTool<typeof newContextSchema, NewContextToolDetails> {
	readonly name = "new_context";
	readonly approval = "write" as const;
	readonly label = "New Context";
	readonly description = newContextDescription;
	readonly parameters = newContextSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Request a fresh context window";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): NewContextTool | null {
		return createIfSupported(session, NewContextTool);
	}

	async execute(
		_id: string,
		_params: NewContextParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<NewContextToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<NewContextToolDetails>> {
		getExperimentalContextSession(this.session);
		throwIfAborted(signal);
		return {
			content: [{ type: "text", text: "New context window requested." }],
			details: { requested: true },
		};
	}
}
