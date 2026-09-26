import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { stringifyJson } from "@oh-my-pi/pi-utils";
import type { AgentSession } from "../session/agent-session";
import { composePrompt } from "./compose";
import { PROMPT_CAPABILITY_IDS, type PromptProfile } from "./profiles";
import { cfgPromptCapabilities, cfgPromptModules, cfgPromptProfile } from "./settings";

const COMPARABLE_PROFILES: readonly PromptProfile[] = ["full", "minimal", "coding", "agentic"];

function promptBlocks(session: AgentSession): {
	base: string;
	computerSafety?: string;
	project?: string;
	repoContext?: string;
} | null {
	const sections = session.promptComposition?.sections;
	if (!sections?.length || sections.some(section => section.id === "opaque")) return null;
	const separate = new Map(
		sections.filter(section => section.id !== "opaque").map(section => [section.id, section.content]),
	);
	const base = sections
		.filter(section => !["computer-safety", "project", "repo-context", "opaque"].includes(section.id))
		.map(section => section.content)
		.join("");
	return {
		base,
		computerSafety: separate.get("computer-safety"),
		project: separate.get("project"),
		repoContext: separate.get("repo-context"),
	};
}

function countToolSchemaTokens(session: AgentSession, tokenizer: Tokenizer): number {
	const fragments: string[] = [];
	for (const tool of session.agent.state.tools) {
		fragments.push(tool.name, tool.description, stringifyJson(tool.parameters) ?? "");
	}
	return tokenizer.countTokens(fragments);
}

/** Compare all profiles against the same rendered live-session context and wire tools. */
export function promptCompare(session: AgentSession): string {
	const blocks = promptBlocks(session);
	if (!blocks) {
		return "Profile comparison is unavailable for an opaque custom system prompt. Run this with the bundled or sectioned prompt template.";
	}
	const model = session.agent.state.model;
	const tokenizer = new Tokenizer(model);
	const toolNames = session.getActiveToolNames();
	const enabledNames = session.getEnabledToolNames();
	const active = new Set(toolNames);
	const mountedToolNames = enabledNames.filter(name => !active.has(name));
	const shared = {
		overrides: { ...cfgPromptModules.get(session.settings), ...session.promptSettingsOverride?.modules },
		capabilities: { ...cfgPromptCapabilities.get(session.settings), ...session.promptSettingsOverride?.capabilities },
		model,
		toolNames,
		mountedToolNames,
		browserAvailable: session.promptComposition?.capabilities.browser.available === true,
	};
	const toolSchemaTokens = countToolSchemaTokens(session, tokenizer);
	const rows = COMPARABLE_PROFILES.map(profile => {
		const { composition } = composePrompt(blocks, { ...shared, profile });
		return {
			profile,
			system: composition.totalTokens,
			tools: toolSchemaTokens,
			total: composition.totalTokens + toolSchemaTokens,
		};
	});
	const baseline = rows.find(row => row.profile === "full")?.total ?? 0;
	const lines = [
		"Same live session inputs; local tokenizer estimates (provider framing excluded):",
		"",
		"| Profile | System prompt | Tool schemas | Combined | vs Full |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const row of rows) {
		const delta = row.total - baseline;
		lines.push(
			`| ${row.profile} | ${row.system.toLocaleString()} | ${row.tools.toLocaleString()} | ${row.total.toLocaleString()} | ${delta > 0 ? "+" : ""}${delta.toLocaleString()} |`,
		);
	}
	lines.push(
		"",
		"This reuses the current session's rendered project context and provider tool schemas. Provider-reported input and cache-read tokens require sending the same fixed first-turn task under each profile.",
	);
	return lines.join("\n");
}

