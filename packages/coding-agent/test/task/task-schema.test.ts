import { afterEach, describe, expect, it, vi } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TaskTool, taskSchema } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import { getTaskSchema } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

// Contract: the single-spawn schema (`task.batch: false`; the exported
// `taskSchema` instance) carries no batch fields while accepting a caller
// `model`, `outputSchema`, and its validation mode. The batch shape (`tasks[]` + shared
// `context`) is gated by the `task.batch` setting (default on, covered by
// test/task/task-batch.test.ts).

describe("task schema (single-spawn)", () => {
	it("requires task", () => {
		const parsed = taskSchema({ agent: "scout", solutionSpace: "c" });
		expect(parsed instanceof type.errors).toBe(true);
	});

	it("removes eval tool names from the wire shape when eval.tools.enabled is off", () => {
		const schema = getTaskSchema({
			isolationEnabled: false,
			batchEnabled: false,
			evalToolsEnabled: false,
		});
		const parsed = schema({
			agent: "scout",
			task: "Map the auth module.",
			solutionSpace: "c",
			tools: ["word_count"],
		});
		expect(parsed instanceof type.errors).toBe(false);
		if (parsed && typeof parsed === "object" && !(parsed instanceof type.errors)) {
			expect("tools" in parsed).toBe(false);
		}
	});

	it("retains caller outputSchema, schemaMode, and eval tool names while stripping stale keys", () => {
		const outputSchema = { type: "object", properties: { answer: { type: "string" } } };
		const parsed = taskSchema({
			agent: "scout",
			task: "Map the auth module.",
			solutionSpace: "c",
			outputSchema,
			schemaMode: "strict",
			tools: ["word_count"],
			context: "shared background",
			tasks: [{ name: "A", task: "..." }],
			schema: '{"properties":{}}',
		});
		expect(parsed instanceof type.errors).toBe(false);
		if (!(parsed instanceof type.errors)) {
			expect(parsed.outputSchema).toEqual(outputSchema);
			expect(parsed.schemaMode).toBe("strict");
			expect(parsed.tools).toEqual(["word_count"]);
			expect("tasks" in parsed).toBe(false);
			expect("context" in parsed).toBe(false);
			expect("schema" in parsed).toBe(false);
		}
	});

	it("accepts browser and exact MCP capability requirements only when routing is enabled", () => {
		const schema = getTaskSchema({
			isolationEnabled: false,
			batchEnabled: true,
			defaultAgent: "task",
			effortEnabled: false,
			evalToolsEnabled: false,
			capabilityRoutingEnabled: true,
		});
		const parsed = schema({
			context: "Inspect the web app",
			capabilities: ["browser", "mcp__server__tool"],
			tasks: [
				{ solutionSpace: "Inspect browser behavior", task: "Use the browser", capabilities: ["browser"] },
				{
					solutionSpace: "Inspect connected service",
					task: "Inspect connected service",
					capabilities: ["mcp__server__tool"],
				},
			],
		});
		expect(parsed instanceof type.errors).toBe(false);
		const disabled = getTaskSchema({
			isolationEnabled: false,
			batchEnabled: true,
			defaultAgent: "task",
			effortEnabled: false,
			evalToolsEnabled: false,
			capabilityRoutingEnabled: false,
		});
		const disabledParsed = disabled({
			context: "Inspect",
			tasks: [{ solutionSpace: "Inspect browser behavior", task: "Use the browser" }],
			capabilities: ["browser"],
		});
		expect(disabledParsed instanceof type.errors).toBe(false);
		expect(Reflect.has(disabledParsed as object, "capabilities")).toBe(false);
	});

	it("accepts a Governor high-risk flag at call and task-item scope", () => {
		const schema = getTaskSchema({
			isolationEnabled: false,
			batchEnabled: true,
			defaultAgent: "task",
			governorEnabled: true,
		});
		const parsed = schema({
			context: "Update the authentication flow",
			highRisk: true,
			tasks: [{ solutionSpace: "Update validation", task: "Change token validation", highRisk: true }],
		});
		expect(parsed instanceof type.errors).toBe(false);
		if (!(parsed instanceof type.errors)) {
			expect(parsed).toMatchObject({ highRisk: true, tasks: [{ highRisk: true }] });
		}
		expect(
			schema({
				context: "Bad risk input",
				highRisk: "high",
				tasks: [{ solutionSpace: "Update validation", task: "Change token validation" }],
			}) instanceof type.errors,
		).toBe(true);
		const disabled = getTaskSchema({ isolationEnabled: false, batchEnabled: true, defaultAgent: "task" });
		const disabledParsed = disabled({
			context: "Ignored metadata",
			highRisk: true,
			tasks: [{ solutionSpace: "Update validation", task: "Change token validation", highRisk: true }],
		});
		expect(disabledParsed instanceof type.errors).toBe(false);
		if (!(disabledParsed instanceof type.errors)) {
			expect(Reflect.has(disabledParsed as object, "highRisk")).toBe(false);
			const parsedTasks = Reflect.get(disabledParsed as object, "tasks") as unknown[];
			expect(parsedTasks).toHaveLength(1);
			expect(Reflect.has(parsedTasks[0] as object, "highRisk")).toBe(false);
		}
	});
});

describe("task spawn validation", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function createSession(): ToolSession {
		return {
			cwd: "/tmp",
			hasUI: false,
			settings: Settings.isolated({ "task.isolation.enabled": false, "task.batch": false }),
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
		} as unknown as ToolSession;
	}

	async function executeText(params: unknown): Promise<string> {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({ agents: [], projectAgentsDir: null });
		const tool = await TaskTool.create(createSession());
		const result = await tool.execute("tool-call", params);
		return result.content.find(part => part.type === "text")?.text ?? "";
	}

	it("defaults a missing agent to `task`", async () => {
		// With no `agent`, execute() normalizes to the `task` default, so the
		// failure is unknown-agent (none discovered), not missing-agent.
		const text = await executeText({ task: "..." });
		expect(text).toContain('Unknown agent "task"');
	});

	it("rejects a missing task", async () => {
		const text = await executeText({ agent: "scout" });
		expect(text).toContain("Missing `task`");
	});
});

describe("per-call model schema boundaries", () => {
	for (const isolationEnabled of [false, true]) {
		for (const effortEnabled of [false, true]) {
			it(`rejects batch-container model (isolation=${isolationEnabled}, effort=${effortEnabled})`, () => {
				const schema = getTaskSchema({ isolationEnabled, effortEnabled, batchEnabled: true });
				const result = schema({
					context: "Shared context",
					model: "p/requested",
					tasks: [{ task: "Do work", solutionSpace: "c" }],
				});
				expect(result instanceof type.errors).toBe(true);
			});
		}
	}

	it("accepts ordered model arrays on both flat calls and batch items", () => {
		const models = ["p/preferred:high", "p/alternative"];
		const flat = taskSchema({ task: "Do work", solutionSpace: "c", model: models });
		expect(flat instanceof type.errors).toBe(false);
		if (flat instanceof type.errors) throw new Error(flat.summary);
		expect(flat.model).toEqual(models);
		const batch = getTaskSchema({ isolationEnabled: false, batchEnabled: true })({
			context: "Shared context",
			tasks: [{ task: "Do work", solutionSpace: "c", model: models }],
		});
		expect(batch instanceof type.errors).toBe(false);
	});
});
