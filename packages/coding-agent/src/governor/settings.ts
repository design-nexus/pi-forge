import { register } from "../config/registry";
import { DEFAULT_GOVERNOR_THRESHOLDS, type GovernorThresholds } from "./decision";

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
