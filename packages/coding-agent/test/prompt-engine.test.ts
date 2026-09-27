import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resolveCapabilityPolicies, resolvePromptPolicies } from "@oh-my-pi/pi-coding-agent/prompt-engine/profiles";
import {
	cfgPromptCapabilities,
	cfgPromptModules,
	cfgPromptProfile,
} from "@oh-my-pi/pi-coding-agent/prompt-engine/settings";
import { promptCompare, promptInspect, promptStats } from "@oh-my-pi/pi-coding-agent/prompt-engine/inspection";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { buildSystemPrompt, type BuildSystemPromptOptions } from "@oh-my-pi/pi-coding-agent/system-prompt";
import { CONFIG_DIR_NAME, getProjectAgentDir, TempDir } from "@oh-my-pi/pi-utils";
import bundledTemplate from "../src/prompts/system/system-prompt.md" with { type: "text" };

function promptOptions(cwd: string, overrides: Partial<BuildSystemPromptOptions> = {}): BuildSystemPromptOptions {
	return {
		cwd,
		contextFiles: [],
		skills: [],
		rules: [],
		toolNames: ["read", "write", "bash", "task"],
		eagerTasks: true,
		workspaceTree: { rootPath: cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
		...overrides,
	};
}

describe("prompt composition", () => {
	it("keeps Full provider blocks byte-identical to rendering the original bundled template", async () => {
		using dir = TempDir.createSync("@omp-prompt-full-");
		const cwd = dir.join("project");
		const model = getBundledModel("openai", "gpt-4o-mini");
		const inputs = promptOptions(cwd, {
			contextFiles: [{ path: path.join(cwd, "AGENTS.md"), content: "Project rule: keep the public API stable." }],
			tokenizerModel: model,
		});
		const composed = await buildSystemPrompt(inputs);
		const legacyRender = await buildSystemPrompt({ ...inputs, systemPromptTemplate: bundledTemplate });
		expect(composed.systemPrompt).toEqual(legacyRender.systemPrompt);
		const tokenizer = new Tokenizer(model);
		expect(composed.composition?.totalTokens).toBe(tokenizer.countTokens(composed.systemPrompt, "strict"));
		expect(composed.composition?.fullTokens).toBe(composed.composition?.totalTokens);
	});

	it("omits disabled guidance while keeping project rules and stable module ordering", async () => {
		using dir = TempDir.createSync("@omp-prompt-minimal-");
		const cwd = dir.join("project");
		const full = await buildSystemPrompt(promptOptions(cwd));
		const minimal = await buildSystemPrompt(
			promptOptions(cwd, {
				promptProfile: "minimal",
				toolNames: ["read", "write", "bash"],
				contextFiles: [{ path: path.join(cwd, "AGENTS.md"), content: "Always keep the API stable." }],
			}),
		);
		const text = minimal.systemPrompt.join("\n\n");
		expect(text).toContain("§ Role");
		expect(text).toContain("§ Delivery");
		expect(text).toContain("Always keep the API stable.");
		expect(text).not.toContain("§ Workflow");
		expect(text).toContain("# 5. Verify");
		expect(text).not.toContain("# Delegation");
		expect(minimal.composition?.sections.map(section => section.id)).toEqual([
			"core",
			"core",
			"runtime",
			"tool-policy",
			"workflow",
			"testing",
			"workflow-cleanup",
			"delivery",
			"project",
			"prefix-bound-tools",
		]);
		expect(minimal.composition?.totalTokens).toBeLessThan(full.composition?.totalTokens ?? 0);
	});

	it("preserves a runtime rule that contains a bundled section heading", async () => {
		using dir = TempDir.createSync("@omp-prompt-heading-rule-");
		const inputs = promptOptions(dir.join("project"), {
			promptProfile: "minimal",
			rules: [
				{
					name: "heading-rule",
					path: dir.join("heading-rule.md"),
					description: "Rule text before heading\n§ Workflow\nPreserve this runtime rule.",
				},
			],
		});
		const result = await buildSystemPrompt(inputs);
		expect(result.systemPrompt.join("\n")).toContain("Preserve this runtime rule.");
		expect(result.composition?.sections.find(section => section.id === "runtime")?.content).toContain(
			"Preserve this runtime rule.",
		);
		expect(result.composition?.sections.filter(section => section.id === "workflow")).toHaveLength(1);
		const full = await buildSystemPrompt({ ...inputs, promptProfile: "full" });
		const renderedTemplate = await buildSystemPrompt({
			...inputs,
			promptProfile: "full",
			systemPromptTemplate: bundledTemplate,
		});
		expect(full.systemPrompt).toEqual(renderedTemplate.systemPrompt);
	});

	it("keeps a discovered SYSTEM_TEMPLATE.md opaque under a smaller profile", async () => {
		using dir = TempDir.createSync("@omp-prompt-opaque-");
		const cwd = dir.join("project");
		await Bun.write(
			path.join(cwd, CONFIG_DIR_NAME, "SYSTEM_TEMPLATE.md"),
			"My template: {{model}}\n§ Workflow is user text.",
		);
		const result = await buildSystemPrompt(promptOptions(cwd, { promptProfile: "minimal" }));
		expect(result.systemPrompt[0]).toContain("§ Workflow is user text.");
		expect(result.composition?.sections[0]?.id).toBe("opaque");
	});

	it("keeps a literal SYSTEM.md intact under a smaller profile", async () => {
		using dir = TempDir.createSync("@omp-prompt-literal-");
		const cwd = dir.join("project");
		await Bun.write(
			path.join(cwd, CONFIG_DIR_NAME, "SYSTEM.md"),
			"Literal user policy.\n§ Workflow is literal text.",
		);
		const result = await buildSystemPrompt(promptOptions(cwd, { promptProfile: "minimal" }));
		expect(result.systemPrompt[0]).toContain("§ Workflow is literal text.");
		expect(result.composition?.sections[0]?.id).toBe("opaque");
	});

	it("retains browser verification guidance when a Minimal session activates the browser", async () => {
		using dir = TempDir.createSync("@omp-prompt-browser-");
		const cwd = dir.join("project");
		const result = await buildSystemPrompt(
			promptOptions(cwd, {
				promptProfile: "minimal",
				toolNames: ["read", "write", "eval"],
				browserEnabled: true,
			}),
		);
		expect(result.systemPrompt.join("\n")).toContain("browser.open");
		expect(result.composition?.sections.find(section => section.id === "testing")?.active).toBe(true);
	});
});

describe("prompt policy settings", () => {
	it("honors explicit capability overrides without changing the Full default", () => {
		expect(resolveCapabilityPolicies("full").lsp).toBe("always");
		expect(resolveCapabilityPolicies("coding", { lsp: "disabled" }).lsp).toBe("disabled");
		expect(resolvePromptPolicies("minimal").workflow).toBe("disabled");
		expect(() => cfgPromptCapabilities.set(Settings.isolated(), { unknown: "always" } as never)).toThrow();
	});

	it("persists project prompt choices over user choices and reloads them", async () => {
		using dir = TempDir.createSync("@omp-prompt-settings-");
		const cwd = dir.join("project");
		const agentDir = dir.join("agent");
		const settings = await Settings.loadIsolated({ cwd, agentDir });
		cfgPromptProfile.set(settings, "coding");
		settings.setProjectValue(cfgPromptProfile, "minimal");
		settings.setProjectValue(cfgPromptModules, { delegation: "disabled" });
		settings.setProjectValue(cfgPromptCapabilities, { lsp: "disabled" });
		await settings.flush();
		const reloaded = await Settings.loadIsolated({ cwd, agentDir });
		expect(cfgPromptProfile.get(reloaded)).toBe("minimal");
		expect(cfgPromptModules.get(reloaded).delegation).toBe("disabled");
		expect(cfgPromptCapabilities.get(reloaded).lsp).toBe("disabled");
		const persisted = await Bun.file(path.join(getProjectAgentDir(cwd), "config.yml")).text();
		expect(persisted).toContain("profile: minimal");
	});
});

it("reconciles a changed profile into both the callable task tool and the next base prompt", async () => {
	using dir = TempDir.createSync("@omp-prompt-live-");
	const cwd = dir.join("project");
	const settings = Settings.isolated();
	cfgPromptProfile.set(settings, "minimal");
	const authStorage = await AuthStorage.create(":memory:");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager: SessionManager.inMemory(cwd),
		model: getBundledModel("openai", "gpt-4o-mini"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	try {
		expect(session.getMountedXdevToolNames()).toContain("task");
		expect(session.systemPrompt.join("\n")).not.toContain("# Delegation");
		const write = session.getToolByName("write");
		expect(write).toBeDefined();
		await write!.execute("activate-task-guidance", {
			path: "xd://task",
			content: JSON.stringify({ agent: "nonexistent-agent", task: "Inspect one file" }),
		});
		expect(session.systemPrompt.join("\n")).toContain("# Delegation");
		expect(session.promptComposition?.sections.find(section => section.id === "delegation")?.reason).toBe(
			"task device activated",
		);
		cfgPromptCapabilities.set(settings, { subagents: "disabled" });
		await session.reconcileBuiltinTools();
		expect(session.getEnabledToolNames()).not.toContain("task");
		expect(session.systemPrompt.join("\n")).not.toContain("# Delegation");
		cfgPromptProfile.set(settings, "full");
		cfgPromptCapabilities.set(settings, {});
		await session.reconcileBuiltinTools();
		expect(session.getEnabledToolNames()).toContain("task");
		expect(session.systemPrompt.join("\n")).toContain("# Delegation");
		expect(session.promptComposition?.profile).toBe("full");
		const stats = promptStats(session);
		expect(stats).toContain("System prompt text:");
		expect(stats).toContain("subagents: active");
		expect(promptInspect(session)).toContain("--- delegation (");
	} finally {
		await session.dispose();
		authStorage.close();
	}
});

it("does not count a disabled model module in the Full profile comparison", async () => {
	using dir = TempDir.createSync("@omp-prompt-model-compare-");
	const cwd = dir.join("project");
	const settings = Settings.isolated();
	cfgPromptModules.set(settings, { "prefix-bound-tools": "disabled" });
	const authStorage = await AuthStorage.create(":memory:");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager: SessionManager.inMemory(cwd),
		model: getBundledModel("anthropic", "claude-fable-5-1"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	try {
		expect(session.promptComposition?.sections.find(section => section.id === "prefix-bound-tools")?.active).toBe(
			false,
		);
		const fullRow = promptCompare(session)
			.split("\n")
			.find(line => line.startsWith("| full |"));
		expect(fullRow).toContain(`| ${session.promptComposition?.totalTokens.toLocaleString()} |`);
	} finally {
		await session.dispose();
		authStorage.close();
	}
});
