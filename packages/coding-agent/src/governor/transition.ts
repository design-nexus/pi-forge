import {
	routeDelegationCapability,
	routeToolCapability,
	releaseStaleTaskCapabilityRoutes,
	selectToolCapability,
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
	/** Stable identity for the task scope that owns its automatic capability routes. */
	ownerId?: string;
}

export interface GovernorTaskTransitionResult {
	snapshot: GovernorSnapshot | undefined;
	route: DelegationRouteDecision | undefined;
	capabilityRoutes?: ToolCapabilityRouteDecision[];
	deferred?: true;
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
		const declaredCapabilities = [
			...new Set([
				...(request.facts.requiredCapabilities ?? []),
				...request.facts.tasks.flatMap(task => task.requiredCapabilities ?? []),
			]),
		];
		const declaredSet = new Set(declaredCapabilities);
		const inferredCapabilities = (request.facts.inferredCapabilities ?? []).filter(id => !declaredSet.has(id));
		const requiredCapabilities = [...declaredCapabilities, ...inferredCapabilities];
		const retainedRouteKeys = requiredCapabilities.map(id => (isTaskMcpCapability(id) ? `mcp:${id}` : id));
		const ownerId = request.ownerId ?? "default";
		await releaseStaleTaskCapabilityRoutes(session, new Set(retainedRouteKeys), ownerId);
		const capabilityRequests = requiredCapabilities.map(id => ({
			capabilityId: id,
			routeRequest: {
				id: isTaskMcpCapability(id) ? ("mcp" as const) : id,
				...(isTaskMcpCapability(id) ? { toolName: id } : {}),
				required: true,
				signal: "task_transition" as const,
				contextBudgetTokens: snapshot.decision.contextBudgetTokens,
				ownerId,
				...(!declaredSet.has(id) ? { classificationConfidence: request.facts.capabilityConfidence } : {}),
			},
		}));
		const explicitRequests = capabilityRequests.filter(request => declaredSet.has(request.capabilityId));
		const inferredRequests = capabilityRequests.filter(request => !declaredSet.has(request.capabilityId));
		const capabilityRoutes: ToolCapabilityRouteDecision[] = [];
		const explicitPreflight = explicitRequests.map(({ routeRequest }) => selectToolCapability(session, routeRequest));
		const canActivateAllExplicit = explicitPreflight.every(
			decision => decision.state === "active" || decision.selected,
		);
		if (canActivateAllExplicit) {
			for (const { routeRequest } of explicitRequests) {
				capabilityRoutes.push(await routeToolCapability(session, routeRequest));
			}
		} else {
			capabilityRoutes.push(...explicitPreflight);
		}
		for (const { routeRequest } of inferredRequests) {
			const preflight = selectToolCapability(session, routeRequest);
			capabilityRoutes.push(preflight.selected ? await routeToolCapability(session, routeRequest) : preflight);
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
