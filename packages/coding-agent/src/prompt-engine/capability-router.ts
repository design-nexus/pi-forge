import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import type { AgentSession } from "../session/agent-session";
import { isMCPToolName } from "../tools/builtin-names";
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
	id: RoutableToolCapabilityId | "browser" | "mcp";
	/** An exact registered MCP tool to promote; required only for `mcp`. */
	toolName?: string;
	/** True only when an authoritative task transition names this capability as required. */
	required?: boolean;
	signal: "explicit" | "task_transition";
	intent?: "parallel_work" | "single_task";
	contextBudgetTokens?: number;
}

export interface ToolCapabilityRouteDecision {
	id: RoutableToolCapabilityId | "browser" | "mcp";
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

interface CapabilityActivationLease {
	toolName: string;
	enabledBefore: boolean;
	mountedBefore: boolean;
	browserPolicyBefore?: "always" | "automatic" | "disabled";
}

const capabilityActivationLeases = new WeakMap<AgentSession, Map<string, CapabilityActivationLease>>();
const taskCapabilityActivationLeases = new WeakMap<AgentSession, Map<string, CapabilityActivationLease>>();

function capabilityLeaseKey(request: ToolCapabilityRouteRequest): string {
	return request.id === "mcp" ? `mcp:${request.toolName ?? ""}` : request.id;
}

/** Select a registered direct-tool capability without mutating the session. */
export function selectToolCapability(
	session: AgentSession,
	request: ToolCapabilityRouteRequest,
): ToolCapabilityRouteDecision {
	const definition = request.id === "mcp" ? undefined : TOOL_CAPABILITY_CATALOG[request.id];
	const toolName = request.id === "mcp" ? (request.toolName ?? "") : (definition?.toolName ?? "");
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
	const estimatedGuidanceTokens = (definition?.promptModules ?? []).reduce<number | undefined>((total, id) => {
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
	if (request.id === "mcp" && !isMCPToolName(toolName)) {
		return {
			...base,
			state: "unavailable",
			selected: false,
			reason: "an exact registered MCP tool name is required",
		};
	}
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
	if (request.id === "browser" && session.promptComposition?.capabilities.browser.available !== true) {
		return { ...base, state: "unavailable", selected: false, reason: "browser runtime is unavailable" };
	}
	if (
		(request.id === "browser" &&
			session.promptComposition?.capabilities.browser.active === true &&
			session.getActiveToolNames().includes(toolName)) ||
		(request.id !== "browser" && session.getActiveToolNames().includes(toolName))
	) {
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
	const transitionMayRoute =
		(request.id === "subagents" && request.intent === "parallel_work") || request.required === true;
	if (request.signal !== "explicit" && !transitionMayRoute) {
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
		if (!decision.selected) {
			if (request.signal === "explicit") {
				const key = capabilityLeaseKey(request);
				const automaticLease = taskCapabilityActivationLeases.get(session)?.get(key);
				if (automaticLease) {
					let leases = capabilityActivationLeases.get(session);
					if (!leases) {
						leases = new Map();
						capabilityActivationLeases.set(session, leases);
					}
					leases.set(key, automaticLease);
					taskCapabilityActivationLeases.get(session)?.delete(key);
				}
			}
			return decision;
		}
		const enabled = session.getEnabledToolNames();
		const mounted = session.getMountedXdevToolNames();
		const lease: CapabilityActivationLease = {
			toolName: decision.toolName,
			enabledBefore: enabled.includes(decision.toolName),
			mountedBefore: mounted.includes(decision.toolName),
			...(request.id === "browser" && session.promptSettingsOverride?.capabilities?.browser
				? { browserPolicyBefore: session.promptSettingsOverride.capabilities.browser }
				: {}),
		};
		await session.setActiveToolPresentation(
			[...new Set([...enabled, decision.toolName])],
			mounted.filter(name => name !== decision.toolName),
		);
		if (request.id === "browser") {
			await session.setPromptSettingsOverride({
				...session.promptSettingsOverride,
				capabilities: { ...session.promptSettingsOverride?.capabilities, browser: "always" },
			});
		}
		if (request.signal === "explicit" || request.signal === "task_transition") {
			const leaseStore = request.signal === "explicit" ? capabilityActivationLeases : taskCapabilityActivationLeases;
			let leases = leaseStore.get(session);
			if (!leases) {
				leases = new Map();
				leaseStore.set(session, leases);
			}
			leases.set(capabilityLeaseKey(request), lease);
		}
		return { ...selectToolCapability(session, request), selected: true, reason: decision.reason };
	});
}

/** Release Governor-owned routes no longer named by the current structured task. */
export async function releaseStaleTaskCapabilityRoutes(
	session: AgentSession,
	retained: ReadonlySet<RoutableToolCapabilityId>,
): Promise<void> {
	await session.runToolRegistryMutation(async () => {
		const leases = taskCapabilityActivationLeases.get(session);
		if (!leases || session.isStreaming) return;
		const retainedKeys = new Set<string>(retained);
		for (const [key, lease] of leases) {
			if (retainedKeys.has(key)) continue;
			if (
				!session.getEnabledToolNames().includes(lease.toolName) ||
				session.getMountedXdevToolNames().includes(lease.toolName)
			) {
				leases.delete(key);
				continue;
			}
			const enabled = session.getEnabledToolNames().filter(name => name !== lease.toolName);
			const mounted = session.getMountedXdevToolNames().filter(name => name !== lease.toolName);
			if (lease.enabledBefore) enabled.push(lease.toolName);
			if (lease.mountedBefore) mounted.push(lease.toolName);
			await session.setActiveToolPresentation(enabled, mounted);
			leases.delete(key);
		}
	});
}

/** Restore the tool presentation captured when an explicit capability was routed. */
export async function releaseToolCapability(
	session: AgentSession,
	request: ToolCapabilityRouteRequest,
): Promise<ToolCapabilityRouteDecision> {
	return session.runToolRegistryMutation(async () => {
		const key = capabilityLeaseKey(request);
		const leases = capabilityActivationLeases.get(session);
		const lease = leases?.get(key);
		if (session.isStreaming) {
			const decision = selectToolCapability(session, request);
			return {
				...decision,
				selected: false,
				state: "unavailable",
				reason: "tool routing waits for an idle turn",
			};
		}
		if (!lease) {
			const decision = selectToolCapability(session, request);
			return { ...decision, selected: false, reason: "no session-scoped activation to release" };
		}
		const enabled = session.getEnabledToolNames().filter(name => name !== lease.toolName);
		const mounted = session.getMountedXdevToolNames().filter(name => name !== lease.toolName);
		if (lease.enabledBefore) enabled.push(lease.toolName);
		if (lease.mountedBefore) mounted.push(lease.toolName);
		await session.setActiveToolPresentation(enabled, mounted);
		const currentOverride = session.promptSettingsOverride;
		if (request.id === "browser" && currentOverride?.capabilities?.browser === "always") {
			const current = currentOverride;
			const capabilities = { ...current.capabilities };
			if (lease.browserPolicyBefore) capabilities.browser = lease.browserPolicyBefore;
			else delete capabilities.browser;
			const next = {
				...current,
				capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
			};
			await session.setPromptSettingsOverride(next.profile || next.modules || next.capabilities ? next : undefined);
		}
		leases?.delete(key);
		return {
			...selectToolCapability(session, request),
			selected: false,
			reason: `${lease.toolName} capability activation released`,
		};
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
