import { register } from "../config/registry";
import {
	DEFAULT_GOVERNOR_BAND_BUDGETS,
	DEFAULT_GOVERNOR_THRESHOLDS,
	type GovernorBandBudget,
	type GovernorThresholds,
	type TaskBand,
} from "./decision";

function validateThresholdOverrides(value: unknown): void {
	if (value === undefined) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("adaptive.thresholds must be an object");
	}
	const overrides = value as Record<string, unknown>;
	const allowed = [
		"trivialMaxFiles",
		"complexMinFiles",
		"massiveMinFiles",
		"complexMinTasks",
		"massiveMinTasks",
		"confidenceFloor",
		"runtimeNormalPressure",
		"runtimeComplexPressure",
		"runtimeStagnationMs",
	] as const;
	if (Object.keys(overrides).some(key => !allowed.includes(key as (typeof allowed)[number]))) {
		throw new Error("adaptive.thresholds contains an unknown field");
	}
	const thresholds = { ...DEFAULT_GOVERNOR_THRESHOLDS, ...overrides };
	if (
		![
			thresholds.trivialMaxFiles,
			thresholds.complexMinFiles,
			thresholds.massiveMinFiles,
			thresholds.complexMinTasks,
			thresholds.massiveMinTasks,
		].every(entry => typeof entry === "number" && Number.isInteger(entry) && entry >= 0) ||
		thresholds.trivialMaxFiles >= thresholds.complexMinFiles ||
		thresholds.complexMinFiles >= thresholds.massiveMinFiles ||
		thresholds.complexMinTasks >= thresholds.massiveMinTasks ||
		typeof thresholds.confidenceFloor !== "number" ||
		!Number.isFinite(thresholds.confidenceFloor) ||
		thresholds.confidenceFloor < 0 ||
		thresholds.confidenceFloor > 1 ||
		typeof thresholds.runtimeNormalPressure !== "number" ||
		!Number.isFinite(thresholds.runtimeNormalPressure) ||
		thresholds.runtimeNormalPressure < 0 ||
		thresholds.runtimeNormalPressure >= thresholds.runtimeComplexPressure ||
		typeof thresholds.runtimeComplexPressure !== "number" ||
		!Number.isFinite(thresholds.runtimeComplexPressure) ||
		thresholds.runtimeComplexPressure > 1 ||
		typeof thresholds.runtimeStagnationMs !== "number" ||
		!Number.isSafeInteger(thresholds.runtimeStagnationMs) ||
		thresholds.runtimeStagnationMs < 1
	) {
		throw new Error(
			"adaptive.thresholds requires ordered file and task limits, runtime pressure from 0 to 1, and positive stagnation milliseconds",
		);
	}
}

function validateBandBudgets(value: unknown): void {
	if (value === undefined) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("adaptive.bands must be an object");
	}
	for (const [band, rawBudget] of Object.entries(value)) {
		if (!Object.hasOwn(DEFAULT_GOVERNOR_BAND_BUDGETS, band)) throw new Error(`Unknown adaptive band: ${band}`);
		if (rawBudget === null || typeof rawBudget !== "object" || Array.isArray(rawBudget)) {
			throw new Error(`adaptive.bands.${band} must be an object`);
		}
		const budget = rawBudget as Record<string, unknown>;
		if (
			Object.keys(budget).some(
				key =>
					key !== "maxWorkers" &&
					key !== "contextShare" &&
					key !== "verificationFloor" &&
					key !== "verificationCeiling",
			)
		) {
			throw new Error(`adaptive.bands.${band} contains an unknown field`);
		}
		const verificationOrder = ["V0", "V1", "V2", "V3", "V4"] as const;
		const defaultBudget = DEFAULT_GOVERNOR_BAND_BUDGETS[band as TaskBand];
		const floor = budget.verificationFloor === undefined ? defaultBudget.verificationFloor : budget.verificationFloor;
		const ceiling =
			budget.verificationCeiling === undefined ? defaultBudget.verificationCeiling : budget.verificationCeiling;
		if (
			!verificationOrder.includes(floor as (typeof verificationOrder)[number]) ||
			!verificationOrder.includes(ceiling as (typeof verificationOrder)[number]) ||
			verificationOrder.indexOf(floor as (typeof verificationOrder)[number]) >
				verificationOrder.indexOf(ceiling as (typeof verificationOrder)[number])
		) {
			throw new Error(`adaptive.bands.${band} requires verificationFloor <= verificationCeiling (V0–V4)`);
		}
		const workerLimit = DEFAULT_GOVERNOR_BAND_BUDGETS[band as TaskBand].maxWorkers;
		if (
			budget.maxWorkers !== undefined &&
			(typeof budget.maxWorkers !== "number" ||
				!Number.isInteger(budget.maxWorkers) ||
				budget.maxWorkers < 0 ||
				budget.maxWorkers > workerLimit)
		) {
			throw new Error(`adaptive.bands.${band}.maxWorkers must be between 0 and ${workerLimit}`);
		}
		if (
			budget.contextShare !== undefined &&
			(typeof budget.contextShare !== "number" ||
				!Number.isFinite(budget.contextShare) ||
				budget.contextShare < 0 ||
				budget.contextShare > 1)
		) {
			throw new Error(`adaptive.bands.${band}.contextShare must be between 0 and 1`);
		}
	}
}

function validateRolePolicies(value: unknown): void {
	if (value === undefined) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("adaptive.roles must be an object");
	}
	const roles = value as Record<string, unknown>;
	for (const [band, role] of Object.entries(roles)) {
		if (!Object.hasOwn(DEFAULT_GOVERNOR_BAND_BUDGETS, band)) throw new Error(`Unknown adaptive role band: ${band}`);
		if (typeof role !== "string" || role.trim().length === 0) {
			throw new Error(`adaptive.roles.${band} must name a configured model role`);
		}
	}
}

export const cfgAdaptiveMode = register({
	id: "adaptive.mode",
	type: "enum",
	values: ["off", "inspect", "auto"] as const,
	default: "off",
	ui: {
		tab: "model",
		group: "Prompt",
		label: "Adaptive Governor",
		description: "Inspect decisions or automatically route eligible task capabilities",
	},
});

export const cfgAdaptiveThresholds = register({
	id: "adaptive.thresholds",
	type: "record",
	default: {} as Partial<GovernorThresholds>,
	validate: validateThresholdOverrides,
});

export const cfgAdaptiveBands = register({
	id: "adaptive.bands",
	type: "record",
	default: {} as Partial<Record<TaskBand, Partial<GovernorBandBudget>>>,
	validate: validateBandBudgets,
});

export const cfgAdaptiveRoles = register({
	id: "adaptive.roles",
	type: "record",
	default: {} as Partial<Record<TaskBand, string>>,
	validate: validateRolePolicies,
	ui: {
		tab: "model",
		group: "Prompt",
		label: "Adaptive Governor Roles",
		description: "Optional model roles selected by task band; explicit task role choices take precedence",
	},
});
