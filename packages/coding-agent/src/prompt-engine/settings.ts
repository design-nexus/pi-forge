import { register } from "../config/registry";
import {
	validatePromptCapabilityPolicies,
	validatePromptModulePolicies,
	type PromptCapabilityPolicies,
	type PromptModulePolicies,
} from "./profiles";

export const cfgPromptProfile = register({
	id: "prompt.profile",
	type: "enum",
	values: ["full", "minimal", "coding", "agentic", "custom"] as const,
	default: "full",
	ui: {
		tab: "model",
		group: "Prompt",
		label: "Prompt Profile",
		description: "Choose which system-prompt guidance is loaded",
	},
});

export const cfgPromptModules = register({
	id: "prompt.modules",
	type: "record",
	default: {} as PromptModulePolicies,
	validate: validatePromptModulePolicies,
});

export const cfgPromptCapabilities = register({
	id: "prompt.capabilities",
	type: "record",
	default: {} as PromptCapabilityPolicies,
	validate: validatePromptCapabilityPolicies,
});
