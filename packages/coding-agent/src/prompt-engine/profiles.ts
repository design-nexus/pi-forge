/** Policies for sections of the bundled system prompt. */
export type PromptPolicy = "always" | "automatic" | "disabled";
export type PromptProfile = "minimal" | "coding" | "agentic" | "full" | "custom";
export type PromptModuleId =
	| "core"
	| "runtime"
	| "tool-policy"
	| "delegation"
	| "workflow"
	| "testing"
	| "delivery"
	| "project"
	| "computer-safety"
	| "repo-context";

export const PROMPT_MODULE_IDS: readonly PromptModuleId[] = [
	"core",
	"runtime",
	"tool-policy",
	"delegation",
	"workflow",
	"testing",
	"delivery",
	"project",
	"computer-safety",
	"repo-context",
];

export type PromptModulePolicies = Partial<Record<PromptModuleId, PromptPolicy>>;
export type PromptCapabilityId =
	| "lsp"
	| "git"
	| "testing"
	| "subagents"
	| "browser"
	| "debugger"
	| "github"
	| "images"
	| "mcp";
export const PROMPT_CAPABILITY_IDS: readonly PromptCapabilityId[] = [
	"lsp",
	"git",
	"testing",
	"subagents",
	"browser",
	"debugger",
	"github",
	"images",
	"mcp",
];
export type PromptCapabilityPolicies = Partial<Record<PromptCapabilityId, PromptPolicy>>;

const FULL: Record<PromptModuleId, PromptPolicy> = {
	core: "always",
	runtime: "always",
	"tool-policy": "always",
	delegation: "always",
	workflow: "always",
	testing: "always",
	delivery: "always",
	project: "always",
	"computer-safety": "always",
	"repo-context": "always",
};

const PROFILES: Record<PromptProfile, PromptModulePolicies> = {
	full: FULL,
	minimal: { workflow: "disabled", delegation: "automatic" },
	coding: { delegation: "automatic" },
	agentic: { delegation: "always" },
	custom: {},
};

const CAPABILITY_DEFAULTS: Record<PromptProfile, PromptCapabilityPolicies> = {
	full: {},
	minimal: {
		testing: "automatic",
		subagents: "automatic",
		browser: "automatic",
		debugger: "automatic",
		github: "automatic",
		images: "automatic",
		mcp: "automatic",
	},
	coding: {
		testing: "always",
		subagents: "automatic",
		browser: "automatic",
		debugger: "automatic",
		github: "automatic",
		images: "automatic",
		mcp: "automatic",
	},
	agentic: {
		testing: "always",
		subagents: "always",
		browser: "automatic",
		debugger: "automatic",
		github: "automatic",
		images: "automatic",
		mcp: "automatic",
	},
	custom: {},
};

export function resolveCapabilityPolicies(
	profile: PromptProfile,
	overrides: PromptCapabilityPolicies = {},
): Record<PromptCapabilityId, PromptPolicy> {
	const defaults = CAPABILITY_DEFAULTS[profile];
	return Object.fromEntries(
		PROMPT_CAPABILITY_IDS.map(id => [id, overrides[id] ?? defaults[id] ?? "always"]),
	) as Record<PromptCapabilityId, PromptPolicy>;
}

export function validatePromptCapabilityPolicies(value: unknown): void {
	if (value === undefined) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("prompt.capabilities must be an object");
	}
	for (const [id, policy] of Object.entries(value)) {
		if (!PROMPT_CAPABILITY_IDS.includes(id as PromptCapabilityId))
			throw new Error(`Unknown prompt capability: ${id}`);
		if (policy !== "always" && policy !== "automatic" && policy !== "disabled") {
			throw new Error(`Invalid prompt capability policy for ${id}: ${String(policy)}`);
		}
	}
}

/** Critical runtime and user/project instructions cannot be switched off. */
const REQUIRED: ReadonlySet<PromptModuleId> = new Set([
	"core",
	"runtime",
	"tool-policy",
	"delivery",
	"project",
	"computer-safety",
]);

export function resolvePromptPolicies(
	profile: PromptProfile,
	overrides: PromptModulePolicies = {},
): Record<PromptModuleId, PromptPolicy> {
	const selected = PROFILES[profile];
	return Object.fromEntries(
		PROMPT_MODULE_IDS.map(id => [id, REQUIRED.has(id) ? "always" : (overrides[id] ?? selected[id] ?? "always")]),
	) as Record<PromptModuleId, PromptPolicy>;
}

export function validatePromptModulePolicies(value: unknown): void {
	if (value === undefined) return;
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("prompt.modules must be an object");
	}
	for (const [id, policy] of Object.entries(value)) {
		if (!PROMPT_MODULE_IDS.includes(id as PromptModuleId)) throw new Error(`Unknown prompt module: ${id}`);
		if (policy !== "always" && policy !== "automatic" && policy !== "disabled") {
			throw new Error(`Invalid prompt policy for ${id}: ${String(policy)}`);
		}
		if (REQUIRED.has(id as PromptModuleId) && policy === "disabled") {
			throw new Error(`Required prompt module cannot be disabled: ${id}`);
		}
	}
}
