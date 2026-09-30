import { expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { cfgAdaptiveBands, cfgAdaptiveMode, cfgAdaptiveThresholds } from "@oh-my-pi/pi-coding-agent/governor/settings";
import { latestGovernorSnapshot } from "@oh-my-pi/pi-coding-agent/governor/ledger";
import {
	recentGovernorToolSignals,
	recordGovernorRuntimeSignals,
} from "@oh-my-pi/pi-coding-agent/governor/runtime-signals";
import { cfgPromptCapabilities } from "@oh-my-pi/pi-coding-agent/prompt-engine/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { ASYNC_RESULT_MESSAGE_TYPE } from "@oh-my-pi/pi-coding-agent/session/async-job-delivery";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { cfgTaskMaxConcurrency, cfgTaskMaxEffort } from "@oh-my-pi/pi-coding-agent/task/settings";
import { TempDir } from "@oh-my-pi/pi-utils";

it("counts bounded shell time since the last recorded progress on the current turn", async () => {
	const manager = SessionManager.inMemory();
	try {
		manager.appendMessage({ role: "user", content: [{ type: "text", text: "Investigate" }], timestamp: 1 });
		for (let index = 0; index < 4; index++) {
			manager.appendMessage({
				role: "toolResult",
				toolCallId: `read-${index}`,
				toolName: "read",
				content: [{ type: "text", text: "source" }],
				isError: false,
				timestamp: 2 + index,
			});
		}
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "slow-shell",
			toolName: "bash",
			content: [{ type: "text", text: "done" }],
			details: { wallTimeMs: 130_000 },
			isError: false,
			timestamp: 7,
		});
		expect(recentGovernorToolSignals(manager)).toMatchObject({
			explorationCalls: 4,
			stalledExplorationCalls: 4,
			stalledToolMs: 130_000,
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "edit",
			toolName: "edit",
			content: [{ type: "text", text: "Applied" }],
			details: { path: "src/example.ts" },
			isError: false,
			timestamp: 8,
		});
		expect(recentGovernorToolSignals(manager)).toMatchObject({ stalledExplorationCalls: 0, stalledToolMs: 0 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "slow-again",
			toolName: "bash",
			content: [{ type: "text", text: "done" }],
			details: { wallTimeMs: 700_000 },
			isError: false,
			timestamp: 9,
		});
		expect(recentGovernorToolSignals(manager)).toMatchObject({ stalledExplorationCalls: 0, stalledToolMs: 600_000 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "todo-done",
			toolName: "todo",
			content: [{ type: "text", text: "Completed" }],
			details: { completedTasks: [{ phase: "Work", content: "Fix" }] },
			isError: false,
			timestamp: 10,
		});
		expect(recentGovernorToolSignals(manager)).toMatchObject({ stalledExplorationCalls: 0, stalledToolMs: 0 });
	} finally {
		await manager.close();
	}
});

it("keeps the longest settled task duration across direct and async task results", async () => {
	const manager = SessionManager.inMemory();
	try {
		manager.appendMessage({ role: "user", content: [{ type: "text", text: "Run workers" }], timestamp: 1 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "task-direct",
			toolName: "task",
			content: [{ type: "text", text: "done" }],
			details: { totalDurationMs: 3_000 },
			isError: false,
			timestamp: 2,
		});
		manager.appendCustomMessageEntry(ASYNC_RESULT_MESSAGE_TYPE, "Worker completed", true, {
			jobs: [
				{ jobId: "task-slow", type: "task", durationMs: 8_000 },
				{ jobId: "shell", type: "bash", durationMs: 20_000 },
			],
		});
		expect(recentGovernorToolSignals(manager).longestTaskDurationMs).toBe(8_000);
	} finally {
		await manager.close();
	}
});

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
		expect(() => cfgAdaptiveThresholds.set(settings, { complexMinTasks: 12, massiveMinTasks: 4 })).toThrow();
		expect(() => cfgAdaptiveThresholds.set(settings, { runtimeStagnationMs: 0 })).toThrow();
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

