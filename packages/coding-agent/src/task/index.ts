import { subprocessToolRegistry } from "./subprocess-tool-registry";
import { isTaskToolDetails } from "@oh-my-pi/pi-tui/tools/task";
import { taskSubprocessRenderer } from "@oh-my-pi/pi-tui/tools/subprocess";
/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Discovers agent definitions from:
 *   - Bundled agents (shipped with omp-coding-agent)
 *   - ~/.omp/agent/agents/*.md (user-level)
 *   - .omp/agents/*.md (project-level)
 *
 * Supports:
 *   - Single agent spawn per call (parallelism = parallel task calls)
 *   - Batch spawning + shared context per call when `task.batch` is enabled
 *   - Background execution through AsyncJobManager when `async.enabled` is enabled
 *   - Progress tracking via JSON events
 *   - Session artifacts for debugging
 */
import path from "node:path";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { $env, isRecord, logger, prompt } from "@oh-my-pi/pi-utils";
import type { ToolSession } from "..";
import { resolveCapabilityPolicies, resolvePromptPolicies } from "../prompt-engine/profiles";
import { cfgPromptCapabilities, cfgPromptModules, cfgPromptProfile } from "../prompt-engine/settings";
import { cfgAdaptiveMode } from "../governor/settings";
import type { GovernorTaskFacts } from "../governor/task-facts";
import type { GovernorTaskPlan, GovernorVerificationPolicy } from "../governor/task-batch";
import { isTaskCapabilityId, type TaskCapabilityId } from "../prompt-engine/capability-catalog";
import { classifyTaskCapabilities } from "../prompt-engine/task-capability-classifier";
import type { EffectiveExtensionRoots } from "../capability/types";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import subagentUserPromptTemplate from "../prompts/system/subagent-user-prompt.md" with { type: "text" };
import taskDescriptionTemplate from "../prompts/tools/task.md" with { type: "text" };
import taskAsyncContractTemplate from "../prompts/tools/task-async-contract.md" with { type: "text" };
import taskCoordinationAdvisoryTemplate from "../prompts/tools/task-coordination-advisory.md" with { type: "text" };
import taskSpawnFeedbackTemplate from "../prompts/tools/task-spawn-feedback.md" with { type: "text" };
import taskSpecializationAdvisoryTemplate from "../prompts/tools/task-specialization-advisory.md" with { type: "text" };
import taskGovernorVerificationTemplate from "../prompts/tools/task-governor-verification.md" with { type: "text" };
import taskGovernorReviewTemplate from "../prompts/tools/task-governor-review.md" with { type: "text" };
import taskGovernorReviewAssignmentTemplate from "../prompts/tools/task-governor-review-assignment.md" with { type: "text" };
import taskIntegrationGateTemplate from "../prompts/tools/task-integration-gate.md" with { type: "text" };
import taskFollowUpTemplate from "../prompts/tools/task-follow-up.md" with { type: "text" };
import { TASK_EFFORTS, type TaskEffort } from "@oh-my-pi/pi-tui/thinking";
import { truncateForPrompt } from "../tools/approval";
import { hasWaitTool } from "../tools/wait";
import { isIrcEnabled } from "../irc/messaging";
import { isReadOnlyAgent } from "./read-only-policy";
import { formatTaskResultSummary } from "./result-summary";
import { isScoutSpawnable, resolveSpawnPolicy } from "./spawn-policy";
import {
	DEFAULT_REPAIR_BUDGET,
	IntegrationGate,
	IntegrationRepairBudget,
	integrationGateFailure,
	integrationOrder,
	type RepairBudgetLimits,
} from "./integration-gate";
import { type AgentDefinition, canSpawnAtDepth, getTaskSchema, type TaskToolSchemaInstance } from "./types";
import {
	type AgentProgress,
	type SingleResult,
	type TaskItem,
	type TaskParams,
	type TaskToolDetails,
} from "@oh-my-pi/pi-tui/tools/task";
import { AsyncJobError, type AsyncJobManager } from "../async";
import { hasResolvableTranscript } from "../internal-urls/registry-helpers";
import { AgentRegistry } from "../registry/agent-registry";
import { type DiscoveryResult, discoverAgents } from "./discovery";
import { createEvalCustomTools, describeEvalTools, evalToolsEnabled } from "./eval-tools";
import { generateTaskName } from "./name-generator";
import { AgentOutputManager } from "./output-manager";
import { mapWithConcurrencyLimitAllSettled, Semaphore, sessionTaskSemaphore } from "./parallel";
import { renderResult, renderCall as renderTaskCall } from "@oh-my-pi/pi-tui/tools/task";
import { repairTaskParams } from "@oh-my-pi/pi-tui/tools/task-repair-args";
import {
	resolveEffectiveSubagentPolicy,
	runStructuredSubagent,
	StructuredSubagentError,
	type EffectiveSubagentPolicy,
	type StructuredSubagentResult,
} from "./structured-subagent";
import { formatModelRoleAlias } from "../config/model-roles";

import { cfgAsyncEnabled } from "../tools/settings";
import {
	cfgTaskBatch,
	cfgTaskDisabledAgents,
	cfgTaskEnableEffort,
	cfgTaskEnableLsp,
	cfgTaskIsolationApply,
	cfgTaskIsolationEnabled,
	cfgTaskMaxConcurrency,
	cfgTaskMaxRecursionDepth,
	cfgTaskMaxRuntimeMs,
	cfgTaskRepairBudget,
} from "./settings";

function renderSubagentUserPrompt(assignment: string): string {
	return prompt.render(subagentUserPromptTemplate, {
		assignment: assignment.trim(),
	});
}

function createUsageTotals(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsageTotals(target: Usage, usage: Partial<Usage>): void {
	const input = usage.input ?? 0;
	const output = usage.output ?? 0;
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	const totalTokens = usage.totalTokens ?? input + output + cacheRead + cacheWrite;
	const cost =
		usage.cost ??
		({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		} satisfies Usage["cost"]);

	target.input += input;
	target.output += output;
	target.cacheRead += cacheRead;
	target.cacheWrite += cacheWrite;
	target.totalTokens += totalTokens;
	target.cost.input += cost.input;
	target.cost.output += cost.output;
	target.cost.cacheRead += cost.cacheRead;
	target.cost.cacheWrite += cost.cacheWrite;
	target.cost.total += cost.total;
}

// Re-export types and utilities
export { loadBundledAgents as BUNDLED_AGENTS } from "./agents";
export { discoverCommands, expandCommand, getCommand } from "./commands";
export { discoverAgents, getAgent } from "./discovery";
export { AgentOutputManager } from "./output-manager";
export * from "./read-only-policy";
export type { AgentDefinition, SubagentEventPayload, SubagentLifecyclePayload, SubagentProgressPayload } from "./types";
export type { AgentProgress, SingleResult, TaskParams, TaskToolDetails } from "@oh-my-pi/pi-tui/tools/task";
export * from "./result-summary";
export {
	TASK_SUBAGENT_EVENT_CHANNEL,
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
	taskSchema,
} from "./types";

interface TaskDescriptionOptions {
	agents: AgentDefinition[];
	sessionAgents: readonly AgentDefinition[];
	isolationEnabled: boolean;
	applyIsolatedChanges: boolean;
	disabledAgents: string[];
	batchEnabled: boolean;
	effortEnabled: boolean;
	evalToolsEnabled: boolean;
	capabilityRoutingEnabled: boolean;
	governorEnabled: boolean;
	asyncEnabled: boolean;
	ircEnabled: boolean;
	parentSpawns: string;
}

/** Render the tool description from a cached agent list and current settings. */
function renderDescription(options: TaskDescriptionOptions): string {
	const spawnPolicy = resolveSpawnPolicy(options.parentSpawns);
	const spawningDisabled = !spawnPolicy.enabled;
	const agents = [...options.agents, ...options.sessionAgents];
	let filteredAgents =
		options.disabledAgents.length > 0 ? agents.filter(agent => !options.disabledAgents.includes(agent.name)) : agents;
	if (spawningDisabled) {
		filteredAgents = [];
	} else if (spawnPolicy.allowedAgents !== null) {
		const allowed = new Set(spawnPolicy.allowedAgents);
		filteredAgents = filteredAgents.filter(agent => allowed.has(agent.name));
	}
	const renderedAgents = filteredAgents.map(agent => ({
		name: agent.name,
		description: agent.description,
		readOnly: isReadOnlyAgent(agent),
		blocking: agent.blocking === true,
	}));
	const scoutAvailable = isScoutSpawnable(options.disabledAgents, options.parentSpawns);
	return prompt.render(taskDescriptionTemplate, {
		agents: renderedAgents,
		scoutAvailable,
		spawningDisabled,
		defaultAgent: spawnPolicy.defaultAgent,
		isolationEnabled: options.isolationEnabled,
		applyIsolatedChanges: options.applyIsolatedChanges,
		batchEnabled: options.batchEnabled,
		effortEnabled: options.effortEnabled,
		evalToolsEnabled: options.evalToolsEnabled,
		capabilityRoutingEnabled: options.capabilityRoutingEnabled,
		governorEnabled: options.governorEnabled,
		asyncEnabled: options.asyncEnabled,
		hasBlockingAgents: renderedAgents.some(agent => agent.blocking),
		hasModelMentions: options.sessionAgents.length > 0,
		ircEnabled: options.ircEnabled,
	});
}

function createTaskModeError(text: string): AgentToolResult<TaskToolDetails> {
	return {
		content: [{ type: "text", text }],
		details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
	};
}

/**
 * Reject legacy fields and shape/configuration combinations the current tool
 * cannot accept. `outputSchema` is a first-class per-spawn field; stale
 * `schema` remains an eval-only alias and is rejected.
 */
function validateShapeParams(batchEnabled: boolean, params: TaskParams): string | undefined {
	if (params.highRisk !== undefined && typeof params.highRisk !== "boolean") {
		return "`highRisk` must be a boolean.";
	}
	if (Object.hasOwn(params, "schema")) {
		return "The task tool uses `outputSchema`; rename the stale `schema` field.";
	}
	if (!batchEnabled) {
		const disallowed = (["tasks", "context"] as const).filter(field => params[field] !== undefined);
		if (disallowed.length > 0) {
			return `task.batch is disabled, so the task tool does not accept ${disallowed.map(f => `\`${f}\``).join(" or ")}. Spawn one agent per call with \`task\`, or enable the task.batch setting.`;
		}
	}
	if (params.capabilities !== undefined) {
		if (!Array.isArray(params.capabilities) || params.capabilities.some(id => !isTaskToolCapabilityId(id))) {
			return "`capabilities` must contain supported direct-tool capability names.";
		}
	}
	return undefined;
}

function isTaskToolCapabilityId(value: unknown): value is TaskCapabilityId {
	return isTaskCapabilityId(value);
}

/**
 * Validate the spawn parameter contract against the wire shapes. With
 * `task.batch` the model-facing shape is `{ context, tasks[] }` — `tasks`
 * non-empty with per-item `task` instructions and unique names, `context`
 * non-empty, no top-level `task` alongside. The flat `{ agent?, ...item }`
 * form stays accepted at runtime under either setting (internal callers, stale
 * transcripts). Missing `agent` values resolve against the session spawn
 * policy later, in `spawnParamsFor`. Returns a problem description, or
 * undefined when valid.
 */

/** Reject an out-of-range `effort` selector on internal/stale-transcript calls that bypass the wire schema. */
function validateEffort(effort: TaskEffort | undefined, label: string): string | undefined {
	if (effort === undefined || TASK_EFFORTS.includes(effort)) return undefined;
	return `${label} has an invalid \`effort\` value ${JSON.stringify(effort)}. Use "lo", "med", or "hi".`;
}

