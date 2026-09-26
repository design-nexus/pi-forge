import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { stringifyJson } from "@oh-my-pi/pi-utils";
import { createAgentSession, SessionManager, Settings } from "@oh-my-pi/pi-coding-agent";
import { cfgPromptProfile } from "../src/prompt-engine/settings";
import type { PromptProfile } from "../src/prompt-engine/profiles";

const profiles: readonly PromptProfile[] = ["full", "minimal", "coding", "agentic"];
const benchmarkPrompt = "Reply with exactly PI_PROMPT_BENCHMARK_OK. Do not use tools.";

const results = [];
let expectedModel: string | undefined;

for (const profile of profiles) {
	const settings = await Settings.loadIsolated({
		cwd: process.cwd(),
		inMemory: true,
		overrides: { [cfgPromptProfile.id]: profile },
	});
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		({ session } = await createAgentSession({
			cwd: process.cwd(),
			settings,
			sessionManager: SessionManager.inMemory(),
			bindProcessState: false,
		}));
		const model = session.model;
		if (!model) throw new Error("No model is configured for this OMP session.");
		const modelId = `${model.provider}/${model.id}`;
		if (expectedModel && modelId !== expectedModel) {
			throw new Error(`Model changed between profiles: expected ${expectedModel}, got ${modelId}`);
		}
		expectedModel = modelId;

		const tokenizer = new Tokenizer(model);
		const systemPromptTokens = tokenizer.countTokens(session.systemPrompt, "strict");
		const toolFragments = session.agent.state.tools.flatMap(tool => [
			tool.name,
			tool.description,
			stringifyJson(tool.parameters) ?? "",
		]);
		const toolSchemaTokens = tokenizer.countTokens(toolFragments);

		await session.prompt(benchmarkPrompt);
		const response = session.getLastAssistantMessage();
		if (!response?.usage) throw new Error(`Provider returned no usage data for ${modelId}.`);
		results.push({
			profile,
			model: modelId,
			localSystemPromptTokens: systemPromptTokens,
			localToolSchemaTokens: toolSchemaTokens,
			localCombinedTokens: systemPromptTokens + toolSchemaTokens,
			providerInputTokens: response.usage.input + response.usage.cacheRead + response.usage.cacheWrite,
			providerUncachedInputTokens: response.usage.input,
			providerCacheReadTokens: response.usage.cacheRead,
			providerCacheWriteTokens: response.usage.cacheWrite,
			providerOutputTokens: response.usage.output,
			stopReason: response.stopReason,
		});
	} finally {
		await session?.dispose();
	}
}

console.log(
	JSON.stringify(
		{
			mode: "live-provider-first-turn",
			cwd: process.cwd(),
			prompt: benchmarkPrompt,
			results,
		},
		null,
		2,
	),
);
