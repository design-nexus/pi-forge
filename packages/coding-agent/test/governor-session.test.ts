import { expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgAdaptiveBands, cfgAdaptiveMode, cfgAdaptiveThresholds } from "@oh-my-pi/pi-coding-agent/governor/settings";
import { latestGovernorSnapshot } from "@oh-my-pi/pi-coding-agent/governor/ledger";
import { cfgPromptCapabilities } from "@oh-my-pi/pi-coding-agent/prompt-engine/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cfgTaskMaxConcurrency, cfgTaskMaxEffort } from "@oh-my-pi/pi-coding-agent/task/settings";
import { TempDir } from "@oh-my-pi/pi-utils";

it("previews a live Governor decision from settings and session ceilings without activating tools", async () => {
	using dir = TempDir.createSync("@omp-governor-session-");
	const cwd = dir.join("project");
	const settings = Settings.isolated();
	const bundled = getBundledModel("openai", "gpt-4o-mini");
	if (!bundled) throw new Error("Expected bundled test model");
	const model = {
		...bundled,
		reasoning: true,
		thinking: { mode: "effort" as const, efforts: [Effort.Low, Effort.Medium, Effort.High] },
	};
	const authStorage = await AuthStorage.create(":memory:");
	authStorage.keys.setRuntime("openai", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const sessionManager = SessionManager.create(cwd, dir.join("sessions"));
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager,
		model,
		thinkingLevelCeiling: Effort.Low,
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
		const facts = {
			fileCount: 14,
			independentTasks: 5,
			dependencyEdges: 2,
			highRisk: false,
			confidence: 0.9,
		};
		expect(session.previewGovernorDecision({ signals: facts })).toBeUndefined();
		cfgAdaptiveMode.set(settings, "inspect");
		cfgTaskMaxEffort.set(settings, Effort.Medium);
		cfgTaskMaxConcurrency.set(settings, 2);
		const beforeTools = session.getActiveToolNames();
		const preview = session.previewGovernorDecision({
			signals: facts,
			overrides: { effort: Effort.High, workerCount: 5 },
		});
		expect(preview).toMatchObject({
			band: "massive",
			effort: Effort.Low,
			workerCount: 2,
			capabilityIds: ["subagents"],
		});
		expect(session.getActiveToolNames()).toEqual(beforeTools);
		expect(session.inspectGovernorDecision({ signals: facts })).toContain("Governor decision v1: massive");
		settings.setModelRole("task", `${bundled.provider}/${bundled.id}`);
		expect(session.previewGovernorDecision({ signals: facts, overrides: { role: "task" } })).toMatchObject({
			modelRole: "task",
			model: { provider: bundled.provider, id: bundled.id },
		});
		session.setThinkingLevel(Effort.Low);
		settings.setModelRole("task", `${bundled.provider}/${bundled.id}:off`);
		expect(session.previewGovernorDecision({ signals: facts, overrides: { role: "task" } })?.effort).toBeUndefined();
		cfgPromptCapabilities.set(settings, { subagents: "disabled" });
		expect(session.previewGovernorDecision({ signals: facts })?.workerCount).toBe(0);
		cfgPromptCapabilities.set(settings, {});
		cfgAdaptiveThresholds.set(settings, { massiveMinFiles: 20 });
		expect(
			session.previewGovernorDecision({
				signals: { ...facts, independentTasks: 1 },
			})?.band,
		).toBe("complex");
		expect(() => cfgAdaptiveThresholds.set(settings, { complexMinFiles: 20, massiveMinFiles: 10 })).toThrow();
		await sessionManager.ensureOnDisk();
		const first = session.recordGovernorDecision({ signals: facts }, "initial");
		expect(first).toMatchObject({ revision: 1, decision: { band: "massive" } });
		expect(session.recordGovernorDecision({ signals: facts }, "scope")).toEqual(first);
		const steered = session.recordGovernorDecision({ signals: facts, overrides: { band: "normal" } }, "scope");
		expect(steered).toMatchObject({ revision: 2, trigger: "steering", decision: { band: "normal" } });
		expect(session.recordGovernorDecision({ signals: facts }, "scope")).toEqual(steered);
		const changed = session.recordGovernorDecision(
			{ signals: { ...facts, fileCount: 1, independentTasks: 1, dependencyEdges: 0 }, overrides: {} },
			"scope",
		);
		expect(changed).toMatchObject({ revision: 3, decision: { band: "trivial" } });
		const nextModel = getBundledModel("openai", "gpt-4o");
		if (!nextModel) throw new Error("Expected second bundled test model");
		await session.setModel(nextModel);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 4,
			trigger: "availability",
			decision: { model: { provider: "openai", id: "gpt-4o" } },
		});
		const taskScope = session.recordGovernorDecision({ signals: facts }, "scope");
		expect(taskScope).toMatchObject({ revision: 5, decision: { workerCount: 2 } });
		const enabledTools = session.getEnabledToolNames();
		expect(enabledTools).toContain("task");
		await session.setActiveToolsByName(enabledTools.filter(name => name !== "task"));
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 6,
			trigger: "availability",
			decision: { workerCount: 0 },
		});
		await session.setActiveToolsByName(enabledTools);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 7,
			trigger: "availability",
			decision: { workerCount: 2 },
		});
		cfgTaskMaxConcurrency.set(settings, 1);
		await Bun.sleep(0);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 8,
			trigger: "budget",
			decision: { workerCount: 1 },
		});
		cfgAdaptiveMode.set(settings, "off");
		cfgTaskMaxConcurrency.set(settings, 2);
		await Bun.sleep(0);
		expect(session.getGovernorSnapshot()?.revision).toBe(8);
		cfgAdaptiveMode.set(settings, "inspect");
		await Bun.sleep(0);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 9,
			trigger: "budget",
			decision: { workerCount: 2 },
		});
		await session.setPromptSettingsOverride({ capabilities: { subagents: "disabled" } });
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 10,
			trigger: "availability",
			decision: { workerCount: 0 },
		});
		await session.setPromptSettingsOverride(undefined);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 11,
			trigger: "availability",
			decision: { workerCount: 2 },
		});
		cfgAdaptiveBands.set(settings, { massive: { maxWorkers: 1, contextShare: 0.25 } });
		await Bun.sleep(0);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 12,
			trigger: "budget",
			decision: { workerCount: 1, contextBudgetTokens: Math.floor((session.model?.contextWindow ?? 0) * 0.25) },
		});
		expect(() => cfgAdaptiveBands.set(settings, { trivial: { maxWorkers: 1 } })).toThrow();
		expect(() => cfgAdaptiveBands.set(settings, { massive: { contextShare: 2 } })).toThrow();
	} finally {
		await session.dispose();
		await sessionManager.close();
		authStorage.close();
	}
	const file = sessionManager.getSessionFile();
	if (!file) throw new Error("Expected persisted session file");
	const reopened = await SessionManager.open(file, dir.join("sessions"));
	try {
		expect(latestGovernorSnapshot(reopened)).toMatchObject({ revision: 12, decision: { band: "massive" } });
		reopened.appendCustomEntry("adaptive-governor-decision", { version: 1, revision: 999, decision: { version: 1 } });
		expect(latestGovernorSnapshot(reopened)?.revision).toBe(12);
	} finally {
		await reopened.close();
	}
});