function validateSpawnParams(params: TaskParams, batchEnabled: boolean): string | undefined {
	const hasTask = typeof params.task === "string" && params.task.trim() !== "";
	const tasks = params.tasks;
	if (batchEnabled && tasks !== undefined) {
		if (!Array.isArray(tasks) || tasks.length === 0) {
			return "Missing `tasks`. Provide at least one task item ({ name?, agent?, task }).";
		}
		if (hasTask) {
			return "Top-level `task` is not part of the batch shape. Put the work in `tasks[]` items.";
		}
		for (let i = 0; i < tasks.length; i++) {
			const item = tasks[i];
			if (!item || typeof item.task !== "string" || item.task.trim() === "") {
				return `Task ${i + 1}${item?.name ? ` (\`${item.name}\`)` : ""} is missing \`task\`. Every task needs complete, self-contained instructions.`;
			}
			const effortError = validateEffort(item.effort, `Task ${i + 1}${item.name ? ` (\`${item.name}\`)` : ""}`);
			if (effortError) return effortError;
			if (item.capabilities?.some(id => !isTaskToolCapabilityId(id))) {
				return `Task ${i + 1} has an unsupported direct-tool capability.`;
			}
			if (item.highRisk !== undefined && typeof item.highRisk !== "boolean") {
				return `Task ${i + 1} has an invalid highRisk value.`;
			}
			if (
				item.dependsOn !== undefined &&
				(!Array.isArray(item.dependsOn) ||
					item.dependsOn.some(name => typeof name !== "string" || name.trim() === ""))
			) {
				return `Task ${i + 1} has invalid dependencies; use prerequisite task names.`;
			}
		}
		const seen = new Map<string, string>();
		for (const item of tasks) {
			const name = item.name?.trim();
			if (!name) continue;
			const key = name.toLowerCase();
			const existing = seen.get(key);
			if (existing !== undefined) {
				return `Duplicate task name ${existing === name ? `\`${name}\`` : `\`${existing}\` / \`${name}\``}. Provided names must be unique within a call (case-insensitive).`;
			}
			seen.set(key, name);
		}
		const nameToIndex = new Map(
			tasks.flatMap((item, index) => {
				const name = item.name?.trim();
				return name ? [[name.toLowerCase(), index] as const] : [];
			}),
		);
		const dependencyCounts = Array.from({ length: tasks.length }, () => 0);
		const dependents = new Map<number, number[]>();
		for (let index = 0; index < tasks.length; index++) {
			const item = tasks[index]!;
			const dependencies = item.dependsOn ?? [];
			if (new Set(dependencies.map(name => name.trim().toLowerCase())).size !== dependencies.length) {
				return `Task ${index + 1} lists a prerequisite more than once.`;
			}
			for (const dependency of dependencies) {
				const dependencyIndex = nameToIndex.get(dependency.trim().toLowerCase());
				if (dependencyIndex === undefined) {
					return `Task ${index + 1} depends on unknown task \`${dependency}\`; every prerequisite needs a task name.`;
				}
				if (dependencyIndex === index) return `Task ${index + 1} cannot depend on itself.`;
				dependencyCounts[index] += 1;
				const children = dependents.get(dependencyIndex);
				if (children) children.push(index);
				else dependents.set(dependencyIndex, [index]);
			}
		}
		let ready = dependencyCounts.flatMap((count, index) => (count === 0 ? [index] : []));
		let visited = 0;
		while (ready.length > 0) {
			const next: number[] = [];
			for (const index of ready) {
				visited++;
				for (const child of dependents.get(index) ?? []) {
					dependencyCounts[child] -= 1;
					if (dependencyCounts[child] === 0) next.push(child);
				}
			}
			ready = next;
		}
		if (visited !== tasks.length) return "Task dependencies contain a cycle.";
		if (typeof params.context !== "string" || params.context.trim() === "") {
			return "Missing `context`. Provide the shared background for this batch — goal, constraints, and any contract the tasks share.";
		}
		return undefined;
	}
	if (!hasTask) {
		return batchEnabled
			? "Missing `tasks`. Provide a `tasks` array (one subagent per item) with a shared `context`."
			: "Missing `task`. Provide complete, self-contained instructions for the agent.";
	}
	return validateEffort(params.effort, "The call");
}

/**
 * Normalize a validated call into its spawn list: the `tasks[]` batch when
 * provided, otherwise the single top-level spawn. The flat form's `isolated`
 * flag is only materialized when the caller sent one — `#runSpawn`
 * distinguishes an absent key from an explicit value.
 */
function resolveSpawnItems(params: TaskParams): TaskItem[] {
	if (Array.isArray(params.tasks) && params.tasks.length > 0) {
		return params.tasks;
	}
	const item: TaskItem = { name: params.name, agent: params.agent, task: params.task };
	if ("outputSchema" in params) item.outputSchema = params.outputSchema;
	if ("schemaMode" in params) item.schemaMode = params.schemaMode;
	if ("tools" in params) item.tools = params.tools;
	if ("effort" in params) item.effort = params.effort;
	if ("isolated" in params) item.isolated = params.isolated;
	return [item];
}

function taskDependencyIndices(items: TaskItem[]): number[][] {
	const nameToIndex = new Map(
		items.flatMap((item, index) => {
			const name = item.name?.trim();
			return name ? [[name.toLowerCase(), index] as const] : [];
		}),
	);
	return items.map(item => (item.dependsOn ?? []).map(name => nameToIndex.get(name.trim().toLowerCase())!));
}

function taskDependencyIds(items: TaskItem[]): string[] {
	return items.map((item, index) => item.name?.trim() || `task-${index + 1}`);
}

async function waitForTaskDependencies(
	dependencies: readonly Promise<boolean>[],
	signal?: AbortSignal,
	requireSuccess = true,
): Promise<void> {
	if (signal?.aborted) throw new Error("Aborted while waiting for prerequisite tasks");
	if (dependencies.length === 0) return;
	const allSettled = Promise.all(dependencies);
	if (!signal) {
		if (requireSuccess && (await allSettled).some(success => !success))
			throw new Error("A prerequisite task failed; dependent task was not started");
		if (!requireSuccess) await allSettled;
		return;
	}
	const aborted = Promise.withResolvers<never>();
	const onAbort = () => aborted.reject(new Error("Aborted while waiting for prerequisite tasks"));
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		const results = await Promise.race([allSettled, aborted.promise]);
		if (requireSuccess && results.some(success => !success))
			throw new Error("A prerequisite task failed; dependent task was not started");
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Per-spawn params handed to the executor path: top-level call fields with the
 * item's identity substituted in. Each spawn's `agent` resolves here —
 * the item's own value, else `defaultAgent` from the session spawn policy.
 * `tasks` never leaks into a spawn; the shared `context` rides along
 * unchanged. Keys are only materialized when present — `#runSpawn`
 * distinguishes an absent `isolated` from an explicit one. The item's
 * `isolated` (batch form) wins over the top-level flag (flat form).
 */
/** Internal routing metadata; it never appears in the public task tool schema. */
interface TaskExecutionParams extends TaskParams {
	governorModelRole?: string;
	integrationGate?: IntegrationGate;
	integrationGateTask?: boolean;
	integrationGateContext?: string;
	integrationGateAssignments?: string;
	integrationGateVerification?: GovernorVerificationPolicy;
	integrationGateRepairLimits?: RepairBudgetLimits;
}

interface IntegrationGateTaskMetadata {
	context: string;
	assignments: string;
	repairLimits: RepairBudgetLimits;
}

const integrationGateTaskMetadata = new WeakMap<TaskItem, IntegrationGateTaskMetadata>();

const integrationGateOutputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: { type: "string", enum: ["verified", "reconciled", "unresolved"] },
		summary: { type: "string" },
		verificationLevel: { type: "string", enum: ["V0", "V1", "V2", "V3", "V4"] },
		checks: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					command: { type: "string" },
					status: { type: "string", enum: ["passed", "failed", "skipped"] },
					result: { type: "string" },
				},
				required: ["command", "status", "result"],
			},
		},
		files: { type: "array", items: { type: "string" } },
		repairAttempts: { type: "integer", minimum: 0, maximum: 5 },
	},
	required: ["status", "summary", "verificationLevel", "checks", "files", "repairAttempts"],
} as const;

interface GovernorReviewTaskItem extends TaskItem {
	governorReview: true;
}

function isGovernorReviewTaskItem(item: TaskItem): item is GovernorReviewTaskItem {
	return (item as Partial<GovernorReviewTaskItem>).governorReview === true;
}

function isIntegrationGateTaskItem(item: TaskItem): boolean {
	return integrationGateTaskMetadata.has(item);
}

function canRunAfterFailedDependency(item: TaskItem): boolean {
	return isGovernorReviewTaskItem(item) || isIntegrationGateTaskItem(item);
}

function spawnParamsFor(
	params: TaskParams,
	item: TaskItem,
	defaultAgent: string,
	governorPlan?: GovernorTaskPlan,
	integrationGate?: IntegrationGate,
): TaskExecutionParams {
	const spawn: TaskExecutionParams = { agent: item.agent?.trim() || defaultAgent };
	if (integrationGate) spawn.integrationGate = integrationGate;
	const integrationMetadata = integrationGateTaskMetadata.get(item);
	if (integrationMetadata) {
		spawn.integrationGateTask = true;
		spawn.integrationGateContext = integrationMetadata.context;
		spawn.integrationGateAssignments = integrationMetadata.assignments;
		spawn.integrationGateRepairLimits = integrationMetadata.repairLimits;
		if (governorPlan?.verification) spawn.integrationGateVerification = governorPlan.verification;
	}
	if (!isGovernorReviewTaskItem(item) && governorPlan?.modelRole) {
		spawn.governorModelRole = governorPlan.modelRole;
	}
	if (item.name !== undefined) spawn.name = item.name;
	if (item.task !== undefined) spawn.task = item.task;
	const governorGuidance = governorPlan?.verification
		? prompt
				.render(taskGovernorVerificationTemplate, {
					strategy: governorPlan.verification.strategy,
					floor: governorPlan.verification.floor,
					ceiling: governorPlan.verification.ceiling,
				})
				.trim()
		: undefined;
	const contextParts = [params.context, governorGuidance].filter((part): part is string => !!part);
	if (contextParts.length > 0) spawn.context = contextParts.join("\n\n");
	if ("outputSchema" in item) spawn.outputSchema = item.outputSchema;
	if ("schemaMode" in item) spawn.schemaMode = item.schemaMode;
	if ("tools" in item) spawn.tools = item.tools;
	if ("effort" in item) spawn.effort = item.effort;
	else if (governorPlan?.effort !== undefined) spawn.effort = governorPlan.effort;
	if (item.isolated !== undefined) {
		spawn.isolated = item.isolated;
	} else if ("isolated" in params) {
		spawn.isolated = params.isolated;
	}
	return spawn;
}

/** One sync-executed spawn: its item, position in the original call, and (for mixed calls) a pre-claimed agent id. */
interface SyncSpawnRef {
	item: TaskItem;
	index: number;
	preAllocatedId?: string;
}

/** Merged view of a sync spawn set's payloads: joined text plus flattened results/usage/paths. */
interface MergedSyncPayloads {
	contentParts: string[];
	results: SingleResult[];
	usage?: Usage;
	outputPaths?: string[];
	projectAgentsDir: string | null;
}

/**
 * Merge per-spawn sync payloads into one result view. `index` is each spawn's
 * position in the original call so batch rows keep stable ordering; a missing
 * payload (cancelled before start) becomes an explanatory content line.
 */
