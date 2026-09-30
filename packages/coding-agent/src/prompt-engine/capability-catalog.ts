import type { PromptCapabilityId, PromptModuleId } from "./profiles";
import { isMCPToolName } from "../tools/builtin-names";

export interface ToolCapabilityDefinition {
	toolName: string;
	/** A tool can be promoted directly only when no separate runtime activation is required. */
	routeable: boolean;
	promptModules: readonly PromptModuleId[];
}

/** Existing prompt capability names and their canonical tool surfaces. */
export const TOOL_CAPABILITY_CATALOG = {
	lsp: { toolName: "lsp", routeable: true, promptModules: [] },
	git: { toolName: "bash", routeable: false, promptModules: [] },
	testing: { toolName: "bash", routeable: false, promptModules: ["testing"] },
	subagents: { toolName: "task", routeable: true, promptModules: ["delegation"] },
	browser: { toolName: "eval", routeable: false, promptModules: [] },
	debugger: { toolName: "debug", routeable: true, promptModules: [] },
	github: { toolName: "github", routeable: true, promptModules: [] },
	images: { toolName: "generate_image", routeable: true, promptModules: [] },
} as const satisfies Partial<Record<PromptCapabilityId, ToolCapabilityDefinition>>;

export type RoutableToolCapabilityId = {
	[K in keyof typeof TOOL_CAPABILITY_CATALOG]: (typeof TOOL_CAPABILITY_CATALOG)[K]["routeable"] extends true
		? K
		: never;
}[keyof typeof TOOL_CAPABILITY_CATALOG];

export type TaskCapabilityId = Exclude<RoutableToolCapabilityId, "subagents"> | "browser" | `mcp__${string}`;

/** Validate the direct-tool capabilities a structured task source can request. */
export function isTaskCapabilityId(value: unknown): value is TaskCapabilityId {
	return (
		typeof value === "string" &&
		(value === "browser" || isMCPToolName(value) || TASK_TOOL_CAPABILITY_IDS.some(id => id === value))
	);
}

export const ROUTABLE_TOOL_CAPABILITY_IDS = Object.keys(TOOL_CAPABILITY_CATALOG).filter(
	(id): id is RoutableToolCapabilityId =>
		TOOL_CAPABILITY_CATALOG[id as keyof typeof TOOL_CAPABILITY_CATALOG].routeable,
);

export const TASK_TOOL_CAPABILITY_IDS = ROUTABLE_TOOL_CAPABILITY_IDS.filter(
	(id): id is Exclude<RoutableToolCapabilityId, "subagents"> => id !== "subagents",
);
