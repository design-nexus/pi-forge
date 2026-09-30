import type { AgentSession } from "../session/agent-session";
import { ASYNC_RESULT_MESSAGE_TYPE } from "../session/async-job-delivery";
import type { SessionManager } from "../session/session-manager";
import { toolResultPaths } from "../session/tool-result-paths";
import type { GovernorRuntimeSignals } from "./decision";
import { latestGovernorSnapshot, recordGovernorDecision } from "./ledger";
import { cfgAdaptiveMode } from "./settings";

const RECENT_TOOL_RESULT_LIMIT = 16;
const MAX_STALLED_TOOL_MS = 600_000;
const EXPLORATION_TOOLS = new Set(["read", "find", "grep", "glob", "lsp", "ast_grep"]);

function failedWorkerCount(toolName: string, details: unknown): number {
	if (toolName !== "task" || !details || typeof details !== "object") return 0;
	if (!("results" in details) || !Array.isArray(details.results)) return 0;
	const results: readonly unknown[] = details.results;
	return results.filter(result => {
		if (!result || typeof result !== "object") return false;
		return (
			("exitCode" in result && typeof result.exitCode === "number" && result.exitCode !== 0) ||
			("aborted" in result && result.aborted === true) ||
			("error" in result && typeof result.error === "string" && result.error.length > 0)
		);
	}).length;
}

function failedAsyncWorkerCount(details: unknown): number {
	if (!details || typeof details !== "object" || !("jobs" in details) || !Array.isArray(details.jobs)) return 0;
	const jobs: readonly unknown[] = details.jobs;
	return jobs.reduce<number>((total, job) => {
		if (!job || typeof job !== "object" || !("type" in job) || job.type !== "task") return total;
		const failedJob = "status" in job && job.status === "failed" ? 1 : 0;
		const failedBatches =
			"workpoolFailedBatches" in job &&
			typeof job.workpoolFailedBatches === "number" &&
			Number.isSafeInteger(job.workpoolFailedBatches) &&
			job.workpoolFailedBatches >= 0
				? job.workpoolFailedBatches
				: 0;
		return Math.min(RECENT_TOOL_RESULT_LIMIT, total + Math.max(failedJob, failedBatches));
	}, 0);
}

function longestTaskDuration(details: unknown): number {
	if (!details || typeof details !== "object") return 0;
	if ("totalDurationMs" in details && typeof details.totalDurationMs === "number") {
		return Number.isFinite(details.totalDurationMs) && details.totalDurationMs > 0
			? Math.ceil(details.totalDurationMs)
			: 0;
	}
	if (!("jobs" in details) || !Array.isArray(details.jobs)) return 0;
	return details.jobs.reduce<number>((longest, job) => {
		if (!job || typeof job !== "object" || !("type" in job) || job.type !== "task") return longest;
		if (!("durationMs" in job) || typeof job.durationMs !== "number" || !Number.isFinite(job.durationMs))
			return longest;
		return Math.max(longest, Math.ceil(job.durationMs));
	}, 0);
}

