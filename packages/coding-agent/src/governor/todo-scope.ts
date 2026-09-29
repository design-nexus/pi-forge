import type { TodoPhase } from "@oh-my-pi/pi-tui/tools/todo";
import type { AgentSession } from "../session/agent-session";
import { latestGovernorSnapshot, recordGovernorDecision } from "./ledger";
import { cfgAdaptiveMode } from "./settings";

/** Todo items describe scope, but carry no dependency or parallelism contract. */
export function recordGovernorTodoScope(session: AgentSession, phases: readonly TodoPhase[]): void {
	if (cfgAdaptiveMode.get(session.settings) === "off") return;
	const previous = latestGovernorSnapshot(session.sessionManager);
	if (previous && previous.signalSource !== "todo") return;
	const taskCount = phases.reduce(
		(total, phase) => total + phase.tasks.filter(task => task.status !== "abandoned").length,
		0,
	);
	if (taskCount === 0 && !previous) return;
	recordGovernorDecision(
		session,
		{
			signals: {
				fileCount: 0,
				taskCount,
				independentTasks: 0,
				dependencyEdges: 0,
				highRisk: false,
				confidence: 0.6,
				runtime: previous?.signals.runtime,
			},
		},
		previous ? "scope" : "initial",
		"todo",
	);
}
