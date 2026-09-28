import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import type { AgentSession } from "../session/agent-session";
import { TOOL_CAPABILITY_CATALOG, type RoutableToolCapabilityId } from "./capability-catalog";
import { estimateToolSchemaTokens } from "./inspection";
import { resolveCapabilityPolicies, resolvePromptPolicies } from "./profiles";
import { cfgPromptCapabilities, cfgPromptModules, cfgPromptProfile } from "./settings";

export interface DelegationRouteRequest {
	intent: "parallel_work" | "single_task";
	signal: "explicit" | "task_transition";
	contextBudgetTokens?: number;
}

export interface ToolCapabilityRouteRequest {
	id: RoutableToolCapabilityId;
	signal: "explicit" | "task_transition";
	intent?: "parallel_work" | "single_task";
	contextBudgetTokens?: number;
}

export interface ToolCapabilityRouteDecision {
	id: RoutableToolCapabilityId;
	toolName: string;
	state: "disabled" | "unavailable" | "discoverable" | "active";
	selected: boolean;
	source: "built-in" | "registered" | "none";
	estimatedGuidanceTokens: number | undefined;
	estimatedToolSchemaTokens: number | undefined;
	estimatedActivationTokens: number | undefined;
	reason: string;
}

export type DelegationRouteDecision = ToolCapabilityRouteDecision & { id: "subagents"; toolName: "task" };

/** Select a registered direct-tool capability without mutating the session. */
export function selectToolCapability(
	session: AgentSession,
	request: ToolCapabilityRouteRequest,
): ToolCapabilityRouteDecision {
	const definition = TOOL_CAPABILITY_CATALOG[request.id];
	const toolName = definition.toolName;
	const profile = session.promptSettingsOverride?.profile ?? cfgPromptProfile.get(session.settings);
	const policies = resolveCapabilityPolicies(profile, {
		...cfgPromptCapabilities.get(session.settings),
		...session.promptSettingsOverride?.capabilities,
	});
	const tool = session.getToolByName(toolName);
	const model = session.model;
	const source = tool ? (session.hasBuiltInTool(toolName) ? "built-in" : "registered") : "none";
	const modulePolicies = resolvePromptPolicies(profile, {
		...cfgPromptModules.get(session.settings),
		...session.promptSettingsOverride?.modules,
	});
	const estimatedGuidanceTokens = definition.promptModules.reduce<number | undefined>((total, id) => {
		const section = session.promptComposition?.sections.find(candidate => candidate.id === id);
		if (!section || total === undefined) return undefined;
		return total + (section.active || modulePolicies[id] === "disabled" ? 0 : section.tokens);
	}, 0);
	const estimatedToolSchemaTokens = tool && model ? estimateToolSchemaTokens([tool], new Tokenizer(model)) : undefined;
	const estimatedActivationTokens =
		estimatedGuidanceTokens === undefined || estimatedToolSchemaTokens === undefined
			? undefined
			: estimatedGuidanceTokens + estimatedToolSchemaTokens;
	const base = {
		id: request.id,
		toolName,
		source,
		estimatedGuidanceTokens,
		estimatedToolSchemaTokens,
		estimatedActivationTokens,
	} as const;
	if (policies[request.id] === "disabled") {
		return { ...base, state: "disabled", selected: false, reason: "disabled by capability policy" };
	}
	if (!tool || !model || model.supportsTools === false) {
		return {
			...base,
			state: "unavailable",
			selected: false,
			reason: !tool
				? `${toolName} tool is not registered`
				: model
					? "current model does not support tools"
					: "no model selected",
		};
	}
	if (session.getActiveToolNames().includes(toolName)) {
		return {
			...base,
			estimatedToolSchemaTokens: 0,
			estimatedActivationTokens: 0,
			state: "active",
			selected: false,
			reason: `${toolName} tool is already active`,
		};
	}
	if (session.isStreaming) {
		return { ...base, state: "unavailable", selected: false, reason: "tool routing waits for an idle turn" };
	}
	if (model.thinking?.prefixBinding && session.messages.some(message => message.role === "assistant")) {
		return {
			...base,
			state: "unavailable",
			selected: false,
			reason: "model binds its tool roster after the first assistant response",
		};
	}
	if (request.signal !== "explicit" && (request.id !== "subagents" || request.intent !== "parallel_work")) {
		return {
			...base,
			state: "discoverable",
			selected: false,
			reason:
				request.id === "subagents"
					? "task intent does not need delegation"
					: "automatic routing is not defined for this capability",
		};
	}
	if (request.signal !== "explicit" && !session.getEnabledToolNames().includes(toolName)) {
		return { ...base, state: "discoverable", selected: false, reason: `${toolName} tool was not enabled` };
	}
	if (
		request.signal !== "explicit" &&
		request.contextBudgetTokens !== undefined &&
		estimatedActivationTokens === undefined
	) {
		return { ...base, state: "discoverable", selected: false, reason: "activation cost is unavailable" };
	}
	if (
		request.signal !== "explicit" &&
		request.contextBudgetTokens !== undefined &&
		estimatedActivationTokens !== undefined &&
		estimatedActivationTokens > Math.max(0, request.contextBudgetTokens)
	) {
		return { ...base, state: "discoverable", selected: false, reason: "activation exceeds context budget" };
	}
	return {
		...base,
		state: "discoverable",
		selected: true,
		reason:
			request.signal === "explicit"
				? request.id === "subagents"
					? "explicit delegation request"
					: "explicit capability request"
				: "parallel work selected",
	};
}

/** Promote the selected registered tool through the session's existing tool lifecycle. */
export async function routeToolCapability(
	session: AgentSession,
	request: ToolCapabilityRouteRequest,
): Promise<ToolCapabilityRouteDecision> {
	return session.runToolRegistryMutation(async () => {
		const decision = selectToolCapability(session, request);
		if (!decision.selected) return decision;
		const enabled = session.getEnabledToolNames();
		const mounted = session.getMountedXdevToolNames();
		await session.setActiveToolPresentation(
			[...new Set([...enabled, decision.toolName])],
			mounted.filter(name => name !== decision.toolName),
		);
		return { ...selectToolCapability(session, request), selected: true, reason: decision.reason };
	});
}

export function selectDelegationCapability(
	session: AgentSession,
	request: DelegationRouteRequest,
): DelegationRouteDecision {
	return selectToolCapability(session, { ...request, id: "subagents" }) as DelegationRouteDecision;
}

export async function routeDelegationCapability(
	session: AgentSession,
	request: DelegationRouteRequest,
): Promise<DelegationRouteDecision> {
	return routeToolCapability(session, { ...request, id: "subagents" }) as Promise<DelegationRouteDecision>;
}
