import { expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { decideGovernor, type GovernorDecisionInput } from "@oh-my-pi/pi-coding-agent/governor/decision";
import { reviseGovernorDecision } from "@oh-my-pi/pi-coding-agent/governor/revision";

const model = getBundledModel("openai", "gpt-4o-mini");
if (!model) throw new Error("Expected bundled test model");

function candidate(fileCount: number, taskMaxConcurrency = 4) {
	const signals = { fileCount, independentTasks: 1, dependencyEdges: 0, highRisk: false, confidence: 0.9 };
	const input: GovernorDecisionInput = {
		enabled: true,
		signals,
		current: { role: "current", model, effort: Effort.Low },
		ceilings: { taskMaxConcurrency },
		capabilities: { subagentsAllowed: true, taskToolAvailable: true },
		contextWindowTokens: 10_000,
	};
	const decision = decideGovernor(input);
	if (!decision) throw new Error("Expected enabled decision");
	return { decision, signals };
}

it("retains a committed band at a one-file boundary and revises after a material scope change", () => {
	const initial = candidate(4);
	const first = reviseGovernorDecision(undefined, initial.decision, initial.signals, "initial");
	if (!first) throw new Error("Expected initial snapshot");
	const boundary = candidate(5);
	expect(reviseGovernorDecision(first, boundary.decision, boundary.signals, "scope")).toBeUndefined();
	const expanded = candidate(6);
	const second = reviseGovernorDecision(first, expanded.decision, expanded.signals, "scope");
	expect(second).toMatchObject({ revision: 2, trigger: "scope", decision: { band: "complex" } });
	if (!second) throw new Error("Expected revised snapshot");
	expect(reviseGovernorDecision(second, expanded.decision, expanded.signals, "scope")).toBeUndefined();
	const steering = reviseGovernorDecision(first, boundary.decision, boundary.signals, "steering");
	expect(steering).toMatchObject({ revision: 2, trigger: "steering", decision: { band: "complex" } });
});
