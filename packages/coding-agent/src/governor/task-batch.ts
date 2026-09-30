import type { AgentSession } from "../session/agent-session";
import { THINKING_EFFORTS } from "@oh-my-pi/pi-catalog/effort";
import type { TaskEffort } from "@oh-my-pi/pi-tui/thinking";
import { cfgTaskMaxConcurrency } from "../task/settings";
import { recordGovernorDecision } from "./ledger";
import { recentGovernorToolSignals } from "./runtime-signals";
import { cfgAdaptiveMode } from "./settings";

export interface GovernorTaskPlan {
	workerCount?: number;
	effort?: TaskEffort;
}

/** Bind one concrete independent task batch to a Governor decision. */
export function routeGovernorTaskPlan(
	session: AgentSession,
	taskCount: number,
	highRisk = false,
): GovernorTaskPlan | undefined {
	if (cfgAdaptiveMode.get(session.settings) !== "auto" || taskCount < 2) return undefined;
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
	};
}

export function routeGovernorTaskBatch(session: AgentSession, taskCount: number, highRisk = false): number | undefined {
	return routeGovernorTaskPlan(session, taskCount, highRisk)?.workerCount;
}
