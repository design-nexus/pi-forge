import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { type } from "@oh-my-pi/omptype";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { cfgAdaptiveBands, cfgAdaptiveMode } from "@oh-my-pi/pi-coding-agent/governor/settings";
import { resolveCapabilityPolicies, resolvePromptPolicies } from "@oh-my-pi/pi-coding-agent/prompt-engine/profiles";
import {
	cfgPromptCapabilities,
	cfgPromptModules,
	cfgPromptProfile,
} from "@oh-my-pi/pi-coding-agent/prompt-engine/settings";
import { promptCompare, promptInspect, promptStats } from "@oh-my-pi/pi-coding-agent/prompt-engine/inspection";
import { classifyTaskCapabilities } from "@oh-my-pi/pi-coding-agent/prompt-engine/task-capability-classifier";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cfgIncludeModelInPrompt } from "@oh-my-pi/pi-coding-agent/session/settings";
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
	it("infers only clear direct-tool intent and reports its confidence", () => {
		expect(classifyTaskCapabilities(["Use the debugger to inspect the stack trace"])).toEqual({
			capabilities: ["debugger"],
			confidence: 0.94,
		});
		expect(classifyTaskCapabilities(["Update the settings parser and add coverage"])).toEqual({
			capabilities: [],
			confidence: 0,
		});
		expect(
			classifyTaskCapabilities(["Review the pull request and open the website in a browser"]).capabilities,
		).toEqual(["github", "browser"]);
	});

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
		expect(stats).toContain("Base system prompt text (local estimate):");
		expect(stats).toContain("subagents: active");
		expect(promptInspect(session)).toContain("--- delegation (");
	} finally {
		await session.dispose();
		authStorage.close();
	}
});

