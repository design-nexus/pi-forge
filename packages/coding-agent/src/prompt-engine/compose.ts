import type { Model } from "@oh-my-pi/pi-ai";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { TOOL_CAPABILITY_CATALOG } from "./capability-catalog";
import {
	PROMPT_MODULES,
	applicablePromptModelModuleIds,
	resolvePromptPolicies,
	resolveCapabilityPolicies,
	PROMPT_CAPABILITY_IDS,
	type PromptCapabilityId,
	type PromptCapabilityPolicies,
	type PromptModuleId,
	type PromptModulePolicies,
	type PromptPolicy,
	type PromptProfile,
} from "./profiles";

export interface PromptSection {
	id: PromptModuleId | "opaque";
	content: string;
	policy: PromptPolicy;
	active: boolean;
	reason: string;
	tokens: number;
	source: "bundled" | "model" | "custom";
}

export interface PromptModuleContent {
	id: PromptModuleId;
	content: string;
}

export interface PromptComposition {
	profile: PromptProfile;
	sections: PromptSection[];
	capabilities: Record<
		PromptCapabilityId,
		{ policy: PromptPolicy; active: boolean; available: boolean; reason: string }
	>;
	totalTokens: number;
	fullTokens: number;
}

interface SectionDraft {
	id: PromptSection["id"];
	content: string;
	available: boolean;
	source?: "model";
}

const BUNDLED_BOUNDARIES = [
	{ key: "core", id: "core" },
	{ key: "runtime", id: "runtime" },
	{ key: "toolPolicy", id: "tool-policy" },
	{ key: "delegation", id: "delegation", optional: true },
	{ key: "workflow", id: "workflow" },
	{ key: "testing", id: "testing" },
	{ key: "workflowCleanup", id: "workflow-cleanup" },
	{ key: "delivery", id: "delivery" },
] as const satisfies readonly { key: string; id: PromptModuleId; optional?: boolean }[];

export type BundledPromptMarkers = Record<(typeof BUNDLED_BOUNDARIES)[number]["key"], string>;

/** One render's markers are unique to its template, so user content cannot impersonate a section boundary. */
export function createBundledPromptMarkers(): BundledPromptMarkers {
	const nonce = crypto.randomUUID();
	return Object.fromEntries(
		BUNDLED_BOUNDARIES.map(({ key }) => [key, `\uE000${nonce}:${key}\uE001`]),
	) as BundledPromptMarkers;
}

/** Remove rendered boundaries while retaining the exact original prompt bytes in ordered sections. */
export function splitBundledPrompt(rendered: string, markers: BundledPromptMarkers): PromptModuleContent[] {
	const positions: Array<{ id: PromptModuleId; position: number; length: number }> = [];
	for (const boundary of BUNDLED_BOUNDARIES) {
		const marker = markers[boundary.key];
		const position = rendered.indexOf(marker);
		if (position < 0) {
			if ("optional" in boundary && boundary.optional) continue;
			throw new Error(`Bundled prompt section missing: ${boundary.id}`);
		}
		if (positions.length > 0 && position <= positions[positions.length - 1].position) {
			throw new Error(`Bundled prompt section out of order: ${boundary.id}`);
		}
		if (rendered.indexOf(marker, position + marker.length) >= 0) {
			throw new Error(`Bundled prompt section repeated: ${boundary.id}`);
		}
		positions.push({ id: boundary.id, position, length: marker.length });
	}
	const drafts: PromptModuleContent[] = [];
	if (positions[0].position > 0) {
		drafts.push({ id: "core", content: rendered.slice(0, positions[0].position) });
	}
	for (let i = 0; i < positions.length; i++) {
		const start = positions[i].position + positions[i].length;
		const end = positions[i + 1]?.position ?? rendered.length;
		drafts.push({ id: positions[i].id, content: rendered.slice(start, end) });
	}
	return drafts;
}

export interface ComposePromptOptions {
	profile: PromptProfile;
	overrides?: PromptModulePolicies;
	capabilities?: PromptCapabilityPolicies;
	model?: Pick<Model, "tokenizer" | "provider" | "api" | "identity" | "thinking"> | null;
	toolNames?: readonly string[];
	mountedToolNames?: readonly string[];
	activatedToolNames?: readonly string[];
	browserAvailable?: boolean;
	opaque?: boolean;
}

export interface ComposePromptBlocks {
	base: string;
	bundledSections?: readonly PromptModuleContent[];
	computerSafety?: string;
	project?: string;
	repoContext?: string;
	modelModules?: readonly PromptModuleContent[];
}

