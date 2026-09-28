import { expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { Model } from "@oh-my-pi/pi-catalog/types";
import { decideGovernor, type GovernorDecisionInput } from "@oh-my-pi/pi-coding-agent/governor/decision";

const bundled = getBundledModel("openai", "gpt-4o-mini");
if (!bundled) throw new Error("Expected bundled test model");
const model: Model = {
	...bundled,
	reasoning: true,
	thinking: { mode: "effort", efforts: [Effort.Low, Effort.Medium, Effort.High] },
};

function decisionInput(overrides: Partial<GovernorDecisionInput> = {}): GovernorDecisionInput {
	return {
		enabled: true,
		signals: { fileCount: 1, independentTasks: 1, dependencyEdges: 0, highRisk: false, confidence: 0.9 },
		current: { role: "default", model, effort: Effort.Medium },
		ceilings: { sessionEffort: Effort.High, taskMaxEffort: Effort.High, taskMaxConcurrency: 4 },
		capabilities: { subagentsAllowed: true, taskToolAvailable: true },
		contextWindowTokens: 100_000,
		...overrides,
	};
}

it.each([
	["trivial", 1, 1, 0, "direct", 0, "none"],
	["normal", 3, 1, 0, "direct", 0, "brief"],
	["complex", 6, 2, 1, "parallel", 2, "milestones"],
	["massive", 14, 5, 3, "parallel", 4, "dependency_graph"],
] as const)("routes %s scope through a bounded policy", (band, files, tasks, edges, mode, workers, planning) => {
	const decision = decideGovernor(
		decisionInput({
			signals: {
				fileCount: files,
				independentTasks: tasks,
				dependencyEdges: edges,
				highRisk: false,
				confidence: 0.9,
			},
		}),
	);
	expect(decision?.band).toBe(band);
	expect(decision?.executionMode).toBe(mode);
	expect(decision?.workerCount).toBe(workers);
	expect(decision?.planningDepth).toBe(planning);
	expect(decision?.capabilityIds).toEqual(workers > 0 ? ["subagents"] : []);
});

it("uses a reversible normal workflow when classification confidence is low", () => {
	const decision = decideGovernor(
		decisionInput({
			signals: { fileCount: 20, independentTasks: 6, dependencyEdges: 4, highRisk: true, confidence: 0.3 },
		}),
	);
	expect(decision).toMatchObject({ band: "normal", workerCount: 0, planningDepth: "brief" });
	expect(decision?.evidence).toContain("low confidence fallback");
});

it("honors explicit band and role while clamping effort and workers to OMP ceilings", () => {
	const requestedModel = { ...model, id: "resolved-role-model" };
	const decision = decideGovernor(
		decisionInput({
			signals: { fileCount: 1, independentTasks: 5, dependencyEdges: 0, highRisk: false, confidence: 0.2 },
			availableRoles: { task: { model: requestedModel } },
			overrides: { band: "massive", role: "task", effort: Effort.High, workerCount: 5, maxWorkers: 3 },
			ceilings: { sessionEffort: Effort.Medium, taskMaxEffort: Effort.Low, taskMaxConcurrency: 2 },
		}),
	);
	expect(decision).toMatchObject({
		band: "massive",
		modelRole: "task",
		model: { provider: requestedModel.provider, id: requestedModel.id },
		effort: Effort.Low,
		workerCount: 2,
	});
	expect(decision?.clamps).toContain("effort clamped to low");
	expect(decision?.clamps).toContain("worker count clamped by policy, availability, or concurrency ceiling");
});

it("keeps the current model and one-agent workflow when requested resources are unavailable", () => {
	const decision = decideGovernor(
		decisionInput({
			signals: { fileCount: 14, independentTasks: 4, dependencyEdges: 1, highRisk: false, confidence: 0.9 },
			overrides: { role: "unconfigured", workerCount: 4 },
			capabilities: { subagentsAllowed: false, taskToolAvailable: true },
		}),
	);
	expect(decision).toMatchObject({
		modelRole: "default",
		model: { provider: model.provider, id: model.id },
		workerCount: 0,
		executionMode: "planned",
	});
	expect(decision?.clamps).toContain("role unconfigured unavailable; current model retained");
});

it("prefers a pinned authorized role and applies the session effort ceiling", () => {
	const pinnedModel = { ...model, id: "pinned-role-model", contextWindow: 8_000 };
	const decision = decideGovernor(
		decisionInput({
			availableRoles: {
				pinned: { model: pinnedModel },
				task: { model: { ...model, id: "other-role-model" } },
			},
			overrides: { pinnedRole: "pinned", role: "task", effort: Effort.High },
			ceilings: { sessionEffort: Effort.Medium, taskMaxEffort: Effort.High, taskMaxConcurrency: 0 },
		}),
	);
	expect(decision).toMatchObject({
		modelRole: "pinned",
		model: { provider: pinnedModel.provider, id: pinnedModel.id },
		effort: Effort.Medium,
		contextBudgetTokens: 800,
	});
	expect(decision?.clamps).toContain("effort clamped to medium");
});

it("treats OMP's zero concurrency limit as unlimited while retaining the policy cap", () => {
	const decision = decideGovernor(
		decisionInput({
			signals: { fileCount: 14, independentTasks: 6, dependencyEdges: 1, highRisk: false, confidence: 0.9 },
			ceilings: { sessionEffort: Effort.High, taskMaxEffort: Effort.High, taskMaxConcurrency: 0 },
		}),
	);
	expect(decision?.workerCount).toBe(4);
	expect(decision?.executionMode).toBe("parallel");
});

it("preserves defaults when adaptive policy is off and does not invent unsupported effort", () => {
	expect(decideGovernor(decisionInput({ enabled: false }))).toBeUndefined();
	const noTools = { ...model, supportsTools: false, reasoning: false, thinking: undefined };
	const decision = decideGovernor(
		decisionInput({
			current: { role: "default", model: noTools },
			overrides: { band: "massive", effort: Effort.High, workerCount: 3 },
			signals: { fileCount: 14, independentTasks: 3, dependencyEdges: 1, highRisk: false, confidence: 0.9 },
		}),
	);
	expect(decision).toMatchObject({ effort: undefined, workerCount: 0 });
	expect(decision?.clamps).toContain("requested effort unavailable");
});