it("revises an inspected decision when the session thinking level changes", async () => {
	using dir = TempDir.createSync("@omp-governor-thinking-");
	const settings = Settings.isolated();
	const bundled = getBundledModel("openai", "gpt-4o-mini");
	if (!bundled) throw new Error("Expected bundled test model");
	const model = {
		...bundled,
		reasoning: true,
		thinking: { mode: "effort" as const, efforts: [Effort.Low, Effort.High] },
	};
	const authStorage = await AuthStorage.create(":memory:");
	authStorage.keys.setRuntime("openai", "test-key");
	const sessionManager = SessionManager.inMemory();
	const { session } = await createAgentSession({
		cwd: dir.join("project"),
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry: new ModelRegistry(authStorage, dir.join("models.yml")),
		settings,
		sessionManager,
		model,
		thinkingLevelCeiling: Effort.High,
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
		cfgAdaptiveMode.set(settings, "inspect");
		session.setThinkingLevel(Effort.Low);
		session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"initial",
		);
		expect(session.getGovernorSnapshot()).toMatchObject({ revision: 1, decision: { effort: Effort.Low } });
		session.setThinkingLevel(Effort.High);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 2,
			trigger: "budget",
			decision: { effort: Effort.High },
		});
	} finally {
		await session.dispose();
		await sessionManager.close();
		authStorage.close();
	}
});

