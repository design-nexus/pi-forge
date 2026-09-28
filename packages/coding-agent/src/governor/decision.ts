import { THINKING_EFFORTS, type Effort } from "@oh-my-pi/pi-catalog/effort";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelKind, type Model } from "@oh-my-pi/pi-catalog/types";
import type { RoutableToolCapabilityId } from "../prompt-engine/capability-catalog";

export type TaskBand = "trivial" | "normal" | "complex" | "massive";
export type ExecutionMode = "direct" | "planned" | "parallel";

export interface GovernorThresholds {
	trivialMaxFiles: number;
	complexMinFiles: number;
	massiveMinFiles: number;
	confidenceFloor: number;
}

export const DEFAULT_GOVERNOR_THRESHOLDS: GovernorThresholds = {
	trivialMaxFiles: 1,
	complexMinFiles: 5,
	massiveMinFiles: 12,
	confidenceFloor: 0.6,
};

export interface GovernorDecisionInput {
	/** Adaptive policy stays dormant unless the caller explicitly enables it. */
	enabled: boolean;
	signals: {
		fileCount: number;
		independentTasks: number;
		dependencyEdges: number;
		highRisk: boolean;
		confidence: number;
	};
	thresholds?: GovernorThresholds;
	current: { role: string; model: Model; effort?: Effort };
	/** Already resolved, authorized role assignments; the policy never discovers models. */
	availableRoles?: Readonly<Record<string, { model: Model; effort?: Effort | "off" } | undefined>>;
	overrides?: {
		band?: TaskBand;
		role?: string;
		pinnedRole?: string;
		effort?: Effort;
		workerCount?: number;
		maxWorkers?: number;
	};
	ceilings: {
		sessionEffort?: Effort;
		taskMaxEffort?: Effort;
		taskMaxConcurrency: number;
	};
	capabilities: {
		subagentsAllowed: boolean;
		taskToolAvailable: boolean;
	};
	contextWindowTokens: number;
}

export interface GovernorDecision {
	version: 1;
	band: TaskBand;
	confidence: number;
	executionMode: ExecutionMode;
	planningDepth: "none" | "brief" | "milestones" | "dependency_graph";
	verification: "relevant_check" | "targeted_checks" | "integration_checks";
	reviewer: "none" | "risk_based" | "independent";
	workerCount: number;
	modelRole: string;
	model: { provider: string; id: string };
	effort: Effort | undefined;
	contextBudgetTokens: number;
	capabilityIds: readonly RoutableToolCapabilityId[];
	evidence: readonly string[];
	clamps: readonly string[];
}

const BAND_POLICY = {
	trivial: {
		planningDepth: "none",
		verification: "relevant_check",
		reviewer: "none",
		maxWorkers: 0,
		contextShare: 0.1,
	},
	normal: {
		planningDepth: "brief",
		verification: "targeted_checks",
		reviewer: "risk_based",
		maxWorkers: 0,
		contextShare: 0.2,
	},
	complex: {
		planningDepth: "milestones",
		verification: "targeted_checks",
		reviewer: "risk_based",
		maxWorkers: 2,
		contextShare: 0.35,
	},
	massive: {
		planningDepth: "dependency_graph",
		verification: "integration_checks",
		reviewer: "independent",
		maxWorkers: 4,
		contextShare: 0.5,
	},
} as const;

function effortIndex(effort: Effort): number {
	return THINKING_EFFORTS.indexOf(effort);
}

function nonNegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function selectEffort(
	input: GovernorDecisionInput,
	model: Model,
	roleEffort: Effort | "off" | undefined,
	clamps: string[],
): Effort | undefined {
	if (input.overrides?.effort === undefined && roleEffort === "off") return undefined;
	const requested = input.overrides?.effort ?? (roleEffort === "off" ? undefined : roleEffort) ?? input.current.effort;
	if (!requested) return undefined;
	const ceilings = [input.ceilings.sessionEffort, input.ceilings.taskMaxEffort].filter(
		(value): value is Effort => value !== undefined,
	);
	const maximum = Math.min(effortIndex(requested), ...ceilings.map(effortIndex));
	const supported = getSupportedEfforts(model).filter(effort => effortIndex(effort) <= maximum);
	const selected = supported.at(-1);
	if (selected !== requested) clamps.push(selected ? `effort clamped to ${selected}` : "requested effort unavailable");
	return selected;
}

