import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { buildSystemPrompt, type BuildSystemPromptOptions } from "../src/system-prompt";
import type { PromptProfile } from "../src/prompt-engine/profiles";

const model = getBundledModel("openai", "gpt-4o-mini");
const profiles: readonly PromptProfile[] = ["full", "minimal", "coding", "agentic"];
const cwd = import.meta.dir;
const commonTools = ["read", "write", "bash"];

interface Workload {
	name: string;
	tools: string[];
	browserEnabled?: boolean;
	context?: string;
}

const workloads: readonly Workload[] = [
	{ name: "simple-question", tools: ["read"] },
	{ name: "one-file-edit", tools: commonTools },
	{ name: "multi-file-coding", tools: [...commonTools, "find", "grep", "lsp"] },
	{ name: "debugging", tools: [...commonTools, "debug", "lsp"] },
	{ name: "git-operation", tools: commonTools },
	{ name: "browser-task", tools: [...commonTools, "eval"], browserEnabled: true },
	{ name: "task-agent-workflow", tools: [...commonTools, "task"] },
];

function options(profile: PromptProfile, tools: string[], workload: Workload, peak: boolean): BuildSystemPromptOptions {
	return {
		cwd,
		promptProfile: profile,
		tokenizerModel: model,
		contextFiles: workload.context ? [{ path: `${cwd}/AGENTS.md`, content: workload.context }] : [],
		skills: [],
		rules: [],
		toolNames: tools,
		browserEnabled: peak && workload.browserEnabled === true,
		eagerTasks: peak && tools.includes("task"),
		workspaceTree: { rootPath: cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
	};
}

const results = [];
for (const workload of workloads) {
	for (const profile of profiles) {
		const initial = await buildSystemPrompt(options(profile, commonTools, workload, false));
		const peak = await buildSystemPrompt(options(profile, workload.tools, workload, true));
		const tokenizer = new Tokenizer(model);
		const initialTokens = initial.composition?.totalTokens ?? tokenizer.countTokens(initial.systemPrompt, "strict");
		const scenarioTokens = peak.composition?.totalTokens ?? tokenizer.countTokens(peak.systemPrompt, "strict");
		results.push({
			workload: workload.name,
			profile,
			initialSystemPromptTokens: initialTokens,
			peakSystemPromptTokens: Math.max(initialTokens, scenarioTokens),
			activatedCapabilities: Object.entries(peak.composition?.capabilities ?? {})
				.filter(([, state]) => state.active)
				.map(([id]) => id),
			providerInputTokens: null,
			executionSuccess: null,
		});
	}
}

// Offline fixture benchmark: provider usage and execution success require a live task run.
console.log(
	JSON.stringify({ model: `${model.provider}/${model.id}`, mode: "offline-prompt-fixtures", results }, null, 2),
);