function mergeSyncPayloads(
	spawns: SyncSpawnRef[],
	payloads: (AgentToolResult<TaskToolDetails> | undefined)[],
): MergedSyncPayloads {
	const results: SingleResult[] = [];
	const contentParts: string[] = [];
	const outputPaths: string[] = [];
	const usageTotals = createUsageTotals();
	let hasUsage = false;
	let projectAgentsDir: string | null = null;
	for (let position = 0; position < spawns.length; position++) {
		const payload = payloads[position];
		const { item, index } = spawns[position];
		if (!payload) {
			contentParts.push(`Task ${item.name?.trim() || `#${index + 1}`}: cancelled before start.`);
			continue;
		}
		projectAgentsDir ??= payload.details?.projectAgentsDir ?? null;
		const text = payload.content.find(part => part.type === "text")?.text;
		if (text) contentParts.push(text);
		for (const result of payload.details?.results ?? []) {
			results.push({ ...result, index });
			if (result.usage) {
				addUsageTotals(usageTotals, result.usage);
				hasUsage = true;
			}
			if (result.outputPath) outputPaths.push(result.outputPath);
		}
	}
	return {
		contentParts,
		results,
		usage: hasUsage ? usageTotals : undefined,
		outputPaths: outputPaths.length > 0 ? outputPaths : undefined,
		projectAgentsDir,
	};
}

/** Generic worker agent types; several in one call usually means a more specific type exists. */
const GENERIC_SPAWN_AGENTS: ReadonlySet<string> = new Set(["task", "sonic"]);

/**
 * Advisory — never a rejection — nudging the spawner toward tailored
 * specific agent types when one call resolves ≥2 items to a generic
 * `task`/`sonic` worker and the spawner still holds spawn capacity
 * (DepthCapacity: it currently has the `task` tool). `agentNames` are the
 * per-item resolved agent types. Returns undefined when no nudge applies.
 */
export function buildSpecializationAdvisory(
	agentNames: string[],
	depthCapacity: boolean,
	scoutAvailable = true,
): string | undefined {
	if (!depthCapacity) return undefined;
	const generics = agentNames.filter(name => GENERIC_SPAWN_AGENTS.has(name));
	if (generics.length < 2) return undefined;
	return prompt
		.render(taskSpecializationAdvisoryTemplate, {
			count: generics.length,
			agent: generics[0],
			scoutAvailable,
		})
		.trim();
}

/**
 * Suggestion — never a rejection — nudging the spawner to coordinate via the
 * peer messages when one call creates ≥2 live siblings and it still holds spawn
 * capacity. Returns undefined when there is nothing to coordinate or peer
 * messaging is unavailable.
 */
export function buildCoordinationAdvisory(
	items: TaskItem[],
	depthCapacity: boolean,
	ircEnabled: boolean,
): string | undefined {
	if (!depthCapacity || !ircEnabled || items.length < 2) return undefined;
	return prompt.render(taskCoordinationAdvisoryTemplate, { count: items.length }).trim();
}

/**
 * Compose the non-blocking advisory appended to a `task` result: the
 * specialization nudge (from the per-item resolved agent types), plus — only
 * when some spawns keep running after this call (`willRunAsync`) — the
 * coordination suggestion over those still-live spawns (`items`). Coordination
 * is gated on async because a sync spawn has already finished by the time the
 * call returns, so a "coordinate while they run" hint would misfire. Returns
 * undefined when neither applies.
 */
export function composeSpawnAdvisory(args: {
	agents: string[];
	items: TaskItem[];
	depthCapacity: boolean;
	ircEnabled: boolean;
	willRunAsync: boolean;
	scoutAvailable?: boolean;
	governorReviewer?: GovernorTaskPlan["reviewer"];
}): string | undefined {
	const reviewerAdvisory =
		args.depthCapacity && args.governorReviewer && args.governorReviewer !== "none"
			? prompt
					.render(taskGovernorReviewTemplate, {
						independent: args.governorReviewer === "independent",
						riskBased: args.governorReviewer === "risk_based",
					})
					.trim()
			: undefined;
	return (
		[
			buildSpecializationAdvisory(args.agents, args.depthCapacity, args.scoutAvailable),
			args.willRunAsync ? buildCoordinationAdvisory(args.items, args.depthCapacity, args.ircEnabled) : undefined,
			reviewerAdvisory,
		]
			.filter(Boolean)
			.join("\n\n") || undefined
	);
}

function appendTaskText(result: AgentToolResult<TaskToolDetails>, text: string): AgentToolResult<TaskToolDetails> {
	let appended = false;
	const content = result.content.map(part => {
		if (!appended && part.type === "text" && typeof part.text === "string") {
			appended = true;
			return { ...part, text: `${part.text}\n\n${text}` };
		}
		return part;
	});
	if (!appended) content.push({ type: "text", text });
	return { ...result, content };
}

/** Sentinel for async jobs whose subagent finished with a failing result; progress is already updated. */
class TaskJobError extends AsyncJobError {}

/**
 * Process-level create-time discovery memo and published reload snapshots,
 * keyed by resolved cwd plus the exact effective `extensions` array.
 *
 * `TaskTool.create` runs for every (sub)agent session in this process. Sessions
 * may share a cwd while carrying different overlay/runtime extension settings,
 * so cwd alone is not an isolation boundary. Explicit plugin reloads replace
 * only the matching cwd+extensions snapshot. Execution-time discovery
 * (`#runSpawn`) intentionally stays fresh. The memo also tracks the live
 * `discoverAgents` binding: test spies swap that binding, which invalidates
 * both caches automatically.
 */
const discoveryMemo = new Map<string, Promise<DiscoveryResult>>();
const discoverySnapshots = new Map<string, AgentDefinition[]>();
let discoveryMemoFn: typeof discoverAgents | undefined;

/** Stable cache identity for the filesystem root and the full effective extension-root struct. */
function discoveryCacheKey(cwd: string, extensionRoots?: EffectiveExtensionRoots): string {
	return `${path.resolve(cwd)}\0${JSON.stringify(extensionRoots ?? null)}`;
}

function discoverAgentsForCreate(cwd: string, extensionRoots?: EffectiveExtensionRoots): Promise<DiscoveryResult> {
	const fn = discoverAgents;
	if (discoveryMemoFn !== fn) {
		discoveryMemoFn = fn;
		discoveryMemo.clear();
		discoverySnapshots.clear();
	}
	const key = discoveryCacheKey(cwd, extensionRoots);
	let pending = discoveryMemo.get(key);
	if (!pending) {
		pending = fn(cwd, undefined, extensionRoots);
		discoveryMemo.set(key, pending);
		pending.catch(() => {
			if (discoveryMemo.get(key) === pending) discoveryMemo.delete(key);
		});
	}
	return pending;
}

/** Rescan one cwd and publish its definitions to existing and future task tools. */
export async function refreshAgentDiscovery(cwd: string, extensionRoots?: EffectiveExtensionRoots): Promise<void> {
	const key = discoveryCacheKey(cwd, extensionRoots);
	discoveryMemo.delete(key);
	const pending = discoverAgentsForCreate(cwd, extensionRoots);
	const { agents } = await pending;
	if (discoveryMemo.get(key) === pending) {
		discoverySnapshots.set(key, agents);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Each call spawns one subagent — or, with `task.batch`, one per `tasks[]`
 * item. When `async.enabled` is on, spawns run as AsyncJobManager jobs; when
 * disabled, the tool blocks until every spawn finishes.
 */
export class TaskTool implements AgentTool<TaskToolSchemaInstance, TaskToolDetails, Theme> {
	readonly name = "task";
	readonly approval = "exec" as const;
	readonly formatApprovalDetails = (args: unknown): string[] => {
		const params = args as Partial<TaskParams>;
		const lines: string[] = [];
		if (typeof params.agent === "string") {
			lines.push(`Agent: ${truncateForPrompt(params.agent)}`);
		}
		if (typeof params.name === "string" && params.name.trim()) {
			lines.push(`Name: ${truncateForPrompt(params.name)}`);
		}
		if (typeof params.task === "string") {
			lines.push(`Task:\n${truncateForPrompt(params.task)}`);
		}
		if (typeof params.context === "string" && params.context.trim()) {
			lines.push(`Context:\n${truncateForPrompt(params.context)}`);
		}
		const tasks: unknown[] = Array.isArray(params.tasks) ? params.tasks : [];
		if (tasks.length > 0) {
			const defaultAgent = resolveSpawnPolicy(this.session.getSessionSpawns()).defaultAgent;
			const effectiveAgent = (item: unknown): string => {
				if (item && typeof item === "object" && "agent" in item) {
					const agent = item.agent;
					if (typeof agent === "string" && agent.trim()) return agent.trim();
				}
				return defaultAgent;
			};
			const agentCounts = new Map<string, number>();
			for (const item of tasks) {
				const agent = effectiveAgent(item);
				agentCounts.set(agent, (agentCounts.get(agent) ?? 0) + 1);
			}
			const agentSummary = [...agentCounts].map(([agent, count]) => `${agent} ×${count}`).join(", ");
			lines.push(`Batch agents: ${truncateForPrompt(agentSummary)}`);

			const firstTask = tasks[0];
			if (firstTask && typeof firstTask === "object") {
				if ("name" in firstTask && typeof firstTask.name === "string" && firstTask.name.trim()) {
					lines.push(`Name: ${truncateForPrompt(firstTask.name)}`);
				}
				lines.push(`Agent: ${truncateForPrompt(effectiveAgent(firstTask))}`);
				if ("task" in firstTask && typeof firstTask.task === "string") {
					lines.push(`Task:\n${truncateForPrompt(firstTask.task)}`);
				}
			}
			if (tasks.length > 1) {
				lines.push(`+${tasks.length - 1} more task${tasks.length === 2 ? "" : "s"}`);
			}
		}
		return lines;
	};
	readonly label = "Task";
	readonly summary = "Spawn subagents to complete delegated tasks";
	readonly strict = false;
	get loadMode(): "essential" | "discoverable" {
		// Prefix-bound thinking providers keep a stable prompt after the first assistant
		// turn, so they need delegation guidance before the first possible task call.
		if (this.session.getActiveModel?.()?.thinking?.prefixBinding === true) return "essential";
		const profile = cfgPromptProfile.get(this.session.settings);
		const delegation = resolvePromptPolicies(profile, cfgPromptModules.get(this.session.settings)).delegation;
		const subagents = resolveCapabilityPolicies(profile, cfgPromptCapabilities.get(this.session.settings)).subagents;
		return delegation === "automatic" || subagents === "automatic" ? "discoverable" : "essential";
	}
	// Arktype validates model calls against the active wire schema, but the flat
	// single-spawn schema carries `"+": "delete"`: a batch `{ context, tasks[] }`
	// payload has those keys stripped, then fails on the now-missing `task` with
	// the misleading `task must be a string (was missing)`. That preempts the
	// tool's own actionable shape checks (`validateShapeParams` /
	// `validateSpawnParams`), which never run. Lenient validation forwards the
	// raw args to `execute()` on any arktype failure so those checks surface the
	// real reason ("enable task.batch, or use the flat `task` shape"). Valid
	// calls still normalize through arktype; `execute()` resolves `agent`
	// defaults independently, so the success path is unchanged.
	readonly lenientArgValidation = true;
	readonly renderResult = renderResult;
	// Suppress the streaming call preview once a (partial or final) result exists
	// so the task renders as ONE block that transitions in place — not a pending
	// call frame stacked above the result frame. Mirrors `taskToolRenderer`.
	readonly mergeCallAndResult = true;
	readonly #discoveredAgents: AgentDefinition[];
	readonly #blockedAgent: string | undefined;

	get parameters(): TaskToolSchemaInstance {
		const planMode = this.session.getPlanModeState?.()?.enabled === true;
		const isolationEnabled = !planMode && cfgTaskIsolationEnabled.get(this.session.settings);
		const defaultAgent = resolveSpawnPolicy(this.session.getSessionSpawns()).defaultAgent;
		return getTaskSchema({
			isolationEnabled,
			batchEnabled: this.#isBatchEnabled(),
			effortEnabled: cfgTaskEnableEffort.get(this.session.settings),
			evalToolsEnabled: evalToolsEnabled(this.session),
			capabilityRoutingEnabled: cfgAdaptiveMode.get(this.session.settings) === "auto",
			governorEnabled: cfgAdaptiveMode.get(this.session.settings) !== "off",
			defaultAgent,
		});
	}

	renderCall(args: unknown, options: Parameters<typeof renderTaskCall>[1], theme: Theme) {
		return renderTaskCall(repairTaskParams(args as TaskParams), options, theme);
	}

	/** Dynamic description that reflects current task settings. */
	get description(): string {
		const disabledAgents = cfgTaskDisabledAgents.get(this.session.settings);
		const planMode = this.session.getPlanModeState?.()?.enabled === true;
		const isolationEnabled = cfgTaskIsolationEnabled.get(this.session.settings);
		return renderDescription({
			agents:
				discoverySnapshots.get(discoveryCacheKey(this.session.cwd, this.session.effectiveExtensionRoots?.())) ??
				this.#discoveredAgents,
			sessionAgents: this.session.getSessionAgents?.() ?? [],
			isolationEnabled: !planMode && isolationEnabled,
			applyIsolatedChanges: cfgTaskIsolationApply.get(this.session.settings),
			disabledAgents,
			batchEnabled: this.#isBatchEnabled(),
			effortEnabled: cfgTaskEnableEffort.get(this.session.settings),
			evalToolsEnabled: evalToolsEnabled(this.session),
			capabilityRoutingEnabled: cfgAdaptiveMode.get(this.session.settings) === "auto",
			governorEnabled: cfgAdaptiveMode.get(this.session.settings) !== "off",
			asyncEnabled: cfgAsyncEnabled.get(this.session.settings),
			ircEnabled: isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0),
			parentSpawns: this.session.getSessionSpawns() ?? "*",
		});
	}
	private constructor(
		private readonly session: ToolSession,
		discoveredAgents: AgentDefinition[],
	) {
		this.#blockedAgent = $env.PI_BLOCKED_AGENT;
		this.#discoveredAgents = discoveredAgents;
	}

	#isBatchEnabled(): boolean {
		return cfgTaskBatch.get(this.session.settings);
	}

	#getSpawnSemaphore(): Semaphore {
		return sessionTaskSemaphore(this.session, cfgTaskMaxConcurrency.get(this.session.settings));
	}

	#releaseSpawnSemaphore(): void {
		this.#getSpawnSemaphore().release();
	}

	/**
	 * Resolve the shared policy before detached work exists. The resulting
	 * policy intentionally stays local: executor dispatch resolves again from
	 * normalized task params rather than smuggling internal policy over the
	 * task wire contract.
	 */
	#resolveSpawnPreflight(params: TaskExecutionParams) {
		return resolveEffectiveSubagentPolicy({
			session: this.session,
			invocationKind: "task",
			assignment: (params.task ?? "").trim(),
			context: this.#isBatchEnabled() ? params.context?.trim() || undefined : undefined,
			agent: params.agent,
			...(params.governorModelRole ? { model: formatModelRoleAlias(params.governorModelRole) } : {}),
			...(Object.hasOwn(params, "outputSchema") ? { outputSchema: params.outputSchema } : {}),
			...(Object.hasOwn(params, "schemaMode") ? { schemaMode: params.schemaMode } : {}),
			...(params.effort !== undefined ? { effort: params.effort } : {}),
			...("isolated" in params ? { isolation: { requested: params.isolated } } : {}),
			blockedAgent: this.#blockedAgent,
			enableLsp: (this.session.enableLsp ?? true) && cfgTaskEnableLsp.get(this.session.settings),
			enableIrc: isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0),
			maxRuntimeMs: cfgTaskMaxRuntimeMs.get(this.session.settings),
		});
	}

	/**
	 * Create a TaskTool instance with async agent discovery.
	 */
	static async create(session: ToolSession): Promise<TaskTool> {
		const { agents } = await discoverAgentsForCreate(session.cwd, session.effectiveExtensionRoots?.());
		return new TaskTool(session, agents);
	}

	async execute(
		toolCallId: string,
		rawParams: unknown,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
	): Promise<AgentToolResult<TaskToolDetails>> {
		const params = repairTaskParams(rawParams as TaskParams);
		// Schema defaults fill `agent` for model calls, but internal callers
		// and stale transcripts can bypass arktype. `spawnParamsFor` resolves each
		// item's agent type against the session's actual default agent.
		const defaultAgent = resolveSpawnPolicy(this.session.getSessionSpawns()).defaultAgent;
		const batchEnabled = this.#isBatchEnabled();
		const validationError = validateShapeParams(batchEnabled, params) ?? validateSpawnParams(params, batchEnabled);
		if (validationError) {
			return createTaskModeError(validationError);
		}

		const spawnItems = resolveSpawnItems(params);
		const implementationCount = spawnItems.length;
		const requestedIsolatedWorkers = spawnItems.filter(
			item => item.isolated === true || (params.isolated === true && item.isolated === undefined),
		).length;
		const repairBudgetSettings = cfgTaskRepairBudget.get(this.session.settings);
		const repairLimits = { ...DEFAULT_REPAIR_BUDGET, ...repairBudgetSettings };
		const integrationGateRequired =
			implementationCount > 1 &&
			requestedIsolatedWorkers > 1 &&
			cfgTaskIsolationEnabled.get(this.session.settings) &&
			cfgTaskIsolationApply.get(this.session.settings);
		if (integrationGateRequired) {
			const assignments = truncateForPrompt(
				spawnItems
					.map((item, index) => `${item.name?.trim() || `Task ${index + 1}`}: ${item.task?.trim() ?? ""}`)
					.join("\n"),
				8_000,
			);
			const taskNames = new Set(spawnItems.map(item => item.name?.trim().toLowerCase()).filter(Boolean));
			let integrationGateName = "Integration gate";
			for (let suffix = 2; taskNames.has(integrationGateName.toLowerCase()); suffix++) {
				integrationGateName = `Integration gate ${suffix}`;
			}
			const gateTask: TaskItem = {
				name: integrationGateName,
				agent: defaultAgent,
				isolated: false,
				outputSchema: integrationGateOutputSchema,
				schemaMode: "strict",
				task: prompt.render(taskIntegrationGateTemplate, {
					context: truncateForPrompt(params.context?.trim() ?? "", 8_000),
					assignments,
					results: "Implementation worker results are added after the workers settle.",
					strategy: "targeted_checks",
					floor: "V1",
					ceiling: "V2",
					maxAttempts: repairLimits.maxAttempts,
					maxTokens: repairLimits.maxTokens,
					maxCostUsd: repairLimits.maxCostUsd,
					maxWallTimeMs: repairLimits.maxWallTimeMs,
					stagnationLimit: repairLimits.stagnationLimit,
					repairHistory: "No previous attempts.",
				}),
			};
			integrationGateTaskMetadata.set(gateTask, {
				context: truncateForPrompt(params.context?.trim() ?? "", 8_000),
				assignments,
				repairLimits,
			});
			spawnItems.push(gateTask);
		}
		const dependencies = taskDependencyIndices(spawnItems);
		if (integrationGateRequired) {
			dependencies[implementationCount] = Array.from({ length: implementationCount }, (_, index) => index);
		}
		const integrationGate =
			spawnItems.length > 1
				? new IntegrationGate(integrationOrder(dependencies), repairLimits.maxAttempts)
				: undefined;
		const requestedTaskItems = spawnItems.slice(0, implementationCount);
		const dependencyIds = taskDependencyIds(spawnItems);
		const dependencyGates = spawnItems.map(() => Promise.withResolvers<boolean>());
		const settleDependency = (index: number, success: boolean): void => {
			dependencyGates[index]!.resolve(success);
		};
		const evalToolNames = spawnItems.flatMap(item => item.tools ?? []);
		if (evalToolNames.length > 0) {
			if (this.session.getPlanModeState?.()?.enabled === true) {
				return createTaskModeError("Task execution failed: Eval-defined tools are unavailable in plan mode.");
			}
			try {
				await describeEvalTools(this.session, evalToolNames, signal);
			} catch (error) {
				return createTaskModeError(
					`Task execution failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		const declaredCapabilities = [
			...new Set([...(params.capabilities ?? []), ...spawnItems.flatMap(item => item.capabilities ?? [])]),
		].filter(isTaskToolCapabilityId);
		const classification = classifyTaskCapabilities([
			params.task ?? "",
			...requestedTaskItems.map(item => item.task ?? ""),
		]);
		const highRisk = params.highRisk === true || requestedTaskItems.some(item => item.highRisk === true);
		const governorFactsDeclared =
			declaredCapabilities.length > 0 || classification.capabilities.length > 0 || highRisk;
		const batchTaskPlan = params.tasks !== undefined && implementationCount > 1;
		const adaptiveAuto = cfgAdaptiveMode.get(this.session.settings) === "auto";
		const governorPlanRequired = (batchTaskPlan && governorFactsDeclared) || (adaptiveAuto && governorFactsDeclared);
		const governorOwnerId = `task:${toolCallId}`;
		const releaseGovernorOwner = async (): Promise<void> => {
			if (!governorFactsDeclared) return;
			try {
				await this.session.releaseGovernorTaskCapabilityRoutes?.(governorOwnerId);
			} catch (error) {
				logger.warn("Task capability lease release failed", { owner: governorOwnerId, error: String(error) });
			}
		};
		if (governorFactsDeclared) {
			const facts: GovernorTaskFacts = {
				files: [],
				tasks: requestedTaskItems.map((item, index) => ({
					id: dependencyIds[index]!,
					dependsOn: dependencies[index]!.map(dependency => dependencyIds[dependency]!),
					requiredCapabilities: item.capabilities?.filter(isTaskToolCapabilityId),
				})),
				highRisk,
				confidence: 0.9,
				requiredCapabilities: declaredCapabilities,
				inferredCapabilities: classification.capabilities,
				capabilityConfidence: classification.confidence,
			};
			const routeTransition = this.session.routeGovernorTaskTransition;
			if (!routeTransition) {
				return createTaskModeError("Task Governor preflight is unavailable for this session.");
			}
			try {
				const routing = await routeTransition.call(this.session, { facts, ownerId: governorOwnerId }, "initial");
				if (routing?.deferred) {
					await releaseGovernorOwner();
					return createTaskModeError(
						"Task routing is waiting for the current provider turn to finish. Retry this task call after the turn settles.",
					);
				}
				if (declaredCapabilities.length > 0) {
					const routes = routing?.capabilityRoutes ?? [];
					const failedRoutes = routes.filter(route => route.state !== "active");
					if (failedRoutes.length > 0) {
						await releaseGovernorOwner();
						return createTaskModeError(
							`Task capability routing failed: ${failedRoutes.map(route => `${route.toolName}: ${route.reason}`).join("; ")}`,
						);
					}
					if (routes.length !== declaredCapabilities.length) {
						await releaseGovernorOwner();
						return createTaskModeError(
							"Task capability requirements need adaptive.mode=auto and an available direct-tool route.",
						);
					}
				}
			} catch (error) {
				logger.warn("Task capability routing failed", { error: String(error) });
				if (governorFactsDeclared) {
					await releaseGovernorOwner();
					return createTaskModeError(
						`Task Governor preflight failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		} else {
			try {
				await this.session.releaseGovernorTaskCapabilityRoutes?.();
			} catch (error) {
				logger.warn("Task capability release failed", { error: String(error) });
			}
		}
		let governorPlan: GovernorTaskPlan | undefined;
		let governorPlanAvailable = false;
		if (batchTaskPlan || (adaptiveAuto && governorFactsDeclared)) {
			try {
				if (this.session.routeGovernorTaskPlan) {
					governorPlan = this.session.routeGovernorTaskPlan(implementationCount, highRisk);
					governorPlanAvailable = governorPlan !== undefined;
				} else {
					const workerCount = this.session.routeGovernorTaskBatch?.(implementationCount, highRisk);
					if (workerCount !== undefined) {
						governorPlan = { workerCount };
						governorPlanAvailable = true;
					}
				}
			} catch (error) {
				logger.warn("Adaptive task batch routing failed", { error: String(error) });
				if (governorFactsDeclared) {
					await releaseGovernorOwner();
					return createTaskModeError(
						`Task Governor batch planning failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			if (governorPlanRequired && !governorPlanAvailable) {
				await releaseGovernorOwner();
				return createTaskModeError("Task Governor batch planning is unavailable for this session.");
			}
		}
		const asyncEnabled = cfgAsyncEnabled.get(this.session.settings);
		const manager = asyncEnabled ? this.session.asyncJobManager : undefined;
		const depthCapacity = canSpawnAtDepth(
			cfgTaskMaxRecursionDepth.get(this.session.settings),
			this.session.taskDepth ?? 0,
		);
		let governorReviewIndex: number | undefined;
		let governorReviewPolicy: EffectiveSubagentPolicy | undefined;
		if (manager && governorPlan?.reviewer === "independent" && depthCapacity) {
			const reviewAssignment = prompt.render(taskGovernorReviewAssignmentTemplate, {
				request: truncateForPrompt(
					[params.context, params.task, ...requestedTaskItems.map(item => item.task)].filter(Boolean).join("\n\n"),
					8_000,
				),
				results:
					"This review starts after every implementation worker settles. Inspect the integrated workspace change set before reporting findings.",
			});
			const reviewItem: GovernorReviewTaskItem = {
				name: "Governor review",
				agent: "reviewer",
				governorReview: true,
				task: reviewAssignment,
			};
			try {
				governorReviewPolicy = await this.#resolveSpawnPreflight({ agent: "reviewer", task: reviewAssignment });
				governorReviewIndex = spawnItems.length;
				spawnItems.push(reviewItem);
				dependencies.push(Array.from({ length: governorReviewIndex }, (_, index) => index));
				dependencyIds.push("governor-review");
				dependencyGates.push(Promise.withResolvers<boolean>());
			} catch (error) {
				logger.warn("Governor independent reviewer is unavailable", { error: String(error) });
			}
		}
		const normalizedSpawnParams = spawnItems.map((item, index) =>
			spawnParamsFor(
				params,
				item,
				defaultAgent,
				index === governorReviewIndex ? undefined : governorPlan,
				integrationGate,
			),
		);
		const resolvedAgents = normalizedSpawnParams.map(spawn => spawn.agent ?? defaultAgent);
		// Resolve every item before choosing an execution path. No executor or
		// job manager may observe a batch unless every effective policy is valid.
		const preflights = await Promise.all(
			normalizedSpawnParams.map(async (spawn, index) => {
				if (index === governorReviewIndex && governorReviewPolicy) return { policy: governorReviewPolicy };
				try {
					return { policy: await this.#resolveSpawnPreflight(spawn) };
				} catch (error) {
					return { error: error instanceof StructuredSubagentError ? error.message : String(error) };
				}
			}),
		);
		const preflightFailures = preflights
			.map((preflight, index) => ("error" in preflight ? { index, error: preflight.error } : undefined))
			.filter((failure): failure is { index: number; error: string } => failure !== undefined);
		if (preflightFailures.length > 0) {
			await releaseGovernorOwner();
			if (!batchEnabled) {
				return createTaskModeError(`Task execution failed: ${preflightFailures[0]!.error}`);
			}
			return createTaskModeError(
				preflightFailures
					.map(({ index, error }) => {
						const item = spawnItems[index]!;
						return `Task ${item.name?.trim() || `#${index + 1}`} failed preflight: ${error}`;
					})
					.join("\n"),
			);
		}
		const policies = preflights.map(preflight => preflight.policy!);
		const itemBlocking = policies.map(policy => policy.effectiveAgent.blocking === true);
		const batchConcurrency = governorPlan?.workerCount;
		const batchSemaphore = batchConcurrency && batchConcurrency > 0 ? new Semaphore(batchConcurrency) : undefined;

		// Execution mode is per item: an item whose agent type declares
		// `blocking: true` runs inline on this turn (the parent waits on its
		// result); every other item becomes a background job when async
		// execution is available.
		const asyncItems = manager ? spawnItems.filter((_, index) => !itemBlocking[index]) : [];
		const ircEnabled = isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0);

		if (!manager || asyncItems.length === 0) {
			// Sync fallback: async execution disabled, orphaned host that never
			// wired a job manager, or every item's agent type declares
			// `blocking: true`.
			if (asyncEnabled && !this.session.asyncJobManager) {
				logger.warn("task: no AsyncJobManager registered; falling back to sync execution");
			}
			let result: AgentToolResult<TaskToolDetails>;
			let governorReviewAttempted = governorReviewIndex !== undefined;
			try {
				result = await this.#executeSyncFanout(
					toolCallId,
					params,
					spawnItems.map((item, index) => ({ item, index })),
					defaultAgent,
					signal,
					onUpdate,
					batchSemaphore,
					dependencies,
					dependencyGates.map(gate => gate.promise),
					settleDependency,
					governorPlan,
					integrationGate,
				);
				if (!governorReviewAttempted && governorPlan?.reviewer && governorPlan.reviewer !== "none") {
					const review = await this.#runGovernorReview(result, params, governorPlan.reviewer, highRisk, signal);
					result = review.result;
					governorReviewAttempted = review.attempted;
				}
			} finally {
				await releaseGovernorOwner();
			}
			const advisory = this.session.suppressSpawnAdvisory
				? undefined
				: composeSpawnAdvisory({
						agents: resolvedAgents,
						items: asyncItems,
						depthCapacity,
						ircEnabled,
						willRunAsync: false,
						governorReviewer: governorReviewAttempted ? undefined : governorPlan?.reviewer,
						scoutAvailable: isScoutSpawnable(
							cfgTaskDisabledAgents.get(this.session.settings),
							this.session.getSessionSpawns?.() ?? "*",
						),
					});
			if (!advisory) return result;
			let appended = false;
			const content = result.content.map(part => {
				if (!appended && part.type === "text" && typeof part.text === "string") {
					appended = true;
					return { ...part, text: `${part.text}\n\n${advisory}` };
				}
				return part;
			});
			if (!appended) content.push({ type: "text", text: advisory });
			return { ...result, content };
		}

		// Coordination only makes sense for spawns that keep running after this
		// call returns (the async subset). Blocking items have already completed
		// by then, so a "coordinate while they run" hint would misfire.
		const advisory = this.session.suppressSpawnAdvisory
			? undefined
			: composeSpawnAdvisory({
					agents: resolvedAgents,
					items: asyncItems,
					depthCapacity,
					ircEnabled,
					willRunAsync: asyncItems.length > 0,
					governorReviewer: governorReviewIndex !== undefined ? undefined : governorPlan?.reviewer,
					scoutAvailable: isScoutSpawnable(
						cfgTaskDisabledAgents.get(this.session.settings),
						this.session.getSessionSpawns?.() ?? "*",
					),
				});
		// Returns a fresh result (copied content array, copied text part) rather
		// than mutating the caller's — task results are short-lived here, but an
		// in-place edit on a shared/cached AgentToolResult would be a hidden trap.
		const withAdvisory = (result: AgentToolResult<TaskToolDetails>): AgentToolResult<TaskToolDetails> => {
			if (!advisory) return result;
			let appended = false;
			const content = result.content.map(part => {
				if (!appended && part.type === "text" && typeof part.text === "string") {
					appended = true;
					return { ...part, text: `${part.text}\n\n${advisory}` };
				}
				return part;
			});
			if (!appended) content.push({ type: "text", text: advisory });
			return { ...result, content };
		};
		if (asyncItems.length === 0) {
			return withAdvisory(
				await this.#executeSyncFanout(
					toolCallId,
					params,
					spawnItems.map((item, index) => ({ item, index })),
					defaultAgent,
					signal,
					onUpdate,
					batchSemaphore,
					dependencies,
					dependencyGates.map(gate => gate.promise),
					settleDependency,
					governorPlan,
					integrationGate,
				),
			);
		}

		// Async IDs are claimed before job registration, so retain the fallback
		// manager on the session rather than recreating it for every call.
		let outputManager = this.session.agentOutputManager;
		if (!outputManager) {
			outputManager = new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
			this.session.agentOutputManager = outputManager;
		}
		const callStartedAt = Date.now();
		const spawns: Array<{
			agentId: string;
			item: TaskItem;
			index: number;
			blocking: boolean;
			progress: AgentProgress;
		}> = [];
		for (const [index, item] of spawnItems.entries()) {
			const agentType = resolvedAgents[index]!;
			const policy = policies[index]!;
			const agentSource = policy.agent.source;
			const agentId = await outputManager.allocate(item.name?.trim() || generateTaskName());
			const assignment = (item.task ?? "").trim();
			spawns.push({
				agentId,
				item,
				index,
				blocking: itemBlocking[index],
				progress: {
					index,
					id: agentId,
					agent: agentType,
					agentSource,
					modelRole: policy.modelRole,
					status: "pending",
					task: renderSubagentUserPrompt(assignment),
					assignment,
					recentTools: [],
					recentOutput: [],
					toolCount: 0,
					requests: 0,
					tokens: 0,
					cost: 0,
					durationMs: 0,
				},
			});
		}
		const asyncSpawns = spawns.filter(spawn => !spawn.blocking);
		const syncSpawns = spawns.filter(spawn => spawn.blocking);
		const agentLabel = [...new Set(asyncSpawns.map(spawn => spawn.progress.agent))].join(", ");

		// Aggregate state for the one tool call. Async spawns report into the
		// shared progress snapshot through their jobs: the async half stays
		// "running" until every job settles, then turns "failed" if any spawn
		// failed. Blocking spawns run inline below and land in `results` before
		// the call returns, so post-return job updates never drop them.
		let settledCount = 0;
		let failedCount = 0;
		let syncSettled = syncSpawns.length === 0;
		let governorOwnerReleased = false;
		const releaseSettledGovernorOwner = (): void => {
			if (!syncSettled || settledCount < asyncSpawns.length || governorOwnerReleased) return;
			governorOwnerReleased = true;
			void releaseGovernorOwner().catch(error => {
				logger.warn("Task capability lease release failed", { error: String(error) });
			});
		};
		let primaryJobId = asyncSpawns[0].agentId;
		const syncResults: SingleResult[] = [];
		// oxlint-disable-next-line prefer-const -- read by buildAsyncDetails before assignment
		let syncUsage: Usage | undefined;
		// oxlint-disable-next-line prefer-const -- read by buildAsyncDetails before assignment
		let syncOutputPaths: string[] | undefined;
		let syncProjectAgentsDir: string | null = null;
		const buildAsyncDetails = (): TaskToolDetails => ({
			projectAgentsDir: syncProjectAgentsDir,
			results: [...syncResults],
			totalDurationMs: Date.now() - callStartedAt,
			usage: syncUsage,
			outputPaths: syncOutputPaths,
			progress: spawns.map(spawn => ({ ...spawn.progress })),
			async: {
				state: settledCount < asyncSpawns.length ? "running" : failedCount > 0 ? "failed" : "completed",
				jobId: primaryJobId,
				type: "task",
			},
		});

		const started: Array<{ agentId: string; jobId: string }> = [];
		const failedSchedules: string[] = [];
		for (const spawn of asyncSpawns) {
			try {
				const jobId = this.#registerSpawnJob({
					manager,
					toolCallId,
					spawnParams: spawnParamsFor(params, spawn.item, defaultAgent, governorPlan, integrationGate),
					agentId: spawn.agentId,
					progress: spawn.progress,
					ircEnabled,
					buildDetails: buildAsyncDetails,
					onUpdate,
					batchSemaphore,
					dependencyPromises: dependencies[spawn.index]!.map(index => dependencyGates[index]!.promise),
					allowFailedDependencies: canRunAfterFailedDependency(spawn.item),
					onSettled: failed => {
						integrationGate?.settle(spawn.index);
						settleDependency(spawn.index, !failed);
						settledCount += 1;
						if (failed) failedCount += 1;
						releaseSettledGovernorOwner();
					},
				});
				if (started.length === 0) primaryJobId = jobId;
				started.push({ agentId: spawn.agentId, jobId });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failedSchedules.push(`${spawn.agentId}: ${message}`);
				spawn.progress.status = "failed";
				integrationGate?.settle(spawn.index);
				settleDependency(spawn.index, false);
				settledCount += 1;
				failedCount += 1;
				releaseSettledGovernorOwner();
			}
		}

		if (started.length === 0 && syncSpawns.length === 0) {
			releaseSettledGovernorOwner();
			return {
				content: [
					{
						type: "text",
						text: `Failed to start background task job${failedSchedules.length === 1 ? "" : "s"}: ${failedSchedules.join("; ")}`,
					},
				],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		}

		const scheduleFailureSummary =
			failedSchedules.length > 0
				? ` Failed to schedule ${failedSchedules.length} spawn${failedSchedules.length === 1 ? "" : "s"}: ${failedSchedules.join("; ")}.`
				: "";
		const guidance = prompt
			.render(taskAsyncContractTemplate, { ircEnabled, waitTool: hasWaitTool(this.session) })
			.trim();
		const renderSpawnFeedback = (mixed: boolean): string =>
			prompt
				.render(taskSpawnFeedbackTemplate, {
					mixed,
					singular: started.length === 1,
					singleCall: spawns.length === 1,
					showListing: mixed || spawns.length > 1,
					count: started.length,
					agentId: started[0]?.agentId,
					jobId: started[0]?.jobId,
					agentLabel,
					started,
					scheduleFailureSummary,
					guidance,
				})
				.trim();

		if (syncSpawns.length === 0) {
			if (spawns.length === 1) {
				const { agentId } = started[0];
				onUpdate?.({
					content: [{ type: "text", text: `Spawned agent \`${agentId}\`...` }],
					details: buildAsyncDetails(),
				});
				return withAdvisory({
					content: [
						{
							type: "text",
							text: renderSpawnFeedback(false),
						},
					],
					details: buildAsyncDetails(),
				});
			}
			onUpdate?.({
				content: [{ type: "text", text: `Spawned ${started.length} agents...` }],
				details: buildAsyncDetails(),
			});
			return withAdvisory({
				content: [
					{
						type: "text",
						text: renderSpawnFeedback(false),
					},
				],
				details: buildAsyncDetails(),
			});
		}

		// Mixed call: the async jobs above already run detached; the blocking
		// subset runs inline and gates the call's return — exactly what each
		// agent type declares (`blocking: true` = the parent waits on it).
		const syncLabel = syncSpawns.map(spawn => `\`${spawn.agentId}\``).join(", ");
		onUpdate?.({
			content: [
				{
					type: "text",
					text: `Running ${syncLabel} inline; ${started.length} background agent${started.length === 1 ? "" : "s"} spawned...`,
				},
			],
			details: buildAsyncDetails(),
		});
		let payloads: (AgentToolResult<TaskToolDetails> | undefined)[];
		try {
			payloads = await this.#runSyncSpawns({
				toolCallId,
				params,
				defaultAgent,
				signal,
				spawns: syncSpawns.map(spawn => ({ item: spawn.item, index: spawn.index, preAllocatedId: spawn.agentId })),
				batchSemaphore,
				dependencyPromises: dependencyGates.map(gate => gate.promise),
				dependencies,
				settleDependency,
				governorPlan,
				onItemProgress: onUpdate
					? (index, progress) => {
							const spawn = spawns.find(candidate => candidate.index === index);
							if (spawn) spawn.progress = { ...progress, index };
							onUpdate({
								content: [{ type: "text", text: `Running ${syncLabel} inline...` }],
								details: buildAsyncDetails(),
							});
						}
					: undefined,
			});
		} finally {
			syncSettled = true;
			releaseSettledGovernorOwner();
		}
		const merged = mergeSyncPayloads(
			syncSpawns.map(spawn => ({ item: spawn.item, index: spawn.index })),
			payloads,
		);
		syncResults.push(...merged.results);
		syncUsage = merged.usage;
		syncOutputPaths = merged.outputPaths;
		syncProjectAgentsDir = merged.projectAgentsDir;
		// Settle the inline spawns' progress rows from their merged results so
		// post-return job updates carry final statuses, not the last snapshot.
		for (let position = 0; position < syncSpawns.length; position++) {
			const spawn = syncSpawns[position];
			const result = merged.results.find(r => r.id === spawn.agentId);
			if (result) {
				spawn.progress.status = result.aborted
					? "aborted"
					: result.exitCode === 0 && !result.error
						? "completed"
						: "failed";
				spawn.progress.durationMs = result.durationMs;
			} else {
				spawn.progress.status = payloads[position] ? "failed" : "aborted";
			}
		}

		const spawnedSummary = started.length > 0 ? renderSpawnFeedback(true) : scheduleFailureSummary.trim();
		const text = [merged.contentParts.join("\n\n"), spawnedSummary]
			.filter(section => section.trim().length > 0)
			.join("\n\n");
		return withAdvisory({
			content: [{ type: "text", text: text.length > 0 ? text : "No results." }],
			details: buildAsyncDetails(),
		});
	}

	/**
	 * Register one background job that runs a single spawn to completion and
	 * delivers its yield text. The job body mirrors the sync path; `buildDetails`
	 * supplies the (possibly batch-shared) progress snapshot and `onSettled`
	 * feeds the caller's aggregate counters.
	 */
	#registerSpawnJob(options: {
		manager: AsyncJobManager;
		toolCallId: string;
		spawnParams: TaskExecutionParams;
		agentId: string;
		progress: AgentProgress;
		ircEnabled: boolean;
		buildDetails: () => TaskToolDetails;
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>;
		batchSemaphore?: Semaphore;
		dependencyPromises?: readonly Promise<boolean>[];
		onSettled?: (failed: boolean) => void;
		allowFailedDependencies?: boolean;
	}): string {
		const {
			manager,
			toolCallId,
			spawnParams,
			agentId,
			progress,
			ircEnabled,
			buildDetails,
			onUpdate,
			onSettled,
			batchSemaphore,
			dependencyPromises = [],
			allowFailedDependencies,
		} = options;
		const buildFollowUpHint = async (aborted: boolean): Promise<string> => {
			// Isolated runs are parked without a reviver once the run ends
			// (`finalizeSubagentLifecycle`), so "message it" would point the
			// caller at a follow-up path that no longer exists. The template says
			// nothing about the worktree itself: the runner keeps it when captured
			// changes could not be written, and names that path in the result.
			const isolated = spawnParams.isolated === true;
			const ref = aborted ? AgentRegistry.global().get(agentId) : undefined;
			return `\n\n${prompt.render(taskFollowUpTemplate, {
				agentId,
				aborted,
				isolated,
				ircEnabled,
				resumable: !isolated && (ref?.status === "idle" || ref?.status === "parked"),
				transcriptAvailable: aborted ? await hasResolvableTranscript(agentId) : true,
			})}`;
		};
		return manager.register(
			"task",
			agentId,
			async ({ jobId, signal: runSignal, reportProgress, markRunning }) => {
				const startedAt = Date.now();
				try {
					await waitForTaskDependencies(dependencyPromises, runSignal, allowFailedDependencies !== true);
				} catch (error) {
					progress.status = runSignal.aborted ? "aborted" : "failed";
					spawnParams.integrationGate?.settle(progress.index);
					onSettled?.(true);
					throw new TaskJobError(error instanceof Error ? error.message : String(error));
				}
				const semaphore = this.#getSpawnSemaphore();
				let semaphoreHeld = false;
				let batchHeld = false;
				// Every release funnels through here: the flag flips before the
				// release so no path — acquire-time abort, executor failure, or a
				// future refactor that reorders the branches — can return a permit
				// twice. Releasing a permit this job never acquired would steal one
				// from a running job and let a later spawn start past
				// task.maxConcurrency.
				const releasePermit = () => {
					if (semaphoreHeld) {
						semaphoreHeld = false;
						this.#releaseSpawnSemaphore();
					}
					if (batchHeld) {
						batchHeld = false;
						batchSemaphore?.release();
					}
				};
				try {
					if (batchSemaphore) {
						await batchSemaphore.acquire(runSignal);
						batchHeld = true;
					}
					await semaphore.acquire(runSignal);
					semaphoreHeld = true;
				} catch {
					// Fall through so an acquire-time abort goes through the same
					// path as the post-acquire race below: progress + onSettled
					// have to fire even when the spawn never reached the executor,
					// otherwise the batch aggregate state stays "running" forever.
				}
				const acquiredAt = Date.now();
				if (!semaphoreHeld || runSignal.aborted) {
					releasePermit();
					progress.status = "aborted";
					spawnParams.integrationGate?.settle(progress.index);
					onSettled?.(true);
					throw new Error("Aborted before execution");
				}
				try {
					markRunning();
					progress.status = "running";
					await reportProgress(
						`Running background task ${agentId}...`,
						buildDetails() as unknown as Record<string, unknown>,
					);
					const forwardSyncProgress: AgentToolUpdateCallback<TaskToolDetails> = async update => {
						const nextProgress = update.details?.progress?.[0];
						if (nextProgress) {
							// The job body owns status and identity (id/index/agent);
							// copy only the live metrics the subagent streams so the
							// polling row reflects the resolved model, reasoning level,
							// and running counters without reverting the "running"
							// status back to the subagent's initial "pending" snapshot.
							progress.modelRole = nextProgress.modelRole ?? progress.modelRole;
							progress.resolvedModel = nextProgress.resolvedModel;
							progress.resolvedModelIdentity = nextProgress.resolvedModelIdentity;
							progress.resolvedThinkingLevel = nextProgress.resolvedThinkingLevel;
							progress.resolvedModelIsFallback = nextProgress.resolvedModel
								? nextProgress.resolvedModelIsFallback
								: undefined;
							progress.advisor = nextProgress.advisor ?? progress.advisor;
							progress.resolvedModelRoute = nextProgress.resolvedModelRoute ?? progress.resolvedModelRoute;
							progress.tokens = nextProgress.tokens;
							progress.requests = nextProgress.requests;
							progress.contextTokens = nextProgress.contextTokens;
							progress.contextWindow = nextProgress.contextWindow;
							progress.cost = nextProgress.cost;
							progress.toolCount = nextProgress.toolCount;
							progress.currentTool = nextProgress.currentTool;
							progress.lastIntent = nextProgress.lastIntent;
							progress.recentTools = nextProgress.recentTools.slice();
							progress.recentOutput = nextProgress.recentOutput.slice();
							progress.retryState = nextProgress.retryState;
							progress.retryFailure = nextProgress.retryFailure;
						}
						const updateText =
							update.content.find(part => part.type === "text")?.text ?? `Running background task ${agentId}...`;
						await reportProgress(updateText, buildDetails() as unknown as Record<string, unknown>);
					};
					const result = await this.#executeSync(
						toolCallId,
						spawnParams,
						runSignal,
						forwardSyncProgress,
						agentId,
						progress.index,
						true,
						{ invokedAt: startedAt, acquiredAt },
						cleanup => {
							// Tie the retained temp directory's lifetime to this job
							// row: the manager runs `cleanup` exactly once, on
							// eviction or manager disposal, instead of it leaking
							// for the process lifetime. Look up by the resolved
							// `jobId`, not the requested `agentId` — `register()`
							// suffixes `jobId` on collision, and looking up the
							// requested id would hit an unrelated pre-existing row.
							const job = manager.getJob(jobId);
							if (job) job.retainedArtifactsCleanup = cleanup;
							else void cleanup();
						},
					);
					const finalText = result.content.find(part => part.type === "text")?.text ?? "(no output)";
					const singleResult = result.details?.results[0];
					// A missing result means the sync path failed at the tool level
					// (results: []) — treat it as a failure, not success. A runner
					// error on a zero exit (changes captured but not landed, or a
					// retained workspace) is a failure too: the work needs manual
					// recovery, which a "completed" job would hide. Mirrors the sync
					// path's status derivation.
					const resultFailed =
						!singleResult ||
						(singleResult.aborted ?? false) ||
						singleResult.exitCode !== 0 ||
						singleResult.error !== undefined;
					progress.status = singleResult?.aborted ? "aborted" : resultFailed ? "failed" : "completed";
					progress.durationMs = singleResult?.durationMs ?? Math.max(0, Date.now() - startedAt);
					progress.tokens = singleResult?.tokens ?? 0;
					progress.requests = singleResult?.requests ?? 0;
					progress.contextTokens = singleResult?.contextTokens;
					progress.contextWindow = singleResult?.contextWindow;
					progress.cost = singleResult?.usage?.cost.total ?? 0;
					progress.extractedToolData = singleResult?.extractedToolData;
					progress.retryFailure = singleResult?.retryFailure;
					progress.retryState = undefined;
					progress.modelRole = singleResult?.modelRole ?? progress.modelRole;
					progress.advisor = singleResult?.advisor ?? progress.advisor;
					progress.resolvedModelRoute = singleResult?.resolvedModelRoute ?? progress.resolvedModelRoute;
					if (singleResult?.resolvedModel) {
						progress.resolvedModel = singleResult.resolvedModel;
						progress.resolvedModelIdentity = singleResult.resolvedModelIdentity;
						progress.resolvedThinkingLevel = singleResult.resolvedThinkingLevel;
						progress.resolvedModelIsFallback = singleResult.resolvedModelIsFallback;
					} else {
						delete progress.resolvedModel;
						delete progress.resolvedModelIdentity;
						delete progress.resolvedThinkingLevel;
						delete progress.resolvedModelIsFallback;
					}
					onSettled?.(resultFailed);
					const statusText = resultFailed
						? `Background task ${agentId} failed.`
						: `Background task ${agentId} complete.`;
					await reportProgress(statusText, buildDetails() as unknown as Record<string, unknown>);
					const deliveryText = `${finalText}${await buildFollowUpHint(singleResult?.aborted === true)}`;
					const structured = singleResult?.structuredOutput;
					if (resultFailed) {
						// Mark the job itself failed; the failed agent stays interrogable.
						throw new TaskJobError(deliveryText, structured);
					}
					return structured ? { text: deliveryText, structured } : deliveryText;
				} catch (error) {
					if (error instanceof TaskJobError) {
						throw error;
					}
					progress.status = "failed";
					progress.durationMs = Math.max(0, Date.now() - startedAt);
					onSettled?.(true);
					const statusText = `Background task ${agentId} failed.`;
					await reportProgress(statusText, buildDetails() as unknown as Record<string, unknown>);
					const message = error instanceof Error ? error.message : String(error);
					const hint = AgentRegistry.global().get(agentId) ? await buildFollowUpHint(false) : "";
					throw new TaskJobError(`${message}${hint}`);
				} finally {
					releasePermit();
					spawnParams.integrationGate?.settle(progress.index);
				}
			},
			{
				id: agentId,
				agentId,
				queued: true,
				ownerId: this.session.getAgentId?.() ?? undefined,
				onProgress: text => {
					onUpdate?.({ content: [{ type: "text", text }], details: buildDetails() });
				},
			},
		);
	}

	/**
	 * Sync fan-out (async unavailable, or every item's agent type is
	 * `blocking: true`): run every spawn to completion inline and merge the
	 * per-spawn payloads into a single tool result. The session-scoped
	 * semaphore still bounds concurrency across parallel task calls.
	 */
	async #executeSyncFanout(
		toolCallId: string,
		params: TaskParams,
		spawns: SyncSpawnRef[],
		defaultAgent: string,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		batchSemaphore?: Semaphore,
		dependencies?: number[][],
		dependencyPromises?: readonly Promise<boolean>[],
		settleDependency?: (index: number, success: boolean) => void,
		governorPlan?: GovernorTaskPlan,
		integrationGate?: IntegrationGate,
	): Promise<AgentToolResult<TaskToolDetails>> {
		if (spawns.length === 1) {
			const spawn = spawns[0]!;
			const semaphore = this.#getSpawnSemaphore();
			const invokedAt = Date.now();
			let batchHeld = false;
			let semaphoreHeld = false;
			let success = false;
			try {
				await waitForTaskDependencies(
					(dependencies?.[spawn.index] ?? []).map(index => dependencyPromises?.[index] ?? Promise.resolve(false)),
					signal,
					!canRunAfterFailedDependency(spawn.item),
				);
				if (batchSemaphore) {
					await batchSemaphore.acquire(signal);
					batchHeld = true;
				}
				await semaphore.acquire(signal);
				semaphoreHeld = true;
				const acquiredAt = Date.now();
				const result = await this.#executeSync(
					toolCallId,
					spawnParamsFor(params, spawn.item, defaultAgent, governorPlan, integrationGate),
					signal,
					onUpdate,
					spawn.preAllocatedId,
					spawn.index,
					false,
					{ invokedAt, acquiredAt },
				);
				const single = result.details?.results[0];
				success = !!single && !single.aborted && single.exitCode === 0 && single.error === undefined;
				return result;
			} finally {
				integrationGate?.settle(spawn.index);
				settleDependency?.(spawn.index, success);
				if (semaphoreHeld) this.#releaseSpawnSemaphore();
				if (batchHeld) batchSemaphore?.release();
			}
		}

		const startTime = Date.now();
		const latestProgress = new Map<number, AgentProgress>();
		const emitCombined = () => {
			onUpdate?.({
				content: [{ type: "text", text: `Running ${spawns.length} agents...` }],
				details: {
					projectAgentsDir: null,
					results: [],
					totalDurationMs: Date.now() - startTime,
					progress: Array.from(latestProgress.entries())
						.sort((a, b) => a[0] - b[0])
						.map(([, progress]) => progress),
				},
			});
		};

		const payloads = await this.#runSyncSpawns({
			toolCallId,
			params,
			defaultAgent,
			signal,
			spawns,
			batchSemaphore,
			dependencies,
			dependencyPromises,
			settleDependency,
			governorPlan,
			integrationGate,
			onItemProgress: onUpdate
				? (index, progress) => {
						latestProgress.set(index, { ...progress, index });
						emitCombined();
					}
				: undefined,
		});

		const merged = mergeSyncPayloads(spawns, payloads);
		return {
			content: [{ type: "text", text: merged.contentParts.join("\n\n") }],
			details: {
				projectAgentsDir: merged.projectAgentsDir,
				results: merged.results,
				totalDurationMs: Date.now() - startTime,
				usage: merged.usage,
				outputPaths: merged.outputPaths,
			},
		};
	}

	/**
	 * Run a set of spawns to completion inline, bounded by the session spawn
	 * semaphore. `preAllocatedId` reuses an id claimed up front (mixed calls);
	 * `index` is each item's position in the original call so progress rows and
	 * merged results keep stable ordering. Per-item progress snapshots flow
	 * through `onItemProgress`. Returns per-spawn payloads in input order;
	 * `undefined` marks a spawn cancelled before it started.
	 */
	async #runSyncSpawns(args: {
		toolCallId: string;
		params: TaskParams;
		defaultAgent: string;
		spawns: SyncSpawnRef[];
		batchSemaphore?: Semaphore;
		signal?: AbortSignal;
		dependencies?: number[][];
		dependencyPromises?: readonly Promise<boolean>[];
		settleDependency?: (index: number, success: boolean) => void;
		governorPlan?: GovernorTaskPlan;
		integrationGate?: IntegrationGate;
		onItemProgress?: (index: number, progress: AgentProgress) => void;
	}): Promise<(AgentToolResult<TaskToolDetails> | undefined)[]> {
		const {
			toolCallId,
			params,
			defaultAgent,
			spawns,
			signal,
			onItemProgress,
			batchSemaphore,
			dependencies = [],
			dependencyPromises = [],
			settleDependency,
			governorPlan,
			integrationGate,
		} = args;
		const semaphore = this.#getSpawnSemaphore();
		const { results } = await mapWithConcurrencyLimitAllSettled(
			spawns,
			spawns.length,
			async (spawn, _position, workerSignal) => {
				const invokedAt = Date.now();
				let semaphoreHeld = false;
				let batchHeld = false;
				let taskSucceeded = false;
				try {
					await waitForTaskDependencies(
						(dependencies[spawn.index] ?? []).map(index => dependencyPromises[index] ?? Promise.resolve(false)),
						workerSignal,
						!canRunAfterFailedDependency(spawn.item),
					);
					if (batchSemaphore) {
						await batchSemaphore.acquire(workerSignal);
						batchHeld = true;
					}
					await semaphore.acquire(workerSignal);
					semaphoreHeld = true;
				} catch (error) {
					if (batchHeld) batchSemaphore?.release();
					integrationGate?.settle(spawn.index);
					settleDependency?.(spawn.index, false);
					if (workerSignal.aborted) return undefined;
					throw error;
				}
				const acquiredAt = Date.now();
				try {
					const itemOnUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined = onItemProgress
						? update => {
								const progress = update.details?.progress?.[0];
								if (progress) onItemProgress(spawn.index, progress);
							}
						: undefined;
					const result = await this.#executeSync(
						toolCallId,
						spawnParamsFor(params, spawn.item, defaultAgent, governorPlan, integrationGate),
						workerSignal,
						itemOnUpdate,
						spawn.preAllocatedId,
						spawn.index,
						false,
						{ invokedAt, acquiredAt },
					);
					const single = result.details?.results[0];
					taskSucceeded = !!single && !single.aborted && single.exitCode === 0 && single.error === undefined;
					return result;
				} finally {
					integrationGate?.settle(spawn.index);
					settleDependency?.(spawn.index, taskSucceeded);
					if (semaphoreHeld) this.#releaseSpawnSemaphore();
					if (batchHeld) batchSemaphore?.release();
				}
			},
			signal,
		);
		return results.map((settled, position) => {
			if (!settled) return undefined;
			if (settled.status === "fulfilled") return settled.value;
			const message = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
			const item = spawns[position].item;
			return {
				content: [
					{
						type: "text",
						text: `Task ${item.name?.trim() || `#${spawns[position].index + 1}`} failed: ${message}`,
					},
				],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		});
	}

	async #runGovernorReview(
		result: AgentToolResult<TaskToolDetails>,
		params: TaskParams,
		reviewer: NonNullable<GovernorTaskPlan["reviewer"]>,
		highRisk: boolean,
		signal?: AbortSignal,
	): Promise<{ result: AgentToolResult<TaskToolDetails>; attempted: boolean }> {
		const workerFailed = (result.details?.results ?? []).some(
			worker => worker.aborted === true || worker.exitCode !== 0 || worker.error !== undefined,
		);
		const shouldReview = reviewer === "independent" || (reviewer === "risk_based" && (highRisk || workerFailed));
		if (
			!shouldReview ||
			!canSpawnAtDepth(cfgTaskMaxRecursionDepth.get(this.session.settings), this.session.taskDepth ?? 0)
		) {
			return { result, attempted: false };
		}
		const taskRequest = params.tasks?.length
			? params.tasks.map((task, index) => `${task.name?.trim() || `Task ${index + 1}`}: ${task.task}`).join("\n")
			: (params.task ?? "");
		const request = [params.context, taskRequest].filter(Boolean).join("\n\n");
		const workerResults = result.content
			.filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
			.map(part => part.text)
			.join("\n\n");
		const reviewTask = prompt.render(taskGovernorReviewAssignmentTemplate, {
			request: truncateForPrompt(request, 8_000),
			results: truncateForPrompt(workerResults, 12_000),
		});
		let reviewResult: AgentToolResult<TaskToolDetails>;
		try {
			const semaphore = this.#getSpawnSemaphore();
			await semaphore.acquire(signal);
			try {
				reviewResult = await this.#executeSync("governor-review", { agent: "reviewer", task: reviewTask }, signal);
			} finally {
				this.#releaseSpawnSemaphore();
			}
		} catch (error) {
			logger.warn("Governor reviewer could not be started", { error: String(error), reviewer });
			const text = `Governor review was not run: ${error instanceof Error ? error.message : String(error)}`;
			return { result: appendTaskText(result, text), attempted: false };
		}
		const reviewText = reviewResult.content
			.filter(
				(part): part is Extract<(typeof reviewResult.content)[number], { type: "text" }> => part.type === "text",
			)
			.map(part => part.text)
			.join("\n\n");
		const reviewWorker = reviewResult.details?.results[0];
		const reviewSucceeded =
			reviewWorker !== undefined &&
			!reviewWorker.aborted &&
			reviewWorker.exitCode === 0 &&
			reviewWorker.error === undefined;
		return {
			result: appendTaskText(
				result,
				reviewSucceeded
					? `Governor reviewer result:\n${reviewText || "(no review output)"}`
					: `Governor review was not run successfully:\n${reviewText || "(no review output)"}`,
			),
			attempted: reviewSucceeded,
		};
	}

	/**
	 * Synchronous execution of one spawn. Used as the body of every
	 * async job and directly by the sync fallback (no job manager / blocking
	 * agent) and by in-process callers that need the result inline (e.g. the
	 * commit flow's analyze_files tool).
	 */
	async #executeSync(
		toolCallId: string,
		params: TaskExecutionParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		preAllocatedId?: string,
		spawnIndex = 0,
		detached = false,
		launchTiming?: { invokedAt: number; acquiredAt: number },
		onArtifactsRetained?: (cleanup: () => Promise<void>) => void,
	): Promise<AgentToolResult<TaskToolDetails>> {
		return this.#runSpawn(
			toolCallId,
			params,
			signal,
			onUpdate,
			preAllocatedId,
			spawnIndex,
			detached,
			launchTiming,
			onArtifactsRetained,
		);
	}

	/** Spawn a fresh subagent and run it to completion. */
	async #runSpawn(
		toolCallId: string,
		params: TaskExecutionParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		preAllocatedId?: string,
		spawnIndex = 0,
		detached = false,
		launchTiming?: { invokedAt: number; acquiredAt: number },
		onArtifactsRetained?: (cleanup: () => Promise<void>) => void,
	): Promise<AgentToolResult<TaskToolDetails>> {
		const startTime = Date.now();
		let assignment = (params.task ?? "").trim();
		const repairBudget = params.integrationGateTask
			? new IntegrationRepairBudget(params.integrationGateRepairLimits ?? DEFAULT_REPAIR_BUDGET)
			: undefined;
		let gateWorkerResults = "";
		if (params.integrationGateTask) {
			gateWorkerResults =
				params.integrationGate
					?.workerResults()
					.filter(({ result }) => result.index < spawnIndex)
					.map(({ result, mergeSummary, changesApplied }) => {
						const status = result.error ?? (result.aborted ? "aborted" : `exit code ${result.exitCode}`);
						const integration =
							changesApplied === false ? `\nIntegration apply failed: ${mergeSummary ?? "no details"}` : "";
						const artifacts = [
							result.outputPath ? `output: ${result.outputPath}` : undefined,
							result.patchPath ? `patch: ${result.patchPath}` : undefined,
							result.branchName ? `branch: ${result.branchName}` : undefined,
						]
							.filter(Boolean)
							.join("; ");
						const output = truncateForPrompt(result.output || result.stderr, 2_000);
						return `${result.task} (${status})${artifacts ? `; ${artifacts}` : ""}${integration}\n${output}`;
					})
					.join("\n\n") ?? "";
			assignment = prompt.render(taskIntegrationGateTemplate, {
				context: truncateForPrompt(params.integrationGateContext ?? "", 8_000),
				assignments: truncateForPrompt(params.integrationGateAssignments ?? "", 8_000),
				results: truncateForPrompt(gateWorkerResults || "No implementation results were reported.", 12_000),
				strategy: params.integrationGateVerification?.strategy ?? "targeted_checks",
				floor: params.integrationGateVerification?.floor ?? "V1",
				ceiling: params.integrationGateVerification?.ceiling ?? "V2",
				maxAttempts: repairBudget?.limits.maxAttempts ?? DEFAULT_REPAIR_BUDGET.maxAttempts,
				maxTokens: repairBudget?.limits.maxTokens ?? DEFAULT_REPAIR_BUDGET.maxTokens,
				maxCostUsd: repairBudget?.limits.maxCostUsd ?? DEFAULT_REPAIR_BUDGET.maxCostUsd,
				maxWallTimeMs: repairBudget?.limits.maxWallTimeMs ?? DEFAULT_REPAIR_BUDGET.maxWallTimeMs,
				stagnationLimit: repairBudget?.limits.stagnationLimit ?? DEFAULT_REPAIR_BUDGET.stagnationLimit,
				repairHistory: "No previous attempts.",
			});
		}
		const context = this.#isBatchEnabled() ? params.context?.trim() || undefined : undefined;
		let latestProgress: AgentProgress | undefined;
		try {
			const runAttempt = async (): Promise<StructuredSubagentResult> =>
				runStructuredSubagent({
					session: this.session,
					invocationKind: "task",
					assignment,
					context,
					agent: params.agent,
					...(params.governorModelRole ? { model: formatModelRoleAlias(params.governorModelRole) } : {}),
					...(Object.hasOwn(params, "outputSchema") ? { outputSchema: params.outputSchema } : {}),
					...(Object.hasOwn(params, "schemaMode") ? { schemaMode: params.schemaMode } : {}),
					...(params.effort !== undefined ? { effort: params.effort } : {}),
					...(params.tools?.length
						? {
								customTools: createEvalCustomTools(
									this.session,
									await describeEvalTools(this.session, params.tools, signal),
								),
							}
						: {}),
					// `name` is the spawn handle: keep it for id allocation when this
					// path did not pre-reserve one. Do not treat it as a HUD description.
					identity: { id: preAllocatedId, label: params.name },
					index: spawnIndex,
					integrationGate: params.integrationGate,
					parentToolCallId: toolCallId,
					detached,
					// Detached (async) spawns advertise `agent://<id>` handles in the
					// eventual async-result delivery, which can land well after this
					// call returns. Without this, a temporary (in-memory session)
					// artifacts directory is deleted immediately on completion and the
					// advertised URL 404s by the time delivery happens.
					retainArtifacts: detached,
					...(onArtifactsRetained ? { onArtifactsRetained } : {}),
					invokedAt: launchTiming?.invokedAt,
					acquiredAt: launchTiming?.acquiredAt,
					...("isolated" in params ? { isolation: { requested: params.isolated } } : {}),
					blockedAgent: this.#blockedAgent,
					enableLsp: (this.session.enableLsp ?? true) && cfgTaskEnableLsp.get(this.session.settings),
					enableIrc: isIrcEnabled(this.session.settings, this.session.taskDepth ?? 0),
					maxRuntimeMs: repairBudget
						? Math.min(
								cfgTaskMaxRuntimeMs.get(this.session.settings) || Number.POSITIVE_INFINITY,
								repairBudget.remainingWallTimeMs,
							)
						: cfgTaskMaxRuntimeMs.get(this.session.settings),
					signal,
					onProgress: progress => {
						latestProgress = { ...progress, recentTools: progress.recentTools.slice() };
						onUpdate?.({
							content: [{ type: "text", text: `Running agent ${progress.id}...` }],
							details: {
								projectAgentsDir: null,
								results: [],
								totalDurationMs: Date.now() - startTime,
								progress: [latestProgress],
							},
						});
					},
				});
			let execution: StructuredSubagentResult;
			while (true) {
				if (params.integrationGateTask && !params.integrationGate?.reserveReconciliationAttempt()) {
					throw new StructuredSubagentError("execution", "Automatic repair attempt budget exhausted.");
				}
				execution = await runAttempt();
				if (!params.integrationGateTask || !repairBudget) break;
				const failure = integrationGateFailure(execution.result, params.integrationGateVerification);
				repairBudget.record(execution.result, failure);
				const totals = repairBudget.totals;
				execution.result.tokens = totals.tokens;
				execution.result.durationMs = totals.wallTimeMs;
				if (!failure) {
					if (repairBudget.attempts.length > 1 && isRecord(execution.result.structuredOutput?.data)) {
						const data = execution.result.structuredOutput.data;
						execution.result.structuredOutput.data = {
							...data,
							status: "reconciled",
							repairAttempts: Math.max(repairBudget.attempts.length - 1, Number(data.repairAttempts) || 0),
							summary: `${String(data.summary)} Repair history: ${repairBudget.summary()}`,
						};
					}
					break;
				}
				const stopReason = repairBudget.stopReason();
				if (stopReason) {
					execution.result.error = `Automatic repair budget exhausted (${stopReason}). ${failure}\n${repairBudget.summary()}`;
					if (isRecord(execution.result.structuredOutput?.data)) {
						const data = execution.result.structuredOutput.data;
						execution.result.structuredOutput.data = {
							...data,
							status: "unresolved",
							repairAttempts: Math.max(repairBudget.attempts.length - 1, Number(data.repairAttempts) || 0),
							summary: `${failure} Automatic repair budget exhausted (${stopReason}).`,
						};
					}
					break;
				}
				assignment = prompt.render(taskIntegrationGateTemplate, {
					context: truncateForPrompt(params.integrationGateContext ?? "", 8_000),
					assignments: truncateForPrompt(params.integrationGateAssignments ?? "", 8_000),
					results: truncateForPrompt(gateWorkerResults || "No implementation results were reported.", 12_000),
					strategy: params.integrationGateVerification?.strategy ?? "targeted_checks",
					floor: params.integrationGateVerification?.floor ?? "V1",
					ceiling: params.integrationGateVerification?.ceiling ?? "V2",
					maxAttempts: repairBudget.limits.maxAttempts,
					maxTokens: repairBudget.limits.maxTokens,
					maxCostUsd: repairBudget.limits.maxCostUsd,
					maxWallTimeMs: repairBudget.limits.maxWallTimeMs,
					stagnationLimit: repairBudget.limits.stagnationLimit,
					repairHistory: repairBudget.summary(),
				});
			}
			if (
				params.integrationGateTask &&
				execution.result.error &&
				!isRecord(execution.result.structuredOutput?.data)
			) {
				execution.result.error = `Integration verification unresolved: ${execution.result.error}`;
			}
			if (!params.integrationGateTask) {
				params.integrationGate?.recordWorkerResult(spawnIndex, {
					result: execution.result,
					mergeSummary: execution.mergeSummary,
					changesApplied: execution.changesApplied,
				});
			}
			return this.#buildResultPayload(
				execution.result,
				execution.policy.discovery.projectAgentsDir,
				Date.now() - startTime,
				execution.mergeSummary,
			);
		} catch (error) {
			const message = error instanceof StructuredSubagentError ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Task execution failed: ${message}` }],
				details: {
					projectAgentsDir: null,
					results: [],
					totalDurationMs: Date.now() - startTime,
					...(latestProgress ? { progress: [latestProgress] } : {}),
				},
			};
		} finally {
			params.integrationGate?.settle(spawnIndex);
		}
	}

	/** Build the tool result (summary text + details) for a settled run. */
	#buildResultPayload(
		result: SingleResult,
		projectAgentsDir: string | null,
		totalDurationMs: number,
		mergeSummary: string,
	): AgentToolResult<TaskToolDetails> {
		const summary = formatTaskResultSummary(result, { totalDurationMs, mergeSummary });

		return {
			content: [{ type: "text", text: summary }],
			details: {
				projectAgentsDir,
				results: [result],
				totalDurationMs,
				usage: result.usage,
				outputPaths: result.outputPath ? [result.outputPath] : undefined,
			},
		};
	}
}

subprocessToolRegistry.register<TaskToolDetails>("task", {
	...taskSubprocessRenderer,
	extractData: event => (isTaskToolDetails(event.result?.details) ? event.result.details : undefined),
});
