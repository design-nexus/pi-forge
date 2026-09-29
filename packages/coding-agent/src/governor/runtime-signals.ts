import type { AgentSession } from "../session/agent-session";
import { ASYNC_RESULT_MESSAGE_TYPE } from "../session/async-job-delivery";
import type { SessionManager } from "../session/session-manager";
import type { GovernorRuntimeSignals } from "./decision";
import { latestGovernorSnapshot, recordGovernorDecision } from "./ledger";
import { cfgAdaptiveMode } from "./settings";

const RECENT_TOOL_RESULT_LIMIT = 16;
const EXPLORATION_TOOLS = new Set(["read", "find", "grep", "glob", "lsp", "ast_grep"]);

function editedPaths(toolName: string, details: unknown): string[] {
	if (!details || typeof details !== "object") return [];
	if (toolName === "write") {
		return "resolvedPath" in details && typeof details.resolvedPath === "string" ? [details.resolvedPath] : [];
	}
	if (toolName !== "edit") return [];
	const files =
		"perFileResults" in details && Array.isArray(details.perFileResults) ? details.perFileResults : [details];
	return files.flatMap(file => {
		if (!file || typeof file !== "object") return [];
		const paths: string[] = [];
		if ("path" in file && typeof file.path === "string") paths.push(file.path);
		if ("sourcePath" in file && typeof file.sourcePath === "string") paths.push(file.sourcePath);
		return paths;
	});
}

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
	return jobs.filter(
		job =>
			job !== null &&
			typeof job === "object" &&
			"type" in job &&
			job.type === "task" &&
			"status" in job &&
			job.status === "failed",
	).length;
}

/** Count settled execution results from the current branch; never infer check failure from shell output. */
export function recentGovernorToolSignals(sessionManager: SessionManager): GovernorRuntimeSignals {
	let completedCalls = 0;
	let explorationCalls = 0;
	let failedCalls = 0;
	let verificationFailures = 0;
	let failedWorkers = 0;
	let failedMutations = 0;
	const editedFiles = new Set<string>();
	for (const entry of sessionManager.getBranch().reverse()) {
		if (entry.type === "custom_message" && entry.customType === ASYNC_RESULT_MESSAGE_TYPE) {
			completedCalls++;
			failedWorkers += failedAsyncWorkerCount(entry.details);
			if (completedCalls === RECENT_TOOL_RESULT_LIMIT) break;
			continue;
		}
		if (entry.type !== "message") continue;
		if (entry.message.role === "user") break;
		if (entry.message.role !== "toolResult") continue;
		if (entry.message.toolName === "todo") continue;
		completedCalls++;
		if (EXPLORATION_TOOLS.has(entry.message.toolName)) explorationCalls++;
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
		if (!entry.message.isError) {
			for (const path of editedPaths(entry.message.toolName, entry.message.details)) editedFiles.add(path);
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
