/** Policies for sections of the bundled system prompt. */
export type PromptPolicy = "always" | "automatic" | "disabled";
export type PromptProfile = "minimal" | "coding" | "agentic" | "full" | "custom";
export type PromptModuleId =
	| "core"
	| "runtime"
	| "tool-policy"
	| "delegation"
	| "workflow"
	| "workflow-cleanup"
	| "testing"
	| "delivery"
	| "project"
	| "computer-safety"
	| "repo-context"
	| "prefix-bound-tools";

export interface PromptModelApplicability {
	providers?: readonly string[];
	apis?: readonly string[];
	classes?: readonly string[];
	families?: readonly string[];
	prefixBinding?: boolean;
}

export interface PromptModuleDefinition {
	id: PromptModuleId;
	name: string;
	description: string;
	required: boolean;
	modelApplicability?: PromptModelApplicability;
}

/** Metadata catalog for the bundled prompt sections and model-specific additions. */
export const PROMPT_MODULES: readonly PromptModuleDefinition[] = [
	{ id: "core", name: "Core", description: "Role and essential engineering constraints.", required: true },
	{ id: "runtime", name: "Runtime", description: "Live tools, skills, and environment context.", required: true },
	{ id: "tool-policy", name: "Tool Policy", description: "Rules for using available tools.", required: true },
	{ id: "delegation", name: "Delegation", description: "Planning and subagent guidance.", required: false },
	{ id: "workflow", name: "Workflow", description: "Scope, research, decomposition, and implementation.", required: false },
	{ id: "workflow-cleanup", name: "Workflow Cleanup", description: "Post-change cleanup guidance.", required: false },
	{ id: "testing", name: "Testing", description: "Verification guidance.", required: false },
	{ id: "delivery", name: "Delivery", description: "Completion and reporting requirements.", required: true },
	{ id: "project", name: "Project", description: "Project instructions and local context.", required: true },
	{ id: "computer-safety", name: "Computer Safety", description: "Host desktop interaction constraints.", required: true },
	{ id: "repo-context", name: "Repository Context", description: "Active repository-specific guidance.", required: false },
	{
		id: "prefix-bound-tools",
		name: "Prefix-bound Tools",
		description: "Guidance for models whose tool roster is bound to the cached prompt prefix.",
		required: false,
		modelApplicability: { prefixBinding: true },
	},
];

export const PROMPT_MODULE_IDS: readonly PromptModuleId[] = PROMPT_MODULES.map(module => module.id);

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

export interface PromptSessionOverrides {
	profile?: PromptProfile;
	modules?: PromptModulePolicies;
	capabilities?: PromptCapabilityPolicies;
}

const FULL: Record<PromptModuleId, PromptPolicy> = {
	core: "always",
	runtime: "always",
	"tool-policy": "always",
	delegation: "always",
	workflow: "always",
	"workflow-cleanup": "always",
	testing: "always",
	delivery: "always",
	project: "always",
	"computer-safety": "always",
	"repo-context": "always",
	"prefix-bound-tools": "automatic",
};

const PROFILES: Record<PromptProfile, PromptModulePolicies> = {
	full: FULL,
	minimal: { workflow: "disabled", "workflow-cleanup": "disabled", delegation: "automatic" },
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
		PROMPT_MODULE_IDS.map(id => [
			id,
			REQUIRED.has(id)
				? "always"
				: (overrides[id] ?? selected[id] ?? (PROMPT_MODULES.find(module => module.id === id)?.modelApplicability ? "automatic" : "always")),
		]),
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
		if (PROMPT_MODULES.find(module => module.id === id)?.required && policy === "disabled") {
			throw new Error(`Required prompt module cannot be disabled: ${id}`);
		}
	}
}
