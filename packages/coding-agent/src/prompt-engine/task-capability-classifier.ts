import type { TaskCapabilityId } from "./capability-catalog";

export type InferredTaskCapabilityId = Exclude<TaskCapabilityId, `mcp__${string}`>;

export interface ClassifiedTaskCapabilities {
	capabilities: InferredTaskCapabilityId[];
	confidence: number;
}

interface CapabilitySignal {
	id: InferredTaskCapabilityId;
	pattern: RegExp;
	confidence: number;
}

const CAPABILITY_SIGNALS: readonly CapabilitySignal[] = [
	{
		id: "lsp",
		pattern: /\b(find|show|list|rename) (all )?(references|definitions|symbols)\b|\b(go to|jump to) definition\b/i,
		confidence: 0.92,
	},
	{ id: "debugger", pattern: /\b(debugger|breakpoint|step through|inspect (the )?stack trace)\b/i, confidence: 0.94 },
	{ id: "github", pattern: /\b(github|pull request|\bPR review\b|create (an? )?issue)\b/i, confidence: 0.9 },
	{
		id: "browser",
		pattern:
			/\b(use|open|launch|control) (the )?(browser|web browser)\b|\b(open|inspect|interact with) (the |this )?(website|web page|webpage|URL)\b/i,
		confidence: 0.9,
	},
	{ id: "images", pattern: /\b(generate|create|edit) (an? )?(image|illustration|picture)\b/i, confidence: 0.9 },
];

const MINIMUM_CONFIDENCE = 0.85;

/** Infer only direct-tool capabilities from clear task wording. */
export function classifyTaskCapabilities(texts: readonly string[]): ClassifiedTaskCapabilities {
	const matched = new Map<InferredTaskCapabilityId, number>();
	for (const text of texts) {
		for (const signal of CAPABILITY_SIGNALS) {
			if (!signal.pattern.test(text)) continue;
			matched.set(signal.id, Math.max(matched.get(signal.id) ?? 0, signal.confidence));
		}
	}
	const capabilities = [...matched].filter(([, confidence]) => confidence >= MINIMUM_CONFIDENCE).map(([id]) => id);
	return {
		capabilities,
		confidence: capabilities.length === 0 ? 0 : Math.min(...capabilities.map(id => matched.get(id)!)),
	};
}
