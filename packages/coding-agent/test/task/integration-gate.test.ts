import { describe, expect, it } from "bun:test";
import { IntegrationGate, integrationGateFailure, integrationOrder } from "../../src/task/integration-gate";
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

	it("admits exactly one bounded reconciliation attempt", () => {
		const gate = new IntegrationGate([0, 1]);
		expect(gate.reserveReconciliationAttempt()).toBe(true);
		expect(gate.reserveReconciliationAttempt()).toBe(false);
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