/** Pure policy decision over resolved repository, model, tool, and user facts. */
export function decideGovernor(input: GovernorDecisionInput): GovernorDecision | undefined {
	if (!input.enabled) return undefined;
	const thresholds = input.thresholds ?? DEFAULT_GOVERNOR_THRESHOLDS;
	const evidence: string[] = [];
	const clamps: string[] = [];
	const { highRisk } = input.signals;
	const fileCount = nonNegative(input.signals.fileCount);
	const independentTasks = nonNegative(input.signals.independentTasks);
	const dependencyEdges = nonNegative(input.signals.dependencyEdges);
	const confidence = Number.isFinite(input.signals.confidence)
		? Math.max(0, Math.min(1, input.signals.confidence))
		: 0;
	let band: TaskBand;
	if (fileCount >= thresholds.massiveMinFiles || independentTasks >= 4) {
		band = "massive";
		evidence.push("large or separable scope");
	} else if (fileCount >= thresholds.complexMinFiles || dependencyEdges > 0 || highRisk) {
		band = "complex";
		evidence.push("scope, dependencies, or risk require milestones");
	} else if (fileCount <= thresholds.trivialMaxFiles && independentTasks <= 1) {
		band = "trivial";
		evidence.push("small independent scope");
	} else {
		band = "normal";
		evidence.push("moderate scope");
	}
	if (confidence < thresholds.confidenceFloor && !input.overrides?.band) {
		band = "normal";
		evidence.push("low confidence fallback");
	}
	if (input.overrides?.band) {
		band = input.overrides.band;
		evidence.push("explicit task band");
	}
	const policy = BAND_POLICY[band];
	const requestedRole = input.overrides?.pinnedRole ?? input.overrides?.role;
	let modelRole = input.current.role;
	let model = input.current.model;
	let roleEffort: Effort | "off" | undefined;
	if (requestedRole) {
		const candidate = input.availableRoles?.[requestedRole];
		if (candidate && modelKind(candidate.model) === "chat") {
			modelRole = requestedRole;
			model = candidate.model;
			roleEffort = candidate.effort;
		} else {
			clamps.push(`role ${requestedRole} unavailable; current model retained`);
		}
	}
	const effort = selectEffort(input, model, roleEffort, clamps);
	const taskLimit =
		input.ceilings.taskMaxConcurrency === 0
			? Number.POSITIVE_INFINITY
			: nonNegative(input.ceilings.taskMaxConcurrency);
	const requestedWorkers =
		input.overrides?.workerCount ??
		(band === "massive" ? independentTasks : band === "complex" && independentTasks >= 2 ? 2 : 0);
	const allowedWorkers =
		input.capabilities.subagentsAllowed && input.capabilities.taskToolAvailable && model.supportsTools !== false
			? Math.min(
					policy.maxWorkers,
					independentTasks,
					taskLimit,
					input.overrides?.maxWorkers === undefined ? Infinity : nonNegative(input.overrides.maxWorkers),
				)
			: 0;
	const workerCount = Math.min(nonNegative(requestedWorkers), allowedWorkers);
	if (workerCount < requestedWorkers)
		clamps.push("worker count clamped by policy, availability, or concurrency ceiling");
	const executionMode: ExecutionMode =
		workerCount > 1 ? "parallel" : band === "complex" || band === "massive" ? "planned" : "direct";
	const contextWindowTokens = model === input.current.model ? input.contextWindowTokens : (model.contextWindow ?? 0);
	const contextBudgetTokens = Math.floor(nonNegative(contextWindowTokens) * policy.contextShare);
	return {
		version: 1,
		band,
		confidence,
		executionMode,
		planningDepth: policy.planningDepth,
		verification: policy.verification,
		reviewer: policy.reviewer,
		workerCount,
		modelRole,
		model: { provider: model.provider, id: model.id },
		effort,
		contextBudgetTokens,
		capabilityIds: workerCount > 0 ? ["subagents"] : [],
		evidence,
		clamps,
	};
}
