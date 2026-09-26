import type { Model } from "@oh-my-pi/pi-ai";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import {
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
}

/** Split the already-rendered bundled template; concatenating all sections reproduces its exact bytes. */
export function splitBundledPrompt(rendered: string): SectionDraft[] {
	const headings: Array<{ id: PromptModuleId; marker: string }> = [
		{ id: "core", marker: "§ Role" },
		{ id: "runtime", marker: "§ Runtime" },
		{ id: "tool-policy", marker: "§ Tool Policy" },
		{ id: "delegation", marker: "# Delegation" },
		{ id: "workflow", marker: "§ Workflow" },
		{ id: "testing", marker: "# 5. Verify" },
		{ id: "workflow", marker: "# 6. Cleanup" },
		{ id: "delivery", marker: "§ Delivery" },
	];
	const positions = headings
		.map(({ id, marker }) => ({ id, position: rendered.indexOf(marker) }))
		.filter(entry => entry.position >= 0)
		.sort((a, b) => a.position - b.position);
	if (positions.length === 0 || positions[0].id !== "core") {
		return [{ id: "opaque", content: rendered, available: true }];
	}
	const drafts: SectionDraft[] = [];
	if (positions[0].position > 0) {
		drafts.push({ id: "core", content: rendered.slice(0, positions[0].position), available: true });
	}
	for (let i = 0; i < positions.length; i++) {
		const start = positions[i].position;
		const end = positions[i + 1]?.position ?? rendered.length;
		drafts.push({ id: positions[i].id, content: rendered.slice(start, end), available: true });
	}
	return drafts;
}

export interface ComposePromptOptions {
	profile: PromptProfile;
	overrides?: PromptModulePolicies;
	capabilities?: PromptCapabilityPolicies;
	model?: Pick<Model, "tokenizer"> | null;
	toolNames?: readonly string[];
	mountedToolNames?: readonly string[];
	activatedToolNames?: readonly string[];
	browserAvailable?: boolean;
	opaque?: boolean;
}

export interface ComposePromptBlocks {
	base: string;
	computerSafety?: string;
	project?: string;
	repoContext?: string;
}

/** Resolve policies over rendered content and report text tokens without changing provider block shape. */
export function composePrompt(
	blocks: ComposePromptBlocks,
	options: ComposePromptOptions,
): { systemPrompt: string[]; composition: PromptComposition } {
	const tokenizer = new Tokenizer(options.model);
	const policies = resolvePromptPolicies(options.profile, options.overrides);
	const capabilityPolicies = resolveCapabilityPolicies(options.profile, options.capabilities);
	const directTools = new Set(options.toolNames ?? []);
	const mountedTools = new Set(options.mountedToolNames ?? []);
	const activatedTools = new Set(options.activatedToolNames ?? []);
	const capabilityTools: Partial<Record<PromptCapabilityId, string>> = {
		lsp: "lsp",
		git: "bash",
		testing: "bash",
		subagents: "task",
		browser: "eval",
		debugger: "debug",
		github: "github",
		images: "generate_image",
	};
	const capabilities = Object.fromEntries(
		PROMPT_CAPABILITY_IDS.map(id => {
			const tool = capabilityTools[id];
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
	const drafts: SectionDraft[] = options.opaque
		? originalBlocks.map(content => ({ id: "opaque", content, available: true }))
		: [
				...splitBundledPrompt(blocks.base),
				...(blocks.computerSafety
					? [{ id: "computer-safety" as const, content: blocks.computerSafety, available: true }]
					: []),
				...(blocks.project ? [{ id: "project" as const, content: blocks.project, available: true }] : []),
				...(blocks.repoContext
					? [{ id: "repo-context" as const, content: blocks.repoContext, available: true }]
					: []),
			];
	const sections = drafts.map(draft => {
		const policy =
			draft.id === "opaque"
				? "always"
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
			policy === "always" ||
			(policy === "automatic" &&
				(draft.id === "delegation"
					? directTools.has("task") || activatedTools.has("task")
					: draft.id === "testing"
						? directTools.has("bash") || options.browserAvailable === true
						: draft.available));
		const reason =
			draft.id === "opaque"
				? "custom prompt"
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
		} satisfies PromptSection;
	});
	const systemPrompt = options.opaque
		? originalBlocks
		: [
				sections
					.filter(
						section =>
							section.active &&
							["core", "runtime", "tool-policy", "delegation", "workflow", "testing", "delivery"].includes(
								section.id,
							),
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
			fullTokens: tokenizer.countTokens(originalBlocks, "strict"),
		},
	};
}