it("routes a discovered task tool on structured delegation intent without overriding policy", async () => {
	using dir = TempDir.createSync("@omp-delegation-route-");
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
		const parallel = { intent: "parallel_work", signal: "task_transition", contextBudgetTokens: 0 } as const;
		expect(session.getMountedXdevToolNames()).toContain("task");
		expect(session.getActiveToolNames()).not.toContain("task");
		expect(session.selectToolCapability({ id: "debugger", signal: "explicit" })).toMatchObject({
			id: "debugger",
			toolName: "debug",
			state: "discoverable",
			selected: true,
		});
		await session.setPromptSettingsOverride({ capabilities: { debugger: "disabled" } });
		expect(session.selectToolCapability({ id: "debugger", signal: "explicit" })).toMatchObject({
			state: "disabled",
			selected: false,
		});
		await session.setPromptSettingsOverride(undefined);
		expect(await session.routeToolCapability({ id: "debugger", signal: "explicit" })).toMatchObject({
			state: "active",
			selected: true,
			reason: "explicit capability request",
		});
		expect(session.getActiveToolNames()).toContain("debug");
		expect(await session.routeToolCapability({ id: "debugger", signal: "explicit" })).toMatchObject({
			state: "active",
			selected: false,
		});
		expect(session.selectDelegationCapability(parallel)).toMatchObject({
			state: "discoverable",
			selected: false,
			reason: "activation exceeds context budget",
		});
		const discovery = session.selectDelegationCapability({ intent: "parallel_work", signal: "task_transition" });
		expect(discovery.estimatedToolSchemaTokens).toBeGreaterThan(0);
		expect(discovery.estimatedActivationTokens).toBe(
			(discovery.estimatedGuidanceTokens ?? 0) + (discovery.estimatedToolSchemaTokens ?? 0),
		);
		expect(
			session.selectDelegationCapability({
				intent: "parallel_work",
				signal: "task_transition",
				contextBudgetTokens: discovery.estimatedGuidanceTokens,
			}),
		).toMatchObject({ selected: false, reason: "activation exceeds context budget" });
		expect(
			session.selectDelegationCapability({
				intent: "parallel_work",
				signal: "task_transition",
				contextBudgetTokens: discovery.estimatedActivationTokens,
			}),
		).toMatchObject({ selected: true });
		await session.setPromptSettingsOverride({ capabilities: { subagents: "disabled" } });
		expect(session.selectDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "disabled",
			selected: false,
		});
		await session.setPromptSettingsOverride(undefined);
		const model = session.agent.state.model;
		if (!model) throw new Error("Expected model");
		session.agent.setModel({ ...model, supportsTools: false });
		expect(session.selectDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "unavailable",
			selected: false,
		});
		const prefixBoundModel = getBundledModel("anthropic", "claude-fable-5-1");
		if (!prefixBoundModel) throw new Error("Expected prefix-bound model");
		session.agent.setModel(prefixBoundModel);
		session.agent.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "Earlier response" }],
			api: prefixBoundModel.api,
			provider: prefixBoundModel.provider,
			model: prefixBoundModel.id,
			stopReason: "stop",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		});
		expect(session.selectDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "unavailable",
			selected: false,
			reason: "model binds its tool roster after the first assistant response",
		});
		session.agent.replaceMessages([]);
		session.agent.setModel(model);
		const taskFacts = {
			files: Array.from({ length: 14 }, (_, index) => `src/file-${index}.ts`),
			tasks: [
				{ id: "a", dependsOn: [] },
				{ id: "b", dependsOn: [] },
				{ id: "c", dependsOn: [] },
				{ id: "d", dependsOn: [] },
			],
			highRisk: false,
			confidence: 0.9,
		};
		expect(await session.routeGovernorTaskTransition({ facts: taskFacts }, "initial")).toEqual({
			snapshot: undefined,
			route: undefined,
		});
		expect(session.getActiveToolNames()).not.toContain("task");
		cfgAdaptiveMode.set(settings, "inspect");
		const inspection = await session.routeGovernorTaskTransition({ facts: taskFacts }, "initial");
		expect(inspection.snapshot?.decision.executionMode).toBe("parallel");
		expect(inspection.route).toBeUndefined();
		expect(session.getActiveToolNames()).not.toContain("task");
		cfgAdaptiveMode.set(settings, "auto");
		cfgAdaptiveBands.set(settings, { massive: { contextShare: 0 } });
		const deferred = await session.routeGovernorTaskTransition({ facts: taskFacts }, "initial");
		expect(deferred.route).toMatchObject({ selected: false, reason: "activation exceeds context budget" });
		expect(session.getActiveToolNames()).not.toContain("task");
		cfgAdaptiveBands.set(settings, {});
		await Bun.sleep(0);
		expect(session.getActiveToolNames()).not.toContain("task");
		const transition = await session.routeGovernorTaskTransition({ facts: taskFacts }, "scope");
		expect(transition.snapshot?.decision).toMatchObject({ band: "massive", executionMode: "parallel" });
		expect(transition.route).toMatchObject({ state: "active", selected: true, source: "built-in" });
		expect(session.getActiveToolNames()).toContain("task");
		await expect(
			session.routeGovernorTaskTransition(
				{
					facts: {
						files: [],
						tasks: [
							{ id: "a", dependsOn: ["b"] },
							{ id: "b", dependsOn: ["a"] },
						],
						highRisk: false,
						confidence: 0.9,
					},
				},
				"scope",
			),
		).rejects.toThrow("cycle");
		expect(session.getGovernorSnapshot()).toEqual(transition.snapshot);
		expect(session.getActiveToolNames()).toContain("task");
		expect(session.promptComposition?.sections.find(section => section.id === "delegation")?.active).toBe(true);
		const serialFacts = {
			files: ["src/file-0.ts"],
			tasks: [{ id: "a", dependsOn: [] }],
			highRisk: false,
			confidence: 0.9,
		};
		const serial = await session.routeGovernorTaskTransition({ facts: serialFacts }, "scope");
		expect(serial.snapshot?.decision.executionMode).not.toBe("parallel");
		expect(serial.route).toBeUndefined();
		expect(session.getActiveToolNames()).not.toContain("task");
		expect(session.getMountedXdevToolNames()).toContain("task");
		const repromoted = await session.routeGovernorTaskTransition({ facts: taskFacts }, "scope");
		expect(repromoted.route).toMatchObject({ state: "active", selected: true });
		expect(session.getActiveToolNames()).toContain("task");
		cfgAdaptiveMode.set(settings, "inspect");
		await Bun.sleep(0);
		await session.runToolRegistryMutation(async () => {});
		expect(session.getActiveToolNames()).not.toContain("task");
		expect(session.getMountedXdevToolNames()).toContain("task");
		cfgAdaptiveMode.set(settings, "auto");
		await Bun.sleep(0);
		await session.routeGovernorTaskTransition({ facts: taskFacts }, "scope");
		expect(session.getActiveToolNames()).toContain("task");
		cfgAdaptiveMode.set(settings, "off");
		await Bun.sleep(0);
		await session.runToolRegistryMutation(async () => {});
		expect(session.getActiveToolNames()).not.toContain("task");
		cfgAdaptiveMode.set(settings, "auto");
		await Bun.sleep(0);
		await session.routeGovernorTaskTransition({ facts: taskFacts }, "scope");
		expect(session.getActiveToolNames()).toContain("task");
		const historyLength = session.promptCompositionHistory.length;
		expect(await session.routeDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "active",
			selected: false,
		});
		expect(session.promptCompositionHistory).toHaveLength(historyLength);
		await session.routeGovernorTaskTransition({ facts: serialFacts }, "scope");
		expect(session.getActiveToolNames()).toContain("task");
		await session.setActiveToolPresentation(
			session.getEnabledToolNames().filter(name => name !== "task"),
			session.getMountedXdevToolNames().filter(name => name !== "task"),
		);
		expect(session.selectDelegationCapability({ intent: "parallel_work", signal: "task_transition" })).toMatchObject({
			state: "discoverable",
			selected: false,
			reason: "task tool was not enabled",
		});
		const deselected = await session.routeGovernorTaskTransition({ facts: taskFacts }, "scope");
		expect(deselected.snapshot?.decision.workerCount).toBe(0);
		expect(deselected.route).toBeUndefined();
		expect(await session.routeDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "active",
			selected: true,
		});
		cfgPromptCapabilities.set(settings, { subagents: "disabled" });
		await session.reconcileBuiltinTools();
		expect(session.selectDelegationCapability({ intent: "parallel_work", signal: "explicit" })).toMatchObject({
			state: "disabled",
			selected: false,
		});
		expect(session.getEnabledToolNames()).not.toContain("task");
	} finally {
		await session.dispose();
		authStorage.close();
	}
});

