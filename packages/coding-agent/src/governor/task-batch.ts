import type { AgentSession } from "../session/agent-session";
import { THINKING_EFFORTS } from "@oh-my-pi/pi-catalog/effort";
import type { TaskEffort } from "@oh-my-pi/pi-tui/thinking";
import { cfgTaskMaxConcurrency } from "../task/settings";
import { recordGovernorDecision } from "./ledger";
import { recentGovernorToolSignals } from "./runtime-signals";
import { cfgAdaptiveMode } from "./settings";
import type { GovernorDecision, VerificationLevel } from "./decision";

export interface GovernorVerificationPolicy {
	strategy: GovernorDecision["verification"];
	floor: VerificationLevel;
	ceiling: VerificationLevel;
}

export interface GovernorTaskPlan {
	workerCount?: number;
	modelRole?: string;
	effort?: TaskEffort;
	verification?: GovernorVerificationPolicy;
	reviewer?: GovernorDecision["reviewer"];
}

/** Bind one concrete task scope to a Governor decision for worker and review handoff. */
export function routeGovernorTaskPlan(
	session: AgentSession,
	taskCount: number,
	highRisk = false,
): GovernorTaskPlan | undefined {
	if (cfgAdaptiveMode.get(session.settings) !== "auto" || taskCount < 1) return undefined;
	const snapshot = recordGovernorDecision(
		session,
		{
			signals: {
				fileCount: 0,
				taskCount,
				independentTasks: taskCount,
				dependencyEdges: 0,
				highRisk,
				confidence: 0.9,
				runtime: recentGovernorToolSignals(session.sessionManager),
			},
		},
		"scope",
		"task_batch",
	);
	const workers = snapshot?.decision.workerCount ?? 0;
	const effortIndex = snapshot?.decision.effort ? THINKING_EFFORTS.indexOf(snapshot.decision.effort) : -1;
	const effort: TaskEffort | undefined =
		effortIndex < 0 ? undefined : effortIndex <= 1 ? "lo" : effortIndex <= 3 ? "med" : "hi";
	return {
		...(session.settings.getProvenance(cfgTaskMaxConcurrency) === "default" && workers > 1
			? { workerCount: workers }
			: {}),
		...(effort ? { effort } : {}),
		...(snapshot && snapshot.decision.modelRole !== "current" ? { modelRole: snapshot.decision.modelRole } : {}),
		...(snapshot
			? {
					verification: {
						strategy: snapshot.decision.verification,
						floor: snapshot.decision.verificationFloor,
						ceiling: snapshot.decision.verificationCeiling,
					},
				}
			: {}),
		...(snapshot ? { reviewer: snapshot.decision.reviewer } : {}),
	};
}

export function routeGovernorTaskBatch(session: AgentSession, taskCount: number, highRisk = false): number | undefined {
	if (taskCount < 2) return undefined;
	return routeGovernorTaskPlan(session, taskCount, highRisk)?.workerCount;
}
