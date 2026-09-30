import type { SingleResult } from "@oh-my-pi/pi-tui/tools/task";
import { isRecord } from "@oh-my-pi/pi-utils";

export interface IntegrationWorkerResult {
	result: SingleResult;
	mergeSummary?: string;
	changesApplied?: boolean | null;
}

/** Map the gate's required structured outcome to the task's externally visible success state. */
export function integrationGateFailure(result: SingleResult): string | undefined {
	const structured = result.structuredOutput;
	if (structured?.status !== "valid" || !isRecord(structured.data)) {
		return `Integration verification did not return a valid structured outcome${structured?.error ? `: ${structured.error}` : "."}`;
	}
	const status = structured.data.status;
	const checks = structured.data.checks;
	const repairAttempts = structured.data.repairAttempts;
	if (
		typeof structured.data.summary !== "string" ||
		!Array.isArray(checks) ||
		checks.length === 0 ||
		typeof repairAttempts !== "number" ||
		!Number.isInteger(repairAttempts) ||
		repairAttempts < 0 ||
		repairAttempts > 1
	) {
		return "Integration verification omitted check evidence or exceeded its one-attempt repair budget.";
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
	if ((status === "verified" && repairAttempts !== 0) || (status === "reconciled" && repairAttempts !== 1)) {
		return "Integration verification status does not match its reported repair attempt count.";
	}
	return undefined;
}

/** Serializes task-batch integration and holds settled worker results for the gate task. */
export class IntegrationGate {
	#order: number[];
	#settled: Map<number, Promise<void>>;
	#resolve: Map<number, () => void>;
	#done = new Set<number>();
	#workerResults = new Map<number, IntegrationWorkerResult>();
	#reconciliationAttempted = false;

	constructor(order: readonly number[]) {
		this.#order = [...order];
		this.#settled = new Map();
		this.#resolve = new Map();
		for (const index of this.#order) {
			const deferred = Promise.withResolvers<void>();
			this.#settled.set(index, deferred.promise);
			this.#resolve.set(index, deferred.resolve);
		}
	}

	async apply<T>(index: number, operation: () => Promise<T>): Promise<T> {
		const position = this.#order.indexOf(index);
		if (position < 0) return operation();
		await Promise.all(this.#order.slice(0, position).map(previous => this.#settled.get(previous)));
		return operation();
	}

	settle(index: number): void {
		if (this.#done.has(index)) return;
		this.#done.add(index);
		this.#resolve.get(index)?.();
	}

	recordWorkerResult(index: number, result: IntegrationWorkerResult): void {
		this.#workerResults.set(index, result);
	}

	workerResults(): IntegrationWorkerResult[] {
		return [...this.#workerResults.entries()].sort(([left], [right]) => left - right).map(([, result]) => result);
	}

	reserveReconciliationAttempt(): boolean {
		if (this.#reconciliationAttempted) return false;
		this.#reconciliationAttempted = true;
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