it("routes declared task capabilities and releases Governor-owned tools when requirements change", async () => {
	using dir = TempDir.createSync("@omp-task-capability-route-");
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
		cfgAdaptiveMode.set(settings, "auto");
		await session.setPromptSettingsOverride({ capabilities: { debugger: "automatic", browser: "automatic" } });
		const available = new Set([...session.getEnabledToolNames(), "debug"]);
		const mounted = new Set([...session.getMountedXdevToolNames(), "debug"]);
		await session.setActiveToolPresentation([...available], [...mounted]);
		const facts = {
			files: [],
			tasks: [{ id: "inspect", dependsOn: [], requiredCapabilities: ["debugger"] as const }],
			highRisk: false,
			confidence: 0.9,
		};
		cfgAdaptiveBands.set(settings, { trivial: { contextShare: 0 } });
		const overBudget = await session.routeGovernorTaskTransition({ facts }, "initial");
		expect(overBudget.capabilityRoutes).toMatchObject([
			{
				id: "debugger",
				state: "discoverable",
				selected: false,
				reason: "activation exceeds context budget",
			},
		]);
		expect(session.getActiveToolNames()).not.toContain("debug");
		cfgAdaptiveBands.set(settings, {});
		const unavailableSet = await session.routeGovernorTaskTransition(
			{
				facts: {
					...facts,
					tasks: [
						{
							id: "inspect",
							dependsOn: [],
							requiredCapabilities: ["debugger", "mcp__server__tool"],
						},
					],
				},
			},
			"initial",
		);
		expect(unavailableSet.capabilityRoutes).toMatchObject([
			{ id: "debugger", state: "discoverable", selected: true },
			{ id: "mcp", state: "unavailable", selected: false },
		]);
		expect(session.getActiveToolNames()).not.toContain("debug");
		session.agent.state.isStreaming = true;
		const deferred = await session.routeGovernorTaskTransition({ facts }, "initial");
		expect(deferred.deferred).toBe(true);
		// A model-issued task runs while the agent loop remains streaming.
		session.agent.state.pendingToolCalls.add("task-routing");
		session.agent.state.streamMessage = {
			role: "assistant",
			content: [],
			api: "openai-responses",
			provider: "openai",
			model: session.model!.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 1,
		};
		expect((await session.routeGovernorTaskTransition({ facts }, "initial")).deferred).toBe(true);
		session.agent.state.streamMessage = null;

		expect(session.getActiveToolNames()).not.toContain("debug");
		const activated = await session.routeGovernorTaskTransition({ facts }, "initial");
		expect(activated.capabilityRoutes).toMatchObject([{ id: "debugger", selected: true, state: "active" }]);
		expect(session.getActiveToolNames()).toContain("debug");
		const released = await session.routeGovernorTaskTransition(
			{ facts: { ...facts, tasks: [{ id: "inspect", dependsOn: [] }] } },
			"scope",
		);
		expect(released.capabilityRoutes).toBeUndefined();
		expect(session.getActiveToolNames()).not.toContain("debug");
		expect(session.getMountedXdevToolNames()).toContain("debug");
		await session.routeGovernorTaskTransition({ facts }, "scope");
		expect(session.getActiveToolNames()).toContain("debug");
		await session.routeToolCapability({ id: "debugger", signal: "explicit" });
		await session.routeGovernorTaskTransition(
			{ facts: { ...facts, tasks: [{ id: "inspect", dependsOn: [] }] } },
			"scope",
		);
		expect(session.getActiveToolNames()).toContain("debug");
		await session.releaseToolCapability({ id: "debugger", signal: "explicit" });
		expect(session.getActiveToolNames()).not.toContain("debug");
		await session.routeGovernorTaskTransition({ facts, ownerId: "scope-a" }, "scope");
		await session.routeGovernorTaskTransition({ facts, ownerId: "scope-b" }, "scope");
		await session.releaseGovernorTaskCapabilityRoutes("scope-a");
		expect(session.getActiveToolNames()).toContain("debug");
		await session.releaseGovernorTaskCapabilityRoutes("scope-b");
		expect(session.getActiveToolNames()).not.toContain("debug");
		session.agent.state.pendingToolCalls.delete("task-routing");
		session.agent.state.isStreaming = false;
		await session.waitForIdle();
		await session.routeGovernorTaskTransition({ facts, ownerId: "scope-c" }, "scope");
		await session.routeToolCapability({ id: "debugger", signal: "explicit" });
		await session.releaseToolCapability({ id: "debugger", signal: "explicit" });
		expect(session.getActiveToolNames()).toContain("debug");
		await session.releaseGovernorTaskCapabilityRoutes("scope-c");
		expect(session.getActiveToolNames()).not.toContain("debug");
		const inferredFacts = {
			files: [],
			tasks: [{ id: "debug-task", dependsOn: [] }],
			highRisk: false,
			confidence: 0.9,
			inferredCapabilities: ["debugger"] as const,
			capabilityConfidence: 0.94,
		};
		const inferredRoute = await session.routeGovernorTaskTransition(
			{ facts: inferredFacts, ownerId: "inferred-debug" },
			"scope",
		);
		expect(inferredRoute.capabilityRoutes).toMatchObject([
			{ id: "debugger", selected: true, state: "active", reason: "inferred from task text (94% confidence)" },
		]);
		await session.releaseGovernorTaskCapabilityRoutes("inferred-debug");
		await session.setPromptSettingsOverride({ capabilities: { debugger: "disabled" } });
		const disabledInferred = await session.routeGovernorTaskTransition(
			{ facts: inferredFacts, ownerId: "inferred-disabled" },
			"scope",
		);
		expect(disabledInferred.capabilityRoutes).toMatchObject([{ id: "debugger", state: "disabled", selected: false }]);
		expect(session.getActiveToolNames()).not.toContain("debug");
		await session.setPromptSettingsOverride({ capabilities: { debugger: "automatic", browser: "automatic" } });
		const userPromptRoute = await session.routePromptCapabilities("Use the debugger to inspect the stack trace");
		expect(userPromptRoute).toMatchObject([
			{ id: "debugger", selected: true, state: "active", reason: "inferred from task text (94% confidence)" },
		]);
		expect(session.getActiveToolNames()).toContain("debug");
		await session.routePromptCapabilities("Fix a typo in the settings parser");
		expect(session.getActiveToolNames()).not.toContain("debug");
		await session.setPromptSettingsOverride({ capabilities: { debugger: "disabled" } });
		const userOverrideRoute = await session.routePromptCapabilities("Use the debugger to inspect the stack trace");
		expect(userOverrideRoute).toMatchObject([{ id: "debugger", selected: false, state: "disabled" }]);
		expect(session.getActiveToolNames()).not.toContain("debug");
		await session.setPromptSettingsOverride({ capabilities: { debugger: "automatic", browser: "automatic" } });
		const browserAvailable = session.promptComposition?.capabilities.browser.available === true;
		const browserRoute = await session.routeGovernorTaskTransition(
			{
				facts: {
					...facts,
					tasks: [{ id: "inspect-browser", dependsOn: [], requiredCapabilities: ["browser"] }],
				},
			},
			"scope",
		);
		expect(browserRoute.capabilityRoutes).toMatchObject([
			{
				id: "browser",
				state: browserAvailable ? "active" : "unavailable",
				selected: browserAvailable,
				...(browserAvailable ? {} : { reason: "browser runtime is unavailable" }),
			},
		]);
		const missingMcp = await session.routeGovernorTaskTransition(
			{
				facts: {
					...facts,
					tasks: [{ id: "inspect-mcp", dependsOn: [], requiredCapabilities: ["mcp__server__tool"] }],
				},
			},
			"scope",
		);
		expect(missingMcp.capabilityRoutes).toMatchObject([
			{ id: "mcp", toolName: "mcp__server__tool", state: "unavailable", selected: false },
		]);
		await session.routeGovernorTaskTransition({ facts }, "scope");
		expect(session.getActiveToolNames()).toContain("debug");
		await session.releaseGovernorTaskCapabilityRoutes();
		expect(session.getActiveToolNames()).not.toContain("debug");
		expect(session.getMountedXdevToolNames()).toContain("debug");
		expect(session.promptSettingsOverride?.capabilities?.browser).toBe("automatic");
		if (browserAvailable) {
			await session.setPromptSettingsOverride({ capabilities: { debugger: "automatic" } });
			await session.routeGovernorTaskTransition(
				{
					facts: {
						...facts,
						tasks: [{ id: "browser-cleanup", dependsOn: [], requiredCapabilities: ["browser"] }],
					},
					ownerId: "browser-cleanup",
				},
				"scope",
			);
			await session.releaseGovernorTaskCapabilityRoutes("browser-cleanup");
			expect(session.promptSettingsOverride?.capabilities?.browser).toBeUndefined();
		}
		const enabledBeforeUnownedRelease = session.getEnabledToolNames();
		const mountedBeforeUnownedRelease = session.getMountedXdevToolNames();
		await session.setActiveToolPresentation(
			[...new Set([...enabledBeforeUnownedRelease, "debug"])],
			mountedBeforeUnownedRelease.filter(name => name !== "debug"),
		);
		await session.releaseGovernorTaskCapabilityRoutes("unowned-scope");
		expect(session.getActiveToolNames()).toContain("debug");
		await session.setActiveToolPresentation(enabledBeforeUnownedRelease, mountedBeforeUnownedRelease);
		await session.routeGovernorTaskTransition({ facts }, "scope");
		expect(session.getActiveToolNames()).toContain("debug");
		cfgAdaptiveMode.set(settings, "inspect");
		await Bun.sleep(0);
		await session.runToolRegistryMutation(async () => {});
		expect(session.getActiveToolNames()).not.toContain("debug");
		expect(session.getMountedXdevToolNames()).toContain("debug");
	} finally {
		await session.dispose();
		authStorage.close();
	}
});