export function promptStats(session: AgentSession): string {
	const composition = session.promptComposition;
	const sessionOverride = session.promptSettingsOverride;
	const profile = sessionOverride?.profile ?? cfgPromptProfile.get(session.settings);
	const profileSource = sessionOverride?.profile ? "session" : session.settings.getProvenance(cfgPromptProfile);
	const moduleSource = sessionOverride?.modules ? "session" : session.settings.getProvenance(cfgPromptModules);
	const capabilitySource = sessionOverride?.capabilities ? "session" : session.settings.getProvenance(cfgPromptCapabilities);
	if (!composition) {
		return `Profile: ${profile} (${profileSource})\nThe current prompt is an opaque SDK override; module accounting is unavailable.`;
	}
	const lines = [
		`Profile: ${composition.profile} · source: ${profileSource}`,
		`Module policies source: ${moduleSource} · capability policies source: ${capabilitySource}`,
		`System prompt text: ${composition.totalTokens.toLocaleString()} tokens`,
	];
	const history = session.promptCompositionHistory;
	if (history.length) {
		const startup = history[0];
		const delta = composition.totalTokens - startup.totalTokens;
		lines.push(`Startup prompt: ${startup.totalTokens.toLocaleString()} tokens · current delta: ${delta > 0 ? "+" : ""}${delta.toLocaleString()}`);
		for (const change of history.slice(1).slice(-5)) {
			const labels = [
				...(change.added.length ? [`loaded ${change.added.join(", ")}`] : []),
				...(change.removed.length ? [`unloaded ${change.removed.join(", ")}`] : []),
			].join("; ") || "prompt refreshed";
			lines.push(`Prompt change: ${change.deltaTokens > 0 ? "+" : ""}${change.deltaTokens.toLocaleString()} tokens · ${labels}`);
		}
	}
	if (composition.sections.every(section => section.id === "opaque")) {
		lines.push("Full comparison unavailable for a custom prompt.");
	} else {
		lines.push(
			`Full sections with the same tools: ${composition.fullTokens.toLocaleString()} text tokens`,
			`Estimated text savings: ${Math.max(0, composition.fullTokens - composition.totalTokens).toLocaleString()} tokens`,
		);
	}
	lines.push("", "Modules:");
	for (const section of composition.sections) {
		lines.push(
			`- ${section.id}: ${section.active ? "loaded" : "available"} · ${section.policy} · ${section.tokens.toLocaleString()} tokens · ${section.reason} · ${section.source}`,
		);
	}
	lines.push("", "Capabilities (guidance tokens are counted in the modules above):");
	for (const id of PROMPT_CAPABILITY_IDS) {
		const capability = composition.capabilities[id];
		lines.push(
			`- ${id}: ${capability.policy === "disabled" ? "disabled" : capability.active ? "active" : capability.available && capability.policy === "automatic" ? "discoverable" : "unavailable"} · ${capability.policy} · ${capability.reason}`,
		);
	}
	return lines.join("\n");
}

export function promptInspect(session: AgentSession, options: { redact?: boolean } = {}): string {
	if (options.redact && !session.obfuscator?.obfuscates()) {
		return "Prompt inspection stopped: no configured secret redactor is active, so sensitive values cannot be safely redacted.";
	}
	const composition = session.promptComposition;
	const base = composition?.sections.filter(section => section.active) ?? [];
	const redact = (value: string): string => (options.redact ? (session.obfuscator?.obfuscate(value) ?? value) : value);
	if (base.length === 0) {
		const sessionOverride = session.promptSettingsOverride;
		const profileSource = sessionOverride?.profile ? "session" : session.settings.getProvenance(cfgPromptProfile);
		const moduleSource = sessionOverride?.modules ? "session" : session.settings.getProvenance(cfgPromptModules);
		const capabilitySource = sessionOverride?.capabilities ? "session" : session.settings.getProvenance(cfgPromptCapabilities);
		const provenance = `Profile source: ${profileSource} · module policies source: ${moduleSource} · capability policies source: ${capabilitySource}\n\n`;
		return session.systemPrompt
			.map((content, index) => `${index === 0 ? provenance : ""}--- Prompt block ${index + 1} ---\n${redact(content)}`)
			.join("\n\n");
	}
	const sessionOverride = session.promptSettingsOverride;
	const profileSource = sessionOverride?.profile ? "session" : session.settings.getProvenance(cfgPromptProfile);
	const moduleSource = sessionOverride?.modules ? "session" : session.settings.getProvenance(cfgPromptModules);
	const capabilitySource = sessionOverride?.capabilities ? "session" : session.settings.getProvenance(cfgPromptCapabilities);
	const assembled = [
		`Profile: ${session.promptComposition?.profile ?? cfgPromptProfile.get(session.settings)} · source: ${profileSource}`,
		`Module policies source: ${moduleSource} · capability policies source: ${capabilitySource}`,
		...base.map(section => `--- ${section.id} (${section.reason}; ${section.source}) ---\n${redact(section.content)}`),
	].join("\n\n");
	const basePrompt = base.map(section => section.content).join("");
	const current = session.systemPrompt.join("");
	return current === basePrompt
		? assembled
		: `${assembled}\n\n--- Current turn override or injected context ---\n${redact(current)}`;
}