/** Resolve policies over rendered content and report text tokens without changing provider block shape. */
export function composePrompt(
	blocks: ComposePromptBlocks,
	options: ComposePromptOptions,
): { systemPrompt: string[]; composition: PromptComposition } {
	if (!options.opaque && !blocks.bundledSections) {
		throw new Error("Bundled prompt sections are required for composition");
	}
	const tokenizer = new Tokenizer(options.model);
	const policies = resolvePromptPolicies(options.profile, options.overrides);
	const applicableModelModules = new Set(applicablePromptModelModuleIds(options.model));
	const capabilityPolicies = resolveCapabilityPolicies(options.profile, options.capabilities);
	const directTools = new Set(options.toolNames ?? []);
	const mountedTools = new Set(options.mountedToolNames ?? []);
	const activatedTools = new Set(options.activatedToolNames ?? []);
	const capabilities = Object.fromEntries(
		PROMPT_CAPABILITY_IDS.map(id => {
			const tool = TOOL_CAPABILITY_CATALOG[id as keyof typeof TOOL_CAPABILITY_CATALOG]?.toolName;
			const direct = tool ? directTools.has(tool) : [...directTools].some(name => name.startsWith("mcp__"));
			const mounted = tool ? mountedTools.has(tool) : [...mountedTools].some(name => name.startsWith("mcp__"));
			const available = id === "browser" ? options.browserAvailable === true : direct || mounted;
			const policy = capabilityPolicies[id];
			const active =
				policy !== "disabled" &&
				available &&
				(policy === "always" || direct || (tool !== undefined && activatedTools.has(tool)));
			const reason =
				policy === "disabled"
					? "disabled by policy"
					: !available
						? "tool or runtime unavailable"
						: active
							? direct
								? "direct tool active"
								: "configured always"
							: "discoverable through xd://";
			return [id, { policy, active, available, reason }];
		}),
	) as PromptComposition["capabilities"];
	const originalBlocks = [blocks.base, blocks.computerSafety, blocks.project, blocks.repoContext].filter(
		(value): value is string => value !== undefined,
	);
	const modelBlocks = (blocks.modelModules ?? [])
		.filter(module => applicableModelModules.has(module.id))
		.map(module => module.content);
	const fullBlocks = options.opaque ? originalBlocks : [...originalBlocks, ...modelBlocks];
	const drafts: SectionDraft[] = options.opaque
		? originalBlocks.map(content => ({ id: "opaque", content, available: true }))
		: [
				...(blocks.bundledSections ?? []).map(section => ({ ...section, available: true })),
				...(blocks.computerSafety
					? [{ id: "computer-safety" as const, content: blocks.computerSafety, available: true }]
					: []),
				...(blocks.project ? [{ id: "project" as const, content: blocks.project, available: true }] : []),
				...(blocks.repoContext
					? [{ id: "repo-context" as const, content: blocks.repoContext, available: true }]
					: []),
				...(blocks.modelModules ?? []).map(module => ({
					id: module.id,
					content: module.content,
					available: applicableModelModules.has(module.id),
					source: "model" as const,
				})),
			];
	const sections = drafts.map(draft => {
		const policy =
			draft.id === "opaque"
				? "always"
				: PROMPT_MODULES.find(module => module.id === draft.id)?.modelApplicability
					? policies[draft.id]
					: draft.id === "delegation" && capabilityPolicies.subagents === "disabled"
						? "disabled"
						: draft.id === "testing"
							? policies.testing === "disabled"
								? "disabled"
								: capabilityPolicies.testing
							: draft.id === "repo-context"
								? policies["repo-context"] === "disabled"
									? "disabled"
									: capabilityPolicies.git
								: policies[draft.id];
		const active =
			draft.available &&
			(policy === "always" ||
				(policy === "automatic" &&
					(draft.id === "delegation"
						? directTools.has("task") || activatedTools.has("task")
						: draft.id === "testing"
							? directTools.has("bash") || options.browserAvailable === true
							: draft.available)));
		const reason =
			draft.id === "opaque"
				? "custom prompt"
				: PROMPT_MODULES.find(module => module.id === draft.id)?.modelApplicability
					? active
						? "model metadata matched"
						: "model metadata did not match"
					: policy === "disabled"
						? "disabled by policy"
						: draft.id === "delegation"
							? active
								? directTools.has("task")
									? "task tool active"
									: "task device activated"
								: "task tool not active"
							: draft.id === "testing"
								? active
									? "verification tools available"
									: "verification tools unavailable"
								: draft.id === "repo-context"
									? "active repository context"
									: "configured by profile";
		return {
			id: draft.id,
			content: draft.content,
			policy,
			active,
			reason,
			tokens: tokenizer.countTokens(draft.content, "strict"),
			source: draft.id === "opaque" ? "custom" : (draft.source ?? "bundled"),
		} satisfies PromptSection;
	});
	const systemPrompt = options.opaque
		? originalBlocks
		: [
				sections
					.filter(
						section =>
							section.active &&
							[
								"core",
								"runtime",
								"tool-policy",
								"delegation",
								"workflow",
								"workflow-cleanup",
								"testing",
								"delivery",
								"prefix-bound-tools",
							].includes(section.id),
					)
					.map(section => section.content)
					.join(""),
				...sections
					.filter(section => section.active && ["computer-safety", "project", "repo-context"].includes(section.id))
					.map(section => section.content),
			];
	return {
		systemPrompt,
		composition: {
			profile: options.profile,
			sections,
			capabilities,
			totalTokens: tokenizer.countTokens(systemPrompt, "strict"),
			fullTokens: tokenizer.countTokens(fullBlocks, "strict"),
		},
	};
}
