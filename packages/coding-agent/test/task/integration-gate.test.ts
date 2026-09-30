import { describe, expect, it } from "bun:test";
import {
	IntegrationGate,
	IntegrationRepairBudget,
	integrationGateFailure,
	integrationOrder,
} from "../../src/task/integration-gate";
import type { SingleResult } from "@oh-my-pi/pi-tui/tools/task";

function result(status: "valid" | "invalid", data?: unknown): SingleResult {
	return {
		index: 1,
		id: "integration",
		agent: "task",
		agentSource: "bundled",
		task: "integration gate",
		exitCode: 0,
		output: "",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 1,
		structuredOutput: { source: "caller", mode: "strict", status, ...(data ? { data } : {}) },
	};
}

describe("task integration gate", () => {
	it("keeps prerequisite tasks ahead of dependents and stable ordering for siblings", () => {
		expect(integrationOrder([[], [2], [], [0, 1]])).toEqual([0, 2, 1, 3]);
	});

	it("applies completed worker output in task order, not completion order", async () => {
		const gate = new IntegrationGate([0, 1]);
		const applied: string[] = [];
		const later = gate.apply(1, async () => {
			applied.push("later");
		});
		await Bun.sleep(0);
		expect(applied).toEqual([]);
		await gate.apply(0, async () => {
			applied.push("earlier");
		});
		gate.settle(0);
		await later;
		expect(applied).toEqual(["earlier", "later"]);
	});

	it("releases later work after an earlier worker fails before integration", async () => {
		const gate = new IntegrationGate([0, 1]);
		gate.settle(0);
		const applied: string[] = [];
		await gate.apply(1, async () => {
			applied.push("remaining worker");
		});
		expect(applied).toEqual(["remaining worker"]);
	});

	it("admits only the configured number of repair attempts", () => {
		const gate = new IntegrationGate([0, 1], 2);
		expect(gate.reserveReconciliationAttempt()).toBe(true);
		expect(gate.reserveReconciliationAttempt()).toBe(true);
		expect(gate.reserveReconciliationAttempt()).toBe(false);
	});

	it("stops repeated identical failures while allowing a converging failure set to continue", () => {
		const budget = new IntegrationRepairBudget({
			maxAttempts: 3,
			maxTokens: 50_000,
			maxCostUsd: 1,
			maxWallTimeMs: 60_000,
			stagnationLimit: 2,
		});
		const repeatedFailure = result("valid", {
			status: "unresolved",
			summary: "type check failed",
			verificationLevel: "V1",
			checks: [{ command: "bun check", status: "failed", result: "type mismatch at src/a.ts:12" }],
			files: [],
			repairAttempts: 0,
		});
		budget.record(repeatedFailure, "type check failed");
		expect(budget.stopReason()).toBeUndefined();
		budget.record(repeatedFailure, "type check failed");
		expect(budget.stopReason()).toBe("repeated identical failure");

		const converging = new IntegrationRepairBudget({
			maxAttempts: 3,
			maxTokens: 50_000,
			maxCostUsd: 1,
			maxWallTimeMs: 60_000,
			stagnationLimit: 2,
		});
		const first = result("valid", {
			status: "unresolved",
			summary: "two checks failed",
			verificationLevel: "V1",
			checks: [
				{ command: "bun check", status: "failed", result: "type mismatch" },
				{ command: "bun test", status: "failed", result: "assertion mismatch" },
			],
			files: [],
			repairAttempts: 0,
		});
		const second = result("valid", {
			status: "unresolved",
			summary: "one check failed",
			verificationLevel: "V1",
			checks: [{ command: "bun test", status: "failed", result: "assertion mismatch" }],
			files: [],
			repairAttempts: 0,
		});
		converging.record(first, "two checks failed");
		expect(converging.record(second, "one check failed").progress).toBe("improved");
		expect(converging.stopReason()).toBeUndefined();
	});

	it("stops before another attempt when cumulative token use reaches its budget", () => {
		const budget = new IntegrationRepairBudget({
			maxAttempts: 3,
			maxTokens: 10,
			maxCostUsd: 1,
			maxWallTimeMs: 60_000,
			stagnationLimit: 3,
		});
		budget.record({ ...result("valid"), tokens: 10 }, "check failed");
		expect(budget.stopReason()).toBe("token budget exhausted");
		expect(budget.totals).toMatchObject({ attempts: 1, tokens: 10 });
	});

	it("reports unresolved or malformed verification as a task failure", () => {
		expect(
			integrationGateFailure(
				result("valid", {
					status: "unresolved",
					summary: "typecheck still fails",
					verificationLevel: "V1",
					checks: [{ command: "bun check", status: "failed", result: "type error" }],
					files: ["src/a.ts"],
					repairAttempts: 1,
				}),
			),
		).toContain("typecheck still fails");
		expect(integrationGateFailure(result("invalid"))).toContain("valid structured outcome");
	});

	it("accepts verified and reconciled outcomes only after structured validation", () => {
		expect(
			integrationGateFailure(
				result("valid", {
					status: "verified",
					summary: "checks pass",
					verificationLevel: "V1",
					checks: [{ command: "bun test", status: "passed", result: "18 tests passed" }],
					files: [],
					repairAttempts: 0,
				}),
			),
		).toBe(undefined);
		expect(
			integrationGateFailure(
				result("valid", {
					status: "reconciled",
					summary: "compatibility fixed",
					verificationLevel: "V2",
					checks: [{ command: "bun check", status: "passed", result: "checks passed" }],
					files: ["src/a.ts"],
					repairAttempts: 1,
				}),
			),
		).toBeUndefined();
	});

	it("rejects a reported level outside the Governor-selected operator range", () => {
		const policy = { strategy: "targeted_checks", floor: "V2", ceiling: "V3" } as const;
		expect(
			integrationGateFailure(
				result("valid", {
					status: "verified",
					summary: "focused test passed",
					verificationLevel: "V1",
					checks: [{ command: "bun test focused.test.ts", status: "passed", result: "passed" }],
					files: [],
					repairAttempts: 0,
				}),
				policy,
			),
		).toContain("outside the selected V2–V3 range");
		expect(
			integrationGateFailure(
				result("valid", {
					status: "verified",
					summary: "package tests passed",
					verificationLevel: "V2",
					checks: [{ command: "bun test", status: "passed", result: "passed" }],
					files: [],
					repairAttempts: 0,
				}),
				policy,
			),
		).toBeUndefined();
	});
});
