import { expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgAdaptiveMode, cfgAdaptiveThresholds } from "@oh-my-pi/pi-coding-agent/governor/settings";
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
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager: SessionManager.inMemory(cwd),
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
	} finally {
		await session.dispose();
		authStorage.close();
	}
});
