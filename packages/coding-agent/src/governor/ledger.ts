import type { AgentSession } from "../session/agent-session";
import type { SessionManager } from "../session/session-manager";
import type { GovernorDecision } from "./decision";
import { reviseGovernorDecision, type GovernorRevisionTrigger, type GovernorSnapshot } from "./revision";
import { previewGovernorDecision, type GovernorPreviewRequest } from "./session";

const GOVERNOR_DECISION_ENTRY_TYPE = "adaptive-governor-decision";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGovernorSnapshot(value: unknown): value is GovernorSnapshot {
	if (!isRecord(value) || !isRecord(value.signals) || !isRecord(value.decision)) return false;
	const { signals, decision } = value;
	if (!isRecord(decision.model)) return false;
	return (
		value.version === 1 &&
		typeof value.revision === "number" &&
		Number.isSafeInteger(value.revision) &&
		value.revision > 0 &&
		["initial", "steering", "scope", "runtime", "verification_failure", "availability", "budget"].includes(
			value.trigger as string,
		) &&
		(value.signalSource === undefined ||
			["manual", "todo", "task_graph", "task_batch"].includes(value.signalSource as string)) &&
		[signals.fileCount, signals.independentTasks, signals.dependencyEdges, signals.confidence].every(
			item => typeof item === "number" && Number.isFinite(item),
		) &&
		(signals.taskCount === undefined ||
			(typeof signals.taskCount === "number" &&
				Number.isSafeInteger(signals.taskCount) &&
				signals.taskCount >= 0)) &&
		(signals.runtime === undefined ||
			(isRecord(signals.runtime) &&
				[signals.runtime.completedCalls, signals.runtime.explorationCalls, signals.runtime.failedCalls].every(
					item => typeof item === "number" && Number.isSafeInteger(item) && item >= 0,
				) &&
				(signals.runtime.editedFiles === undefined ||
					(typeof signals.runtime.editedFiles === "number" &&
						Number.isSafeInteger(signals.runtime.editedFiles) &&
						signals.runtime.editedFiles >= 0)) &&
				(signals.runtime.verificationFailures === undefined ||
					(typeof signals.runtime.verificationFailures === "number" &&
						Number.isSafeInteger(signals.runtime.verificationFailures) &&
						signals.runtime.verificationFailures >= 0)) &&
				(signals.runtime.failedWorkers === undefined ||
					(typeof signals.runtime.failedWorkers === "number" &&
						Number.isSafeInteger(signals.runtime.failedWorkers) &&
						signals.runtime.failedWorkers >= 0)) &&
				(signals.runtime.failedMutations === undefined ||
					(typeof signals.runtime.failedMutations === "number" &&
						Number.isSafeInteger(signals.runtime.failedMutations) &&
						signals.runtime.failedMutations >= 0)))) &&
		typeof signals.highRisk === "boolean" &&
		(value.overrides === undefined || isRecord(value.overrides)) &&
		decision.version === 1 &&
		["trivial", "normal", "complex", "massive"].includes(decision.band as string) &&
		typeof decision.workerCount === "number" &&
		Number.isSafeInteger(decision.workerCount) &&
		typeof decision.model.provider === "string" &&
		typeof decision.model.id === "string" &&
		Array.isArray(decision.capabilityIds) &&
		Array.isArray(decision.evidence) &&
		Array.isArray(decision.clamps)
	);
}

export function latestGovernorSnapshot(sessionManager: SessionManager): GovernorSnapshot | undefined {
	for (const entry of sessionManager.getBranch().reverse()) {
		if (entry.type !== "custom" || entry.customType !== GOVERNOR_DECISION_ENTRY_TYPE) continue;
		if (isGovernorSnapshot(entry.data)) return entry.data;
	}
	return undefined;
}

/** Persist only material policy revisions in the existing session branch. */
export function recordGovernorDecision(
	session: AgentSession,
	request: GovernorPreviewRequest,
	trigger: GovernorRevisionTrigger,
	signalSource?: GovernorSnapshot["signalSource"],
): GovernorSnapshot | undefined {
	const previous = latestGovernorSnapshot(session.sessionManager);
	const overrides = request.overrides === undefined ? previous?.overrides : request.overrides;
	const decision: GovernorDecision | undefined = previewGovernorDecision(session, { ...request, overrides });
	if (!decision) return undefined;
	const revisionTrigger =
		trigger === "scope" && request.overrides && Object.keys(request.overrides).length > 0 ? "steering" : trigger;
	const revision = reviseGovernorDecision(
		previous,
		decision,
		request.signals,
		revisionTrigger,
		overrides,
		signalSource ?? previous?.signalSource,
	);
	if (!revision) return previous;
	session.sessionManager.appendCustomEntry(GOVERNOR_DECISION_ENTRY_TYPE, revision);
	return revision;
}
