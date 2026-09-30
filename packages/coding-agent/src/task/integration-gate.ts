import type { SingleResult } from "@oh-my-pi/pi-tui/tools/task";
import { isRecord, untilAborted } from "@oh-my-pi/pi-utils";
import type { GovernorVerificationPolicy } from "../governor/task-batch";

export interface IntegrationWorkerResult {
	result: SingleResult;
	mergeSummary?: string;
	changesApplied?: boolean | null;
}

export interface RepairBudgetLimits {
	maxAttempts: number;
	maxTokens: number;
	maxCostUsd: number;
	maxWallTimeMs: number;
	stagnationLimit: number;
}

export const DEFAULT_REPAIR_BUDGET: RepairBudgetLimits = {
	maxAttempts: 3,
	maxTokens: 50_000,
	maxCostUsd: 1,
	maxWallTimeMs: 120_000,
	stagnationLimit: 2,
};

export interface RepairAttemptRecord {
	attempt: number;
	fingerprint: string;
	failureCount: number;
	progress: "initial" | "improved" | "unchanged" | "regressed";
	verificationLevel?: string;
	tokens: number;
	costUsd: number;
	wallTimeMs: number;
}

function normalizedFailure(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tracks repair attempts and stops retries on repeated failures or exhausted resources. */
export class IntegrationRepairBudget {
	#limits: RepairBudgetLimits;
	#startedAt: number;
	#attempts: RepairAttemptRecord[] = [];
	#tokens = 0;
	#costUsd = 0;
	#wallTimeMs = 0;
	#sameFailureCount = 0;

	constructor(limits: RepairBudgetLimits = DEFAULT_REPAIR_BUDGET, startedAt = Date.now()) {
		this.#limits = limits;
		this.#startedAt = startedAt;
	}

	get attempts(): readonly RepairAttemptRecord[] {
		return this.#attempts;
	}

	get limits(): RepairBudgetLimits {
		return this.#limits;
	}

	get totals(): { attempts: number; tokens: number; costUsd: number; wallTimeMs: number } {
		return {
			attempts: this.#attempts.length,
			tokens: this.#tokens,
			costUsd: this.#costUsd,
			wallTimeMs: Math.max(this.#wallTimeMs, Date.now() - this.#startedAt),
		};
	}

	get remainingWallTimeMs(): number {
		return Math.max(0, this.#limits.maxWallTimeMs - (Date.now() - this.#startedAt));
	}

	record(result: SingleResult, failure?: string): RepairAttemptRecord {
		const data = isRecord(result.structuredOutput?.data) ? result.structuredOutput.data : undefined;
		const checks = Array.isArray(data?.checks) ? data.checks : [];
		const failedChecks = checks.filter(check => isRecord(check) && check.status === "failed");
		const failures = failedChecks
			.map(check => `${String(check.command ?? "")}: ${String(check.result ?? "")}`)
			.map(normalizedFailure)
			.filter(Boolean);
		if (failures.length === 0 && failure) failures.push(normalizedFailure(failure));
		const fingerprint =
			failures.length > 0 ? Bun.SHA256.hash([...new Set(failures)].sort().join("\n"), "hex") : "success";
		const previous = this.#attempts.at(-1);
		const failureCount = failedChecks.length || (failure ? 1 : 0);
		const progress: RepairAttemptRecord["progress"] =
			failureCount === 0
				? "improved"
				: !previous
					? "initial"
					: failureCount < previous.failureCount
						? "improved"
						: failureCount > previous.failureCount
							? "regressed"
							: "unchanged";
		this.#sameFailureCount =
			failureCount === 0 ? 0 : previous?.fingerprint === fingerprint ? this.#sameFailureCount + 1 : 1;
		const costUsd = typeof result.usage?.cost?.total === "number" ? result.usage.cost.total : 0;
		const record: RepairAttemptRecord = {
			attempt: this.#attempts.length + 1,
			fingerprint,
			failureCount,
			progress,
			...(typeof data?.verificationLevel === "string" ? { verificationLevel: data.verificationLevel } : {}),
			tokens: Math.max(0, result.tokens),
			costUsd: Math.max(0, costUsd),
			wallTimeMs: Math.max(0, result.durationMs),
		};
		this.#attempts.push(record);
		this.#tokens += record.tokens;
		this.#costUsd += record.costUsd;
		this.#wallTimeMs += record.wallTimeMs;
		return record;
	}

	stopReason(): string | undefined {
		if (this.#sameFailureCount >= this.#limits.stagnationLimit) return "repeated identical failure";
		if (this.#attempts.length >= this.#limits.maxAttempts) return "attempt budget exhausted";
		if (this.#tokens >= this.#limits.maxTokens) return "token budget exhausted";
		if (this.#costUsd >= this.#limits.maxCostUsd) return "cost budget exhausted";
		if (this.remainingWallTimeMs <= 0 || this.#wallTimeMs >= this.#limits.maxWallTimeMs)
			return "wall-time budget exhausted";
		return undefined;
	}

	summary(): string {
		return this.#attempts
			.map(
				attempt =>
					`Attempt ${attempt.attempt}: ${attempt.failureCount} failure(s), ${attempt.progress}, ${attempt.tokens} tokens, $${attempt.costUsd.toFixed(4)}, ${attempt.wallTimeMs} ms, ${attempt.verificationLevel ?? "verification level unavailable"}`,
			)
			.join("\n");
	}
}

/** Map the gate's required structured outcome to the task's externally visible success state. */
export function integrationGateFailure(result: SingleResult, policy?: GovernorVerificationPolicy): string | undefined {
	const structured = result.structuredOutput;
	if (structured?.status !== "valid" || !isRecord(structured.data)) {
		return `Integration verification did not return a valid structured outcome${structured?.error ? `: ${structured.error}` : "."}`;
	}
	const status = structured.data.status;
	const verificationLevel = structured.data.verificationLevel;
	const checks = structured.data.checks;
	const repairAttempts = structured.data.repairAttempts;
	if (
		typeof structured.data.summary !== "string" ||
		!(["V0", "V1", "V2", "V3", "V4"] as const).includes(verificationLevel as "V0" | "V1" | "V2" | "V3" | "V4") ||
		!Array.isArray(checks) ||
		checks.length === 0 ||
		typeof repairAttempts !== "number" ||
		!Number.isInteger(repairAttempts) ||
		repairAttempts < 0 ||
		repairAttempts > 5
	) {
		return "Integration verification omitted its level or check evidence, or exceeded the repair budget.";
	}
	if (policy) {
		const levels = ["V0", "V1", "V2", "V3", "V4"] as const;
		const actual = levels.indexOf(verificationLevel as (typeof levels)[number]);
		if (actual < levels.indexOf(policy.floor) || actual > levels.indexOf(policy.ceiling)) {
			return `Integration verification level ${verificationLevel} is outside the selected ${policy.floor}–${policy.ceiling} range.`;
		}
	}
	const invalidCheck = checks.find(
		check =>
			!isRecord(check) ||
			typeof check.command !== "string" ||
			(check.status !== "passed" && check.status !== "failed" && check.status !== "skipped") ||
			typeof check.result !== "string",
	);
	if (invalidCheck) return "Integration verification returned malformed check evidence.";
	if (checks.some(check => isRecord(check) && check.status === "failed")) {
		return `Integration verification remains unresolved: ${structured.data.summary}`;
	}
	if (!checks.some(check => isRecord(check) && check.status === "passed")) {
		return "Integration verification did not report a passing unified check.";
	}
	if (status === "unresolved") {
		const summary = typeof structured.data.summary === "string" ? structured.data.summary.trim() : "";
		return `Integration verification remains unresolved${summary ? `: ${summary}` : "."}`;
	}
	if (status !== "verified" && status !== "reconciled") {
		return "Integration verification returned an unknown outcome status.";
	}
	if ((status === "verified" && repairAttempts !== 0) || (status === "reconciled" && repairAttempts < 1)) {
		return "Integration verification status does not match its reported repair attempt count.";
	}
	return undefined;
}

/** Serializes task-batch integration and holds settled worker results for the gate task. */
export class IntegrationGate {
	#order: number[];
	#maxAttempts: number;
	#settled: Map<number, Promise<void>>;
	#resolve: Map<number, () => void>;
	#done = new Set<number>();
	#started = new Map<number, Promise<void>>();
	#startResolve = new Map<number, () => void>();
	#workerResults = new Map<number, IntegrationWorkerResult>();
	#reconciliationAttempts = 0;

	constructor(order: readonly number[], maxAttempts = DEFAULT_REPAIR_BUDGET.maxAttempts) {
		this.#order = [...order];
		this.#maxAttempts = Math.max(1, Math.floor(maxAttempts));
		this.#settled = new Map();
		this.#resolve = new Map();
		for (const index of this.#order) {
			const deferred = Promise.withResolvers<void>();
			this.#settled.set(index, deferred.promise);
			this.#resolve.set(index, deferred.resolve);
			const started = Promise.withResolvers<void>();
			this.#started.set(index, started.promise);
			this.#startResolve.set(index, started.resolve);
		}
	}

	/** Acquire execution slots in integration order so a later merger cannot starve its predecessor. */
	async start(index: number, acquire: () => Promise<void>, signal?: AbortSignal): Promise<void> {
		try {
			const position = this.#order.indexOf(index);
			if (position >= 0) {
				await untilAborted(
					signal,
					Promise.all(this.#order.slice(0, position).map(previous => this.#started.get(previous))),
				);
			}
			await acquire();
		} finally {
			this.#startResolve.get(index)?.();
		}
	}

	async apply<T>(index: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const position = this.#order.indexOf(index);
		if (position < 0) return operation();
		await untilAborted(
			signal,
			Promise.all(this.#order.slice(0, position).map(previous => this.#settled.get(previous))),
		);
		return operation();
	}

	settle(index: number): void {
		if (this.#done.has(index)) return;
		this.#done.add(index);
		this.#resolve.get(index)?.();
		this.#startResolve.get(index)?.();
	}

	recordWorkerResult(index: number, result: IntegrationWorkerResult): void {
		this.#workerResults.set(index, result);
	}

	workerResults(): IntegrationWorkerResult[] {
		return [...this.#workerResults.entries()].sort(([left], [right]) => left - right).map(([, result]) => result);
	}

	reserveReconciliationAttempt(): boolean {
		if (this.#reconciliationAttempts >= this.#maxAttempts) return false;
		this.#reconciliationAttempts++;
		return true;
	}
}

/** Return stable topological order, using task position to break independent ties. */
export function integrationOrder(dependencies: readonly (readonly number[])[]): number[] {
	const remaining = dependencies.map(items => new Set(items));
	const order: number[] = [];
	while (order.length < dependencies.length) {
		const next = remaining.findIndex(
			(items, index) => !order.includes(index) && [...items].every(item => order.includes(item)),
		);
		if (next < 0) return dependencies.map((_, index) => index);
		order.push(next);
	}
	return order;
}
