import type { AgentSession } from "../session/agent-session";
import { cfgTaskMaxConcurrency } from "../task/settings";
import { recordGovernorDecision } from "./ledger";
import { recentGovernorToolSignals } from "./runtime-signals";
import { cfgAdaptiveMode } from "./settings";

/** Bind one concrete independent task batch to a Governor decision. */
export function routeGovernorTaskBatch(session: AgentSession, taskCount: number): number | undefined {
	if (cfgAdaptiveMode.get(session.settings) !== "auto" || taskCount < 2) return undefined;
	const snapshot = recordGovernorDecision(
		session,
		{
			signals: {
				fileCount: 0,
				taskCount,
				independentTasks: taskCount,
				dependencyEdges: 0,
				highRisk: false,
				confidence: 0.9,
				runtime: recentGovernorToolSignals(session.sessionManager),
			},
		},
		"scope",
		"task_batch",
	);
	if (session.settings.getProvenance(cfgTaskMaxConcurrency) !== "default") return undefined;
	const workers = snapshot?.decision.workerCount ?? 0;
	return workers > 1 ? workers : undefined;
}
