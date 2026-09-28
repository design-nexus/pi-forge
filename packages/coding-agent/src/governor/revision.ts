import type { GovernorDecision, GovernorDecisionInput } from "./decision";

export type GovernorRevisionTrigger =
	| "initial"
	| "steering"
	| "scope"
	| "verification_failure"
	| "availability"
	| "budget";

export interface GovernorSnapshot {
	version: 1;
	revision: number;
	trigger: GovernorRevisionTrigger;
	signals: GovernorDecisionInput["signals"];
	overrides?: GovernorDecisionInput["overrides"];
	decision: GovernorDecision;
}

function samePolicy(left: GovernorDecision, right: GovernorDecision): boolean {
	return Bun.deepEquals(
		{ ...left, confidence: 0, evidence: [], clamps: [] },
		{ ...right, confidence: 0, evidence: [], clamps: [] },
	);
}

/** A one-file threshold crossing alone does not change the committed policy. */
function nearScopeBoundary(previous: GovernorSnapshot, signals: GovernorDecisionInput["signals"]): boolean {
	return (
		Math.abs(signals.fileCount - previous.signals.fileCount) < 2 &&
		signals.independentTasks === previous.signals.independentTasks &&
		signals.dependencyEdges === previous.signals.dependencyEdges &&
		signals.highRisk === previous.signals.highRisk
	);
}

/** Revisions are deterministic for a previous snapshot, candidate, and trigger. */
export function reviseGovernorDecision(
	previous: GovernorSnapshot | undefined,
	decision: GovernorDecision,
	signals: GovernorDecisionInput["signals"],
	trigger: GovernorRevisionTrigger,
	overrides?: GovernorDecisionInput["overrides"],
): GovernorSnapshot | undefined {
	const overridesChanged = !Bun.deepEquals(previous?.overrides, overrides);
	if (previous && samePolicy(previous.decision, decision) && !overridesChanged) return undefined;
	if (
		previous &&
		trigger === "scope" &&
		!overridesChanged &&
		previous.decision.band !== decision.band &&
		nearScopeBoundary(previous, signals)
	)
		return undefined;
	return {
		version: 1,
		revision: (previous?.revision ?? 0) + 1,
		trigger,
		signals: { ...signals },
		overrides: overrides ? { ...overrides } : undefined,
		decision,
	};
}
