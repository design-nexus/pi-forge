import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { stringifyJson } from "@oh-my-pi/pi-utils";
import { createAgentSession, SessionManager, Settings } from "@oh-my-pi/pi-coding-agent";
import benchmarkPrompt from "./fixtures/phase0-first-turn.md" with { type: "text" };

const settings = await Settings.loadIsolated({ cwd: process.cwd(), inMemory: true });
const { session } = await createAgentSession({
	cwd: process.cwd(),
	settings,
	sessionManager: SessionManager.inMemory(),
	bindProcessState: false,
});

try {
	const model = session.model;
	if (!model) throw new Error("No model is configured for this OMP session.");
	const modelId = `${model.provider}/${model.id}`;
	const tokenizer = new Tokenizer(model);
	const systemPromptTokens = tokenizer.countTokens(session.systemPrompt, "strict");
	const toolFragments = session.agent.state.tools.flatMap(tool => [
		tool.name,
		tool.description,
		stringifyJson(tool.parameters) ?? "",
	]);
	const toolSchemaTokens = tokenizer.countTokens(toolFragments);
	await session.prompt(benchmarkPrompt.trim());
	const response = session.getLastAssistantMessage();
	if (!response?.usage) throw new Error(`Provider returned no usage data for ${modelId}.`);
	console.log(
		JSON.stringify(
			{
				mode: "live-provider-first-turn",
				cwd: process.cwd(),
				prompt: benchmarkPrompt.trim(),
				model: modelId,
				systemPromptTokens,
				toolSchemaTokens,
				localCombinedTokens: systemPromptTokens + toolSchemaTokens,
				providerInputTokens: response.usage.input + response.usage.cacheRead + response.usage.cacheWrite,
				providerUncachedInputTokens: response.usage.input,
				providerCacheReadTokens: response.usage.cacheRead,
				providerCacheWriteTokens: response.usage.cacheWrite,
				providerOutputTokens: response.usage.output,
				stopReason: response.stopReason,
			},
			null,
			2,
		),
	);
} finally {
	await session.dispose();
}
