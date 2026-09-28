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
	const allowed = ["trivialMaxFiles", "complexMinFiles", "massiveMinFiles", "confidenceFloor"] as const;
	if (Object.keys(overrides).some(key => !allowed.includes(key as (typeof allowed)[number]))) {
		throw new Error("adaptive.thresholds contains an unknown field");
	}
	const thresholds = { ...DEFAULT_GOVERNOR_THRESHOLDS, ...overrides };
	if (
		![thresholds.trivialMaxFiles, thresholds.complexMinFiles, thresholds.massiveMinFiles].every(
			entry => typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
		) ||
		thresholds.trivialMaxFiles >= thresholds.complexMinFiles ||
		thresholds.complexMinFiles >= thresholds.massiveMinFiles ||
		typeof thresholds.confidenceFloor !== "number" ||
		!Number.isFinite(thresholds.confidenceFloor) ||
		thresholds.confidenceFloor < 0 ||
		thresholds.confidenceFloor > 1
	) {
		throw new Error("adaptive.thresholds requires ordered file limits and a confidence floor from 0 to 1");
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
		if (Object.keys(budget).some(key => key !== "maxWorkers" && key !== "contextShare")) {
			throw new Error(`adaptive.bands.${band} contains an unknown field`);
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

export const cfgAdaptiveMode = register({
	id: "adaptive.mode",
	type: "enum",
	values: ["off", "inspect"] as const,
	default: "off",
	ui: {
		tab: "model",
		group: "Prompt",
		label: "Adaptive Preview",
		description: "Enable Governor decision previews without changing agent execution",
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