it("separates provider-reported request usage from estimated module text", async () => {
	using dir = TempDir.createSync("@omp-prompt-usage-");
	const cwd = dir.join("project");
	const authStorage = await AuthStorage.create(":memory:");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings: Settings.isolated(),
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
		session.agent.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "Done" }],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-4o-mini",
			stopReason: "stop",
			usage: {
				input: 900,
				output: 20,
				cacheRead: 300,
				cacheWrite: 34,
				totalTokens: 1_254,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		});
		const stats = promptStats(session);
		expect(stats).toContain(
			"Last provider-reported prompt: 1,234 tokens (input 900 · cache read 300 · cache write 34",
		);
		expect(stats).toContain("Modules (local text estimates; providers do not report per-module tokens):");
		session.agent.setSystemPrompt(["Turn-specific context"]);
		expect(promptStats(session)).toContain("Effective system prompt text (local estimate):");
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

it("refreshes model modules across a model switch when model names are hidden", async () => {
	using dir = TempDir.createSync("@omp-prompt-model-switch-");
	const cwd = dir.join("project");
	const settings = Settings.isolated();
	cfgIncludeModelInPrompt.set(settings, false);
	const authStorage = await AuthStorage.create(":memory:");
	authStorage.keys.setRuntime("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const firstModel = getBundledModel("anthropic", "claude-fable-5");
	const prefixBoundModel = getBundledModel("anthropic", "claude-fable-5-1");
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager: SessionManager.inMemory(cwd),
		model: firstModel,
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
		const modelModule = () =>
			session.promptComposition?.sections.find(section => section.id === "prefix-bound-tools");
		expect(modelModule()?.active).toBe(false);
		await session.setModelTemporary(prefixBoundModel);
		expect(modelModule()?.active).toBe(true);
		expect(session.systemPrompt.join("\n")).toContain("# Prefix-bound tool roster");
		expect(promptStats(session)).toContain("prefix-bound-tools: loaded");
		expect(session.promptCompositionHistory.some(change => change.added.includes("prefix-bound-tools"))).toBe(true);
		cfgPromptCapabilities.set(settings, { subagents: "disabled" });
		await session.reconcileBuiltinTools();
		expect(session.getEnabledToolNames()).not.toContain("task");
		expect(modelModule()?.active).toBe(true);
		await session.setModelTemporary(firstModel);
		expect(modelModule()?.active).toBe(false);
		expect(session.systemPrompt.join("\n")).not.toContain("# Prefix-bound tool roster");
		expect(session.promptCompositionHistory.some(change => change.removed.includes("prefix-bound-tools"))).toBe(true);
	} finally {
		await session.dispose();
		authStorage.close();
	}
});

