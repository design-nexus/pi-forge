import {
	routeDelegationCapability,
	routeToolCapability,
	releaseStaleTaskCapabilityRoutes,
	type DelegationRouteDecision,
	type ToolCapabilityRouteDecision,
} from "../prompt-engine/capability-router";
import type { AgentSession } from "../session/agent-session";
import { isMCPToolName } from "../tools/builtin-names";
import type { TaskCapabilityId } from "../prompt-engine/capability-catalog";
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
	capabilityRoutes?: ToolCapabilityRouteDecision[];
}

function isTaskMcpCapability(value: TaskCapabilityId): value is `mcp__${string}` {
	return isMCPToolName(value);
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
		if (mode !== "auto" || !snapshot) {
			return { snapshot, route: undefined };
		}
		const requiredCapabilities = [
			...new Set([
				...(request.facts.requiredCapabilities ?? []),
				...request.facts.tasks.flatMap(task => task.requiredCapabilities ?? []),
			]),
		];
		const retainedRouteKeys = requiredCapabilities.map(id => (isTaskMcpCapability(id) ? `mcp:${id}` : id));
		await releaseStaleTaskCapabilityRoutes(session, new Set(retainedRouteKeys));
		const capabilityRoutes: ToolCapabilityRouteDecision[] = [];
		for (const id of requiredCapabilities) {
			capabilityRoutes.push(
				await routeToolCapability(session, {
					id: isTaskMcpCapability(id) ? "mcp" : id,
					...(isTaskMcpCapability(id) ? { toolName: id } : {}),
					required: true,
					signal: "task_transition",
					contextBudgetTokens: snapshot.decision.contextBudgetTokens,
				}),
			);
		}
		if (snapshot?.decision.executionMode !== "parallel") {
			await session.releaseGovernorTaskPromotion();
			return {
				snapshot,
				route: undefined,
				...(capabilityRoutes.length > 0 ? { capabilityRoutes } : {}),
			};
		}
		const wasMounted = session.getMountedXdevToolNames().includes("task");
		const route = await routeDelegationCapability(session, {
			intent: "parallel_work",
			signal: "task_transition",
			contextBudgetTokens: snapshot.decision.contextBudgetTokens,
		});
		if (route.selected && route.state === "active") session.markGovernorTaskPromotion(wasMounted);
		return {
			snapshot,
			route,
			...(capabilityRoutes.length > 0 ? { capabilityRoutes } : {}),
		};
	});
}