it("tracks structured todo scope without treating todo items as parallel tasks or replacing a task graph", async () => {
	using dir = TempDir.createSync("@omp-governor-todo-");
	const cwd = dir.join("project");
	const settings = Settings.isolated();
	const model = getBundledModel("openai", "gpt-4o-mini");
	if (!model) throw new Error("Expected bundled test model");
	const authStorage = await AuthStorage.create(":memory:");
	authStorage.keys.setRuntime("openai", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, dir.join("models.yml"));
	const sessionManager = SessionManager.inMemory();
	const { session } = await createAgentSession({
		cwd,
		agentDir: dir.join("agent"),
		authStorage,
		modelRegistry,
		settings,
		sessionManager,
		model,
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
		const tasks = Array.from({ length: 4 }, (_, index) => ({ content: `Task ${index}`, status: "pending" as const }));
		session.setTodoPhases([{ name: "Work", tasks }]);
		expect(session.getGovernorSnapshot()).toBeUndefined();
		cfgAdaptiveMode.set(settings, "inspect");
		session.setTodoPhases([{ name: "Work", tasks }]);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 1,
			signalSource: "todo",
			signals: { taskCount: 4, independentTasks: 0 },
			decision: { band: "complex", workerCount: 0 },
		});
		session.setTodoPhases([
			{
				name: "Work",
				tasks: [
					tasks[0]!,
					{ ...tasks[1]!, status: "completed" },
					{ ...tasks[2]!, status: "completed" },
					{ ...tasks[3]!, status: "abandoned" },
				],
			},
		]);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 2,
			signals: { taskCount: 1 },
			decision: { band: "trivial" },
		});
		session.setTodoPhases([{ name: "Work", tasks: tasks.map(task => ({ ...task, status: "completed" as const })) }]);
		expect(session.getGovernorSnapshot()).toMatchObject({
			revision: 3,
			signals: { taskCount: 0 },
			decision: { band: "trivial" },
		});
		await session.routeGovernorTaskTransition(
			{
				facts: {
					files: [],
					tasks: [
						{ id: "a", dependsOn: [] },
						{ id: "b", dependsOn: ["a"] },
						{ id: "c", dependsOn: ["b"] },
						{ id: "d", dependsOn: ["c"] },
					],
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		const graph = session.getGovernorSnapshot();
		expect(graph).toMatchObject({ signalSource: "task_graph", signals: { taskCount: 4, independentTasks: 1 } });
		session.setTodoPhases([{ name: "Work", tasks }]);
		expect(session.getGovernorSnapshot()).toEqual(graph);
		const manual = session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					taskCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"steering",
		);
		expect(manual).toMatchObject({ signalSource: "manual", decision: { band: "trivial" } });
		session.setTodoPhases([{ name: "Work", tasks }]);
		expect(session.getGovernorSnapshot()).toEqual(manual);
		for (let index = 0; index < 16; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `pressure-${index}`,
				toolName: index < 8 ? "read" : "bash",
				content: [{ type: "text", text: "result" }],
				isError: index === 8 || index === 9,
				timestamp: Date.now(),
			});
		}
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()).toMatchObject({
			trigger: "runtime",
			signalSource: "manual",
			signals: { runtime: { completedCalls: 16, explorationCalls: 8, failedCalls: 2 } },
			decision: { band: "complex", workerCount: 0 },
		});
		for (let index = 0; index < 16; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `recovery-${index}`,
				toolName: "bash",
				content: [{ type: "text", text: "result" }],
				isError: false,
				timestamp: Date.now(),
			});
		}
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()).toMatchObject({
			trigger: "runtime",
			signals: { runtime: { completedCalls: 16, explorationCalls: 0, failedCalls: 0 } },
			decision: { band: "trivial" },
		});
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "New task" }],
			timestamp: Date.now(),
		});
		expect(recentGovernorToolSignals(sessionManager)).toEqual({
			completedCalls: 0,
			explorationCalls: 0,
			failedCalls: 0,
			editedFiles: 0,
			verificationFailures: 0,
			failedWorkers: 0,
			failedMutations: 0,
			stalledToolMs: 0,
			stalledExplorationCalls: 0,
		});
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()?.decision.band).toBe("trivial");
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "multi-edit",
			toolName: "edit",
			content: [{ type: "text", text: "Applied" }],
			details: {
				perFileResults: [
					{ path: "src/one.ts" },
					{ path: "src/two.ts", sourcePath: "src/old-two.ts" },
					{ path: "src/three.ts" },
				],
			},
			isError: false,
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "write-edit",
			toolName: "write",
			content: [{ type: "text", text: "Wrote" }],
			details: { resolvedPath: "src/four.ts" },
			isError: false,
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "failed-edit",
			toolName: "edit",
			content: [{ type: "text", text: "Failed" }],
			details: { path: "src/untouched.ts" },
			isError: true,
			timestamp: Date.now(),
		});
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()).toMatchObject({
			trigger: "runtime",
			signals: { runtime: { editedFiles: 5 } },
			decision: { band: "complex" },
		});
		const runtimeGraph = await session.routeGovernorTaskTransition(
			{
				facts: {
					files: ["src/one.ts"],
					tasks: [
						{ id: "one", dependsOn: [] },
						{ id: "two", dependsOn: [] },
						{ id: "three", dependsOn: [] },
					],
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		expect(runtimeGraph.snapshot).toMatchObject({
			signalSource: "task_graph",
			signals: { runtime: { editedFiles: 5 } },
			decision: { band: "complex" },
		});
		cfgAdaptiveMode.set(settings, "auto");
		expect(session.routeGovernorTaskBatch(3)).toBe(2);
		expect(session.getGovernorSnapshot()).toMatchObject({
			signalSource: "task_batch",
			signals: { taskCount: 3, runtime: { editedFiles: 5 } },
			decision: { band: "complex", workerCount: 2 },
		});
		for (let index = 0; index < 16; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `settled-${index}`,
				toolName: "bash",
				content: [{ type: "text", text: "result" }],
				isError: false,
				timestamp: Date.now(),
			});
		}
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()).toMatchObject({
			signals: { runtime: { editedFiles: 0 } },
			decision: { band: "normal" },
		});
		expect(session.routeGovernorTaskBatch(3)).toBeUndefined();
		expect(session.routeGovernorTaskBatch(5)).toBe(4);
		expect(session.getGovernorSnapshot()).toMatchObject({
			signalSource: "task_batch",
			signals: { taskCount: 5, independentTasks: 5 },
			decision: { workerCount: 4 },
		});
		cfgTaskMaxConcurrency.set(settings, 2);
		expect(session.routeGovernorTaskBatch(5)).toBeUndefined();
		expect(session.getGovernorSnapshot()?.decision.workerCount).toBe(2);
		session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					taskCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		for (let index = 0; index < 2; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `check-${index}`,
				toolName: "bash",
				content: [{ type: "text", text: "Check failed" }],
				details: { exitCode: 1, verification: { passed: false } },
				isError: true,
				timestamp: Date.now(),
			});
			recordGovernorRuntimeSignals(session);
			expect(session.getGovernorSnapshot()).toMatchObject({
				trigger: "verification_failure",
				signals: { runtime: { verificationFailures: index + 1 } },
				decision: { band: index === 0 ? "normal" : "complex" },
			});
		}
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "Background task" }],
			timestamp: Date.now(),
		});
		session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					taskCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		for (let index = 0; index < 2; index++) {
			sessionManager.appendCustomMessageEntry(ASYNC_RESULT_MESSAGE_TYPE, "Background jobs settled", true, {
				jobs:
					index === 0
						? [
								{ jobId: "ok", type: "task", status: "completed" },
								{ jobId: "failed", type: "task", status: "failed" },
								{ jobId: "shell", type: "bash", status: "failed" },
							]
						: [{ jobId: "workpool", type: "task", status: "completed", workpoolFailedBatches: 2 }],
			});
			recordGovernorRuntimeSignals(session);
			expect(session.getGovernorSnapshot()).toMatchObject({
				trigger: "runtime",
				signals: { runtime: { failedWorkers: index === 0 ? 1 : 3 } },
				decision: { band: index === 0 ? "normal" : "complex" },
			});
		}
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "Next task" }],
			timestamp: Date.now(),
		});
		session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					taskCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		for (let index = 0; index < 2; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `worker-batch-${index}`,
				toolName: "task",
				content: [{ type: "text", text: "Batch settled" }],
				details: { results: [{ exitCode: 0 }, { exitCode: 1, error: "Worker failed" }] },
				isError: false,
				timestamp: Date.now(),
			});
			recordGovernorRuntimeSignals(session);
			expect(session.getGovernorSnapshot()).toMatchObject({
				trigger: "runtime",
				signals: { runtime: { failedWorkers: index + 1 } },
				decision: { band: index === 0 ? "normal" : "complex" },
			});
		}
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "Fix this file" }],
			timestamp: Date.now(),
		});
		session.recordGovernorDecision(
			{
				signals: {
					fileCount: 1,
					independentTasks: 0,
					dependencyEdges: 0,
					highRisk: false,
					confidence: 0.9,
				},
			},
			"scope",
		);
		for (let index = 0; index < 3; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `failed-edit-${index}`,
				toolName: index === 2 ? "write" : "edit",
				content: [{ type: "text", text: "Mutation failed" }],
				details: { path: "src/example.ts" },
				isError: true,
				timestamp: Date.now(),
			});
			recordGovernorRuntimeSignals(session);
			expect(recentGovernorToolSignals(sessionManager).failedMutations).toBe(index + 1);
			expect(session.getGovernorSnapshot()).toMatchObject({
				decision: { band: index === 0 ? "trivial" : index === 1 ? "normal" : "complex" },
			});
		}
		for (let index = 0; index < 16; index++) {
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: `mutations-recovered-${index}`,
				toolName: "bash",
				content: [{ type: "text", text: "Command succeeded" }],
				isError: false,
				timestamp: Date.now(),
			});
		}
		recordGovernorRuntimeSignals(session);
		expect(session.getGovernorSnapshot()).toMatchObject({
			signals: { runtime: { failedMutations: 0 } },
			decision: { band: "trivial" },
		});
	} finally {
		await session.dispose();
		await sessionManager.close();
		authStorage.close();
	}
});