it("tracks RPC host tool refresh in the wire schema estimate and prompt inspection", async () => {
	using dir = TempDir.createSync("@omp-prompt-rpc-tools-");
	const cwd = dir.join("project");
	const authStorage = await AuthStorage.create(":memory:");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings: Settings.isolated(),
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
	const rpcTool: AgentTool = {
		name: "rpc_probe",
		label: "RPC Probe",
		description: "Inspect a host-owned resource",
		parameters: type({ resource: "string" }),
		async execute() {
			return { content: [{ type: "text", text: "ready" }] };
		},
	};
	const toolTokens = () =>
		Number(
			promptCompare(session)
				.split("\n")
				.find(line => line.startsWith("| full |"))
				?.split("|")[3]
				?.trim()
				.replaceAll(",", ""),
		);
	try {
		const before = toolTokens();
		await session.refreshRpcHostTools([rpcTool]);
		expect(session.agent.state.tools.map(tool => tool.name)).toContain("rpc_probe");
		expect(toolTokens()).toBeGreaterThan(before);
		expect(promptInspect(session)).not.toContain("Current turn override or injected context");
		await session.refreshRpcHostTools([]);
		expect(session.agent.state.tools.map(tool => tool.name)).not.toContain("rpc_probe");
		expect(toolTokens()).toBe(before);
		expect(promptInspect(session)).not.toContain("Current turn override or injected context");
	} finally {
		await session.dispose();
		authStorage.close();
	}
});