/** Count settled execution results from the current branch; never infer check failure from shell output. */
export function recentGovernorToolSignals(sessionManager: SessionManager): GovernorRuntimeSignals {
	let completedCalls = 0;
	let explorationCalls = 0;
	let failedCalls = 0;
	let verificationFailures = 0;
	let failedWorkers = 0;
	let failedMutations = 0;
	let stalledToolMs = 0;
	let stalledExplorationCalls = 0;
	let longestTaskDurationMs = 0;
	let progressSeen = false;
	const editedFiles = new Set<string>();
	for (const entry of sessionManager.getBranch().reverse()) {
		if (entry.type === "custom_message" && entry.customType === ASYNC_RESULT_MESSAGE_TYPE) {
			completedCalls++;
			failedWorkers += failedAsyncWorkerCount(entry.details);
			longestTaskDurationMs = Math.max(longestTaskDurationMs, longestTaskDuration(entry.details));
			if (completedCalls === RECENT_TOOL_RESULT_LIMIT) break;
			continue;
		}
		if (entry.type !== "message") continue;
		if (entry.message.role === "user") break;
		if (entry.message.role !== "toolResult") continue;
		if (entry.message.toolName === "todo") {
			const details = entry.message.details;
			if (
				!entry.message.isError &&
				details &&
				typeof details === "object" &&
				"completedTasks" in details &&
				Array.isArray(details.completedTasks) &&
				details.completedTasks.length > 0
			)
				progressSeen = true;
			continue;
		}
		completedCalls++;
		if (entry.message.toolName === "task") {
			longestTaskDurationMs = Math.max(longestTaskDurationMs, longestTaskDuration(entry.message.details));
		}
		const details = entry.message.details;
		const verification =
			details && typeof details === "object" && "verification" in details ? details.verification : undefined;
		const passedVerification =
			verification && typeof verification === "object" && "passed" in verification && verification.passed === true;
		if (
			!entry.message.isError &&
			(entry.message.toolName === "edit" || entry.message.toolName === "write" || passedVerification)
		)
			progressSeen = true;
		if (
			!progressSeen &&
			entry.message.toolName === "bash" &&
			details &&
			typeof details === "object" &&
			"wallTimeMs" in details &&
			typeof details.wallTimeMs === "number" &&
			Number.isFinite(details.wallTimeMs) &&
			details.wallTimeMs > 0
		)
			stalledToolMs = Math.min(MAX_STALLED_TOOL_MS, stalledToolMs + Math.ceil(details.wallTimeMs));
		if (EXPLORATION_TOOLS.has(entry.message.toolName)) {
			explorationCalls++;
			if (!progressSeen) stalledExplorationCalls++;
		}
		failedWorkers += failedWorkerCount(entry.message.toolName, entry.message.details);
		if (entry.message.isError) failedCalls++;
		if (entry.message.isError && (entry.message.toolName === "edit" || entry.message.toolName === "write"))
			failedMutations++;
		if (
			entry.message.toolName === "bash" &&
			entry.message.details &&
			typeof entry.message.details === "object" &&
			"verification" in entry.message.details &&
			entry.message.details.verification &&
			typeof entry.message.details.verification === "object" &&
			"passed" in entry.message.details.verification &&
			entry.message.details.verification.passed === false
		)
			verificationFailures++;
		if (!entry.message.isError && (entry.message.toolName === "edit" || entry.message.toolName === "write")) {
			for (const path of toolResultPaths(entry.message.toolName, entry.message.details)) editedFiles.add(path);
		}
		if (completedCalls === RECENT_TOOL_RESULT_LIMIT) break;
	}
	return {
		completedCalls,
		explorationCalls,
		failedCalls,
		editedFiles: editedFiles.size,
		verificationFailures,
		failedWorkers,
		failedMutations,
		stalledToolMs,
		stalledExplorationCalls,
		...(longestTaskDurationMs > 0 ? { longestTaskDurationMs } : {}),
	};
}

/** Revise an existing decision after a persisted tool result changes recent pressure. */
export function recordGovernorRuntimeSignals(session: AgentSession): void {
	if (cfgAdaptiveMode.get(session.settings) === "off") return;
	const previous = latestGovernorSnapshot(session.sessionManager);
	if (!previous) return;
	const runtime = recentGovernorToolSignals(session.sessionManager);
	if (Bun.deepEquals(previous.signals.runtime, runtime)) return;
	const trigger = verificationFailuresIncreased(runtime, previous.signals.runtime)
		? "verification_failure"
		: "runtime";
	recordGovernorDecision(session, { signals: { ...previous.signals, runtime } }, trigger);
}

function verificationFailuresIncreased(
	current: GovernorRuntimeSignals,
	previous: GovernorRuntimeSignals | undefined,
): boolean {
	return (current.verificationFailures ?? 0) > (previous?.verificationFailures ?? 0);
}
