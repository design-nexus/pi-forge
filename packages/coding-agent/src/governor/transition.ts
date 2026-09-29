import { routeDelegationCapability, type DelegationRouteDecision } from "../prompt-engine/capability-router";
import type { AgentSession } from "../session/agent-session";
import { recordGovernorDecision } from "./ledger";
import { recentGovernorToolSignals } from "./runtime-signals";
import type { GovernorRevisionTrigger, GovernorSnapshot } from "./revision";
import type { GovernorPreviewRequest } from "./session";
import { cfgAdaptiveMode } from "./settings";
import { signalsFromTaskFacts, type GovernorTaskFacts } from "./task-facts";

export interface GovernorTaskTransitionRequest {
	facts: GovernorTaskFacts;
	overrides?: GovernorPreviewRequest["overrides"];
}

export interface GovernorTaskTransitionResult {
	snapshot: GovernorSnapshot | undefined;
	route: DelegationRouteDecision | undefined;
}

/** Apply a structured task transition through the existing task-tool router. */
export async function routeGovernorTaskTransition(
	session: AgentSession,
	request: GovernorTaskTransitionRequest,
	trigger: Extract<GovernorRevisionTrigger, "initial" | "scope" | "steering">,
): Promise<GovernorTaskTransitionResult> {
	const taskSignals = signalsFromTaskFacts(request.facts);
	return await session.runToolRegistryMutation(async () => {
		const mode = cfgAdaptiveMode.get(session.settings);
		const signals =
			mode === "off" ? taskSignals : { ...taskSignals, runtime: recentGovernorToolSignals(session.sessionManager) };
		const snapshot = recordGovernorDecision(
			session,
			{ signals, overrides: request.overrides },
			trigger,
			"task_graph",
		);
		if (mode !== "auto") {
			return { snapshot, route: undefined };
		}
		if (snapshot?.decision.executionMode !== "parallel") {
			await session.releaseGovernorTaskPromotion();
			return { snapshot, route: undefined };
		}
		const wasMounted = session.getMountedXdevToolNames().includes("task");
		const route = await routeDelegationCapability(session, {
			intent: "parallel_work",
			signal: "task_transition",
			contextBudgetTokens: snapshot.decision.contextBudgetTokens,
		});
		if (route.selected && route.state === "active") session.markGovernorTaskPromotion(wasMounted);
		return { snapshot, route };
	});
}
