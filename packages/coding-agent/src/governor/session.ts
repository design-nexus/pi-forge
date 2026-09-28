import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { concreteThinkingLevel, toReasoningEffort } from "@oh-my-pi/pi-tui/thinking";
import { combine } from "../config/registry";
import type { AgentSession } from "../session/agent-session";
import { cfgPromptCapabilities, cfgPromptProfile } from "../prompt-engine/settings";
import { resolveCapabilityPolicies } from "../prompt-engine/profiles";
import { cfgTaskMaxConcurrency, cfgTaskMaxEffort } from "../task/settings";
import {
	DEFAULT_GOVERNOR_THRESHOLDS,
	decideGovernor,
	type GovernorDecision,
	type GovernorDecisionInput,
} from "./decision";
import { cfgAdaptiveBands, cfgAdaptiveMode, cfgAdaptiveThresholds } from "./settings";

export const cfgGovernorBudgetInputs = combine({
	mode: cfgAdaptiveMode,
	thresholds: cfgAdaptiveThresholds,
	bandBudgets: cfgAdaptiveBands,
	taskMaxEffort: cfgTaskMaxEffort,
	taskMaxConcurrency: cfgTaskMaxConcurrency,
});

export interface GovernorPreviewRequest {
	signals: GovernorDecisionInput["signals"];
	overrides?: GovernorDecisionInput["overrides"];
}

/** Read only the session facts needed by the pure decision; no tool or model is changed. */
export function previewGovernorDecision(
	session: AgentSession,
	request: GovernorPreviewRequest,
): GovernorDecision | undefined {
	if (cfgAdaptiveMode.get(session.settings) !== "inspect") return undefined;
	const model = session.model;
	if (!model) return undefined;
	const recordedRole = session.sessionManager.getLastModelChangeRole();
	const currentRole =
		recordedRole && modelsAreEqual(session.resolveRoleModelWithThinking(recordedRole).model, model)
			? recordedRole
			: "current";
	const requestedRole = request.overrides?.pinnedRole ?? request.overrides?.role;
	const resolvedRole =
		requestedRole && session.settings.getModelRole(requestedRole)
			? session.resolveRoleModelWithThinking(requestedRole)
			: undefined;
	const roleEffort = resolvedRole?.explicitThinkingLevel
		? resolvedRole.thinkingLevel === ThinkingLevel.Off
			? "off"
			: toReasoningEffort(concreteThinkingLevel(resolvedRole.thinkingLevel))
		: undefined;
	const profile = session.promptSettingsOverride?.profile ?? cfgPromptProfile.get(session.settings);
	const capabilities = resolveCapabilityPolicies(profile, {
		...cfgPromptCapabilities.get(session.settings),
		...session.promptSettingsOverride?.capabilities,
	});
	const thresholds = { ...DEFAULT_GOVERNOR_THRESHOLDS, ...cfgAdaptiveThresholds.get(session.settings) };
	return decideGovernor({
		enabled: true,
		signals: request.signals,
		thresholds,
		bandBudgets: cfgAdaptiveBands.get(session.settings),
		current: { role: currentRole, model, effort: toReasoningEffort(session.thinkingLevel) },
		availableRoles: requestedRole
			? { [requestedRole]: resolvedRole?.model ? { model: resolvedRole.model, effort: roleEffort } : undefined }
			: undefined,
		overrides: request.overrides,
		ceilings: {
			sessionEffort: session.thinkingLevelCeiling,
			taskMaxEffort: cfgTaskMaxEffort.get(session.settings),
			taskMaxConcurrency: cfgTaskMaxConcurrency.get(session.settings),
		},
		capabilities: {
			subagentsAllowed: capabilities.subagents !== "disabled",
			taskToolAvailable:
				session.getToolByName("task") !== undefined && session.getEnabledToolNames().includes("task"),
		},
		contextWindowTokens: model.contextWindow ?? 0,
	});
}

export function inspectGovernorDecision(decision: GovernorDecision): string {
	const lines = [
		`Governor decision v${decision.version}: ${decision.band} (${Math.round(decision.confidence * 100)}% confidence)`,
		`Execution: ${decision.executionMode} · ${decision.planningDepth} plan · ${decision.workerCount} workers`,
		`Verification: ${decision.verification} · reviewer: ${decision.reviewer}`,
		`Model: ${decision.modelRole} (${decision.model.provider}/${decision.model.id}) · effort: ${decision.effort ?? "off"}`,
		`Context budget: ${decision.contextBudgetTokens.toLocaleString()} tokens · capabilities: ${decision.capabilityIds.join(", ") || "none"}`,
		`Evidence: ${decision.evidence.join("; ")}`,
	];
	if (decision.clamps.length) lines.push(`Ceilings: ${decision.clamps.join("; ")}`);
	return lines.join("\n");
}
