import { afterEach, describe, expect, it, vi } from "bun:test";
import { AsyncJobManager } from "../../src/async";
import { Settings } from "../../src/config/settings";
import subagentSystemPrompt from "../../src/prompts/system/subagent-system-prompt.md" with { type: "text" };
import { AgentRegistry } from "../../src/registry/agent-registry";
import { AgentLifecycleManager } from "../../src/registry/agent-lifecycle";
import type { AgentSession } from "../../src/session/agent-session";
import { WaitTool } from "../../src/tools/wait";
import type { CustomMessage } from "../../src/session/messages";
import * as executor from "../../src/task/executor";
import type { EffectiveSubagentPolicy, StructuredSubagentResult } from "../../src/task/structured-subagent";
import * as structured from "../../src/task/structured-subagent";
import { cfgTaskMaxConcurrency } from "../../src/task/settings";
import { sessionTaskSemaphore } from "../../src/task/parallel";
import type { AgentDefinition } from "../../src/task/types";
import type { SingleResult } from "@oh-my-pi/pi-tui/tools/task";
import { WorkPool, WorkPoolRegistry } from "../../src/task/workpool";
import type { ToolSession } from "../../src/tools";
import type { ToolCapabilityRouteDecision } from "../../src/prompt-engine/capability-router";
import { prompt } from "@oh-my-pi/pi-utils";

const AGENT: AgentDefinition = {
	name: "scout",
	description: "Test scout",
	systemPrompt: "Do the work.",
	source: "bundled",
};

const POLICY = {
	discovery: { agents: [AGENT], projectAgentsDir: null },
	agentName: "scout",
	agent: AGENT,
	effectiveAgent: AGENT,
	schema: { schema: undefined, source: "none", mode: "permissive", outputSchemaOverridesAgent: false },
	planMode: false,
	isIsolated: false,
	mergeMode: "patch",
	applyChanges: true,
	enableLsp: false,
	enableIrc: true,
} satisfies EffectiveSubagentPolicy;

const managers = new Set<AsyncJobManager>();

function makeSession(
	cards: CustomMessage[] = [],
	concurrency: number | null = 2,
	freshAgents = false,
	deliveries?: Array<{ id: string; text: string }>,
	retentionMs = 0,
): ToolSession {
	const manager = new AsyncJobManager({ retentionMs });
	if (deliveries) {
		manager.registerDeliverySink("Main", (id, text) => {
			deliveries.push({ id, text });
		});
	}
	managers.add(manager);
	const session = {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated({
			...(concurrency === null ? {} : { "task.maxConcurrency": concurrency }),
			"task.maxRuntimeMs": 0,
			"eval.workpool.freshAgents": freshAgents,
			"launch.enabled": false,
		}),
		asyncJobManager: manager,
		getAgentId: () => "Main",
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getArtifactsDir: () => null,
	} satisfies ToolSession;
	AgentRegistry.global().register({
		id: "Main",
		displayName: "Main",
		kind: "main",
		status: "idle",
		session: { emitIrcRelayObservation: (card: CustomMessage) => cards.push(card) } as unknown as AgentSession,
	});
	return session;
}

function singleResult(id: string, output = `done ${id}`): SingleResult {
	return {
		index: 0,
		id,
		agent: "scout",
		agentSource: "bundled",
		task: "pool batch",
		exitCode: 0,
		output,
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 1,
		requests: 1,
	};
}

function execution(id: string, output?: string): StructuredSubagentResult {
	return {
		result: singleResult(id, output),
		policy: POLICY,
		mergeSummary: "",
		changesApplied: null,
		artifactsDir: "/tmp",
		temporaryArtifacts: true,
	};
}

function markIdle(id: string): void {
	AgentRegistry.global().register({
		id,
		displayName: id,
		kind: "sub",
		status: "idle",
		session: null,
	});
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 1_000; attempt++) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error("condition did not become true");
}

function cardMode(card: CustomMessage): string | undefined {
	const details = card.details;
	if (!details || typeof details !== "object" || !("mode" in details)) return undefined;
	return typeof details.mode === "string" ? details.mode : undefined;
}

function pool(session: ToolSession, name = "review"): WorkPool {
	return new WorkPool(session, { name, policy: POLICY });
}

function activeCapabilityRoute(id: "lsp" | "debugger" | "browser"): ToolCapabilityRouteDecision {
	return {
		id,
		toolName: id,
		state: "active",
		selected: true,
		source: "built-in",
		estimatedGuidanceTokens: 0,
		estimatedToolSchemaTokens: 0,
		estimatedActivationTokens: 0,
		reason: "capability is active",
	};
}

async function finishPool(session: ToolSession, workpool: WorkPool): Promise<void> {
	const job = session.asyncJobManager?.getJob(workpool.name);
	if (!job) throw new Error(`Missing pool job ${workpool.name}`);
	await job.promise;
}

afterEach(async () => {
	for (const manager of managers) await manager.dispose();
	managers.clear();
	vi.restoreAllMocks();
	AgentRegistry.resetGlobalForTests();
	// The global lifecycle binds its registry at construction; drop it with the
	// registry so release() in later tests manages the current instance.
	AgentLifecycleManager.resetGlobalForTests();
	WorkPoolRegistry.resetForTests();
});

describe("WorkPool dispatch", () => {
	it("queues a workpool turn while another session task holds the only slot", async () => {
		const session = makeSession([], 1);
		const semaphore = sessionTaskSemaphore(session, 1);
		await semaphore.acquire();
		let started = false;
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			started = true;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session);
		workpool.push(["one"]);
		try {
			await until(() => workpool.batches.length === 1);
			const batch = workpool.batches[0]!;
			expect(session.asyncJobManager?.getJob(batch.jobId)?.queued).toBe(true);
			expect(workpool.status().items).toMatchObject({ queued: 1, running: 0 });
			expect(workpool.peek().batches[0]?.status).toBe("queued");
			expect(started).toBe(false);
		} finally {
			semaphore.release();
		}
		await finishPool(session, workpool);
		expect(started).toBe(true);
		expect(workpool.items[0]?.status).toBe("completed");
	});

	it("close cancels a slot-waiting turn and reports its item as dropped", async () => {
		const session = makeSession([], 1);
		const semaphore = sessionTaskSemaphore(session, 1);
		await semaphore.acquire();
		const runSpy = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "close-waiting");
		workpool.push(["one"]);
		try {
			await until(() => workpool.batches.length === 1);
			expect(workpool.close()).toEqual({ dropped: ["close-waiting#1"] });
			await finishPool(session, workpool);
			expect(workpool.items[0]?.status).toBe("cancelled");
			expect(workpool.peek().batches[0]?.status).toBe("cancelled");
			expect(runSpy).not.toHaveBeenCalled();
		} finally {
			semaphore.release();
		}
	});

	it("cancels a workpool turn waiting for a session slot without starting its worker", async () => {
		const session = makeSession([], 1);
		const semaphore = sessionTaskSemaphore(session, 1);
		await semaphore.acquire();
		const runSpy = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "cancel-queued");
		workpool.push(["one"]);
		try {
			await until(() => workpool.batches.length === 1);
			const batch = workpool.batches[0]!;
			const batchJob = session.asyncJobManager?.getJob(batch.jobId);
			expect(batchJob?.queued).toBe(true);
			expect(session.asyncJobManager?.cancel(workpool.name, { ownerId: "Main" })).toBe(true);
			await until(() => batch.status === "cancelled");
			await finishPool(session, workpool);
			expect(workpool.items[0]?.status).toBe("cancelled");
			expect(batchJob?.status).toBe("cancelled");
			expect(runSpy).not.toHaveBeenCalled();
		} finally {
			semaphore.release();
		}
		await semaphore.acquire(AbortSignal.timeout(200));
		semaphore.release();
	});

	it("renders the flat workpool yield contract after shared context", () => {
		const rendered = prompt.render(subagentSystemPrompt, {
			agent: "Worker",
			context: "Shared context for every item.",
			workPoolYieldItems: [{ id: "pool#1", index: 1 }],
			outputSchema: { type: "object", properties: { "pool#1": {} } },
		});
		expect(rendered).toContain("{ key: <1-based number>, data: <outcome> }");
		expect(rendered).not.toContain("Your terminal `yield` MUST use exactly this shape");
	});
	it("spawns while there is room, then queues round-robin, and dispatches to an idle agent", async () => {
		const cards: CustomMessage[] = [];
		const session = makeSession(cards);
		const gates = new Map<string, PromiseWithResolvers<void>>();
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			const gate = Promise.withResolvers<void>();
			gates.set(id, gate);
			await gate.promise;
			markIdle(id);
			return execution(id);
		});
		vi.spyOn(executor, "runSubagentFollowUpTurn").mockImplementation(async options => {
			markIdle(options.id);
			return singleResult(options.id, "follow-up done");
		});
		const workpool = pool(session);

		expect(workpool.push(["one", "two", "three", "four"])).toEqual(["review#1", "review#2", "review#3", "review#4"]);
		await until(() => workpool.agents.length === 2 && workpool.agents.every(agent => agent.queue.length === 1));
		expect(workpool.agents.map(agent => agent.queue[0]?.id)).toEqual(["review#3", "review#4"]);
		expect(cards.map(cardMode)).toEqual(["spawned", "spawned", "queued", "queued"]);

		gates.get(workpool.agents[0]!.id)?.resolve();
		await until(() => workpool.agents[0]?.state === "idle" && workpool.agents[0]?.turns === 2);
		workpool.push(["five"]);
		await until(() => cards.some(card => cardMode(card) === "dispatched"));
		expect(cards.map(cardMode)).toContain("dispatched");
		expect(workpool.items[4]?.agentId).toBe(workpool.agents[0]?.id);
		gates.get(workpool.agents[1]!.id)?.resolve();
		await finishPool(session, workpool);
		expect(cards.map(cardMode)).toContain("completed");
	});

	it("caps workpool agent spawning from the current independent item count", async () => {
		const session = makeSession([], null);
		const routedCounts: number[] = [];
		session.routeGovernorTaskBatch = count => {
			routedCounts.push(count);
			return 2;
		};
		const gate = Promise.withResolvers<void>();
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			await gate.promise;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		vi.spyOn(executor, "runSubagentFollowUpTurn").mockImplementation(async options => {
			markIdle(options.id);
			return singleResult(options.id);
		});
		const workpool = pool(session);
		workpool.push(["one", "two", "three", "four"]);
		await until(() => workpool.items.every(item => item.agentId !== undefined));
		expect(routedCounts).toEqual([4]);
		expect(workpool.agents).toHaveLength(2);
		cfgTaskMaxConcurrency.set(session.settings, 3);
		workpool.push(["five"]);
		await until(() => workpool.agents.length === 3);
		expect(routedCounts).toEqual([4, 5]);
		gate.resolve();
		await finishPool(session, workpool);
	});

	it("passes the selected Governor effort to a newly spawned worker", async () => {
		const session = makeSession();
		session.routeGovernorTaskPlan = () => ({ workerCount: 1, effort: "hi" });
		let receivedEffort: string | undefined;
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			receivedEffort = request.effort;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "governor-effort");
		workpool.push(["one"]);
		await finishPool(session, workpool);
		expect(receivedEffort).toBe("hi");
	});

	it("routes explicitly declared workpool capabilities through task facts", async () => {
		const session = makeSession();
		let routedFacts: unknown;
		session.routeGovernorTaskTransition = async request => {
			routedFacts = request.facts;
			expect(request.ownerId).toBe("workpool:governor-capability");
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes: [activeCapabilityRoute("lsp")],
			};
		};
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "governor-capability");
		workpool.push(["inspect the parser", "check its callers"], ["lsp"]);
		await finishPool(session, workpool);
		expect(routedFacts).toMatchObject({
			tasks: [
				{ dependsOn: [], requiredCapabilities: ["lsp"] },
				{ dependsOn: [], requiredCapabilities: ["lsp"] },
			],
		});
	});

	it("releases the workpool's capability lease when the pool closes", async () => {
		const session = makeSession();
		const release = vi.fn(async () => {});
		session.releaseGovernorTaskCapabilityRoutes = release;
		const workpool = pool(session, "lease-owner");

		workpool.close();
		await Bun.sleep(0);

		expect(release).toHaveBeenCalledWith("workpool:lease-owner");
	});

	it("releases a capability lease after a pending transition settles on close", async () => {
		const session = makeSession();
		const transition = Promise.withResolvers<{
			snapshot: undefined;
			route: undefined;
			capabilityRoutes: ToolCapabilityRouteDecision[];
		}>();
		const release = vi.fn(async () => {});
		session.routeGovernorTaskTransition = async () => transition.promise;
		session.releaseGovernorTaskCapabilityRoutes = release;
		const workpool = pool(session, "pending-lease-owner");
		workpool.push(["inspect the browser trace"], ["browser"]);

		workpool.close();
		transition.resolve({
			snapshot: undefined,
			route: undefined,
			capabilityRoutes: [activeCapabilityRoute("browser")],
		});
		await Bun.sleep(0);

		expect(release).toHaveBeenCalledWith("workpool:pending-lease-owner");
	});

	it("releases the workpool owner when a pending route rejects during close", async () => {
		const session = makeSession();
		const transition = Promise.withResolvers<{
			snapshot: undefined;
			route: undefined;
		}>();
		const release = vi.fn(async () => {});
		session.routeGovernorTaskTransition = async () => transition.promise;
		session.releaseGovernorTaskCapabilityRoutes = release;
		const workpool = pool(session, "rejected-lease-owner");
		workpool.push(["inspect the debugger output"], ["debugger"]);

		workpool.close();
		transition.reject(new Error("route failed"));
		await Bun.sleep(0);

		expect(release).toHaveBeenCalledWith("workpool:rejected-lease-owner");
	});

	it("does not run Governor routing for empty workpool declarations", async () => {
		const session = makeSession();
		const transition = vi.fn();
		session.routeGovernorTaskTransition = transition;
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "empty-governor-facts");
		workpool.push(["inspect the route"], [], false);
		await finishPool(session, workpool);
		expect(transition).not.toHaveBeenCalled();
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("keeps workpool risk and capability requirements across later pushes", async () => {
		const session = makeSession();
		let routedFacts: unknown;
		const routeOwners: string[] = [];
		const plannedRisks: boolean[] = [];
		session.routeGovernorTaskTransition = async request => {
			routedFacts = request.facts;
			if (request.ownerId) routeOwners.push(request.ownerId);
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes: [activeCapabilityRoute("debugger")],
			};
		};
		session.routeGovernorTaskPlan = (_count, highRisk) => {
			plannedRisks.push(highRisk === true);
			return undefined;
		};
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "governor-risk");
		workpool.push(["inspect authentication"], ["debugger"], true);
		workpool.push(["add regression coverage"]);
		await finishPool(session, workpool);
		expect(routedFacts).toMatchObject({ highRisk: true, requiredCapabilities: ["debugger"] });
		expect(plannedRisks).toEqual([true, true]);
		expect(routeOwners).toEqual(["workpool:governor-risk"]);
	});

	it("does not start a high-risk workpool item when Governor planning throws", async () => {
		const session = makeSession();
		session.routeGovernorTaskTransition = async () => ({ snapshot: undefined, route: undefined });
		session.routeGovernorTaskPlan = () => {
			throw new Error("worker limits are unavailable");
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "governor-plan-error");
		workpool.push(["audit authentication changes"], undefined, true);
		await finishPool(session, workpool);
		expect(spawn).not.toHaveBeenCalled();
		expect(workpool.status().items).toMatchObject({ failed: 1, queued: 0, running: 0 });
	});

	it("does not start a high-risk workpool item when Governor transition throws", async () => {
		const session = makeSession();
		session.routeGovernorTaskTransition = async () => {
			throw new Error("risk ledger is unavailable");
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "governor-transition-error");
		workpool.push(["audit authentication changes"], undefined, true);
		await finishPool(session, workpool);
		expect(spawn).not.toHaveBeenCalled();
		expect(workpool.status().items).toMatchObject({ failed: 1, queued: 0, running: 0 });
	});

	it("does not start a high-risk workpool item when the session lacks Governor preflight", async () => {
		const session = makeSession();
		session.routeGovernorTaskTransition = undefined;
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "missing-governor-preflight");
		workpool.push(["audit authentication changes"], undefined, true);
		await finishPool(session, workpool);
		expect(spawn).not.toHaveBeenCalled();
		expect(workpool.status().items).toMatchObject({ failed: 1, queued: 0, running: 0 });
	});

	it("routes declared capabilities before starting a workpool worker", async () => {
		const session = makeSession();
		const route = Promise.withResolvers<void>();
		session.routeGovernorTaskTransition = async () => {
			await route.promise;
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes: [activeCapabilityRoute("browser")],
			};
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "capability-gate");
		workpool.push(["inspect the web app"], ["browser"]);
		await Bun.sleep(0);
		expect(spawn).not.toHaveBeenCalled();
		route.resolve();
		await finishPool(session, workpool);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("starts a workpool worker when its declared capability is already active", async () => {
		const session = makeSession();
		session.routeGovernorTaskTransition = async () => ({
			snapshot: undefined,
			route: undefined,
			capabilityRoutes: [
				{ ...activeCapabilityRoute("browser"), selected: false, reason: "eval tool is already active" },
			],
		});
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "already-active-capability");
		workpool.push(["inspect the page"], ["browser"]);
		await finishPool(session, workpool);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("waits for the latest capability transition after overlapping pushes", async () => {
		const session = makeSession([], 2, true);
		const firstRoute = Promise.withResolvers<void>();
		const secondRoute = Promise.withResolvers<void>();
		let routeCount = 0;
		session.routeGovernorTaskTransition = async request => {
			routeCount++;
			const count = routeCount;
			await (count === 1 ? firstRoute.promise : secondRoute.promise);
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes:
					count === 1
						? [activeCapabilityRoute("browser")]
						: (request.facts.requiredCapabilities ?? []).map(id =>
								activeCapabilityRoute(id === "browser" ? "browser" : "debugger"),
							),
			};
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "overlapping-capability-pushes");
		workpool.push(["inspect the page"], ["browser"]);
		workpool.push(["inspect debugger output"], ["debugger"]);
		await Bun.sleep(0);
		expect(routeCount).toBe(1);
		expect(spawn).not.toHaveBeenCalled();
		firstRoute.resolve();
		await Bun.sleep(0);
		expect(routeCount).toBe(2);
		expect(spawn).not.toHaveBeenCalled();
		secondRoute.resolve();
		await finishPool(session, workpool);
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(workpool.status().items).toMatchObject({ completed: 2, queued: 0, running: 0, failed: 0 });
	});

	it("clears a stale deferred flag after a later transition succeeds", async () => {
		const session = makeSession([], 2, true);
		let routeCount = 0;
		session.routeGovernorTaskTransition = async request => {
			routeCount++;
			if (routeCount === 1) return { snapshot: undefined, route: undefined, deferred: true };
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes: (request.facts.requiredCapabilities ?? []).map(id =>
					activeCapabilityRoute(id === "browser" ? "browser" : "debugger"),
				),
			};
		};
		session.waitForIdle = async () => {
			throw new Error("a successful latest transition must not wait for idle");
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "settled-capability-transition");
		workpool.push(["inspect the page"], ["browser"]);
		workpool.push(["inspect debugger output"], ["debugger"]);
		await finishPool(session, workpool);
		expect(routeCount).toBe(2);
		expect(spawn).toHaveBeenCalledTimes(2);
		expect(workpool.status().items.completed).toBe(2);
	});

	it("waits for a deferred capability transition before starting a workpool worker", async () => {
		const session = makeSession();
		const idle = Promise.withResolvers<void>();
		let waitingForIdle = false;
		let firstTransition = true;
		session.routeGovernorTaskTransition = async () => {
			if (firstTransition) {
				firstTransition = false;
				return { snapshot: undefined, route: undefined, deferred: true };
			}
			return {
				snapshot: undefined,
				route: undefined,
				capabilityRoutes: [activeCapabilityRoute("browser")],
			};
		};
		session.waitForIdle = async () => {
			waitingForIdle = true;
			await idle.promise;
		};
		const spawn = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "deferred-capability-gate");
		workpool.push(["inspect the page"], ["browser"]);
		await Bun.sleep(0);
		expect(waitingForIdle).toBe(true);
		expect(spawn).not.toHaveBeenCalled();
		idle.resolve();
		await finishPool(session, workpool);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("close cancels a workpool dispatch waiting for session idle", async () => {
		const session = makeSession();
		const idle = Promise.withResolvers<void>();
		session.routeGovernorTaskTransition = async () => ({ snapshot: undefined, route: undefined, deferred: true });
		session.waitForIdle = async () => idle.promise;
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "cancel-idle-route");
		workpool.push(["inspect the page"], ["browser"]);
		await Bun.sleep(0);
		const closed = workpool.close();
		await finishPool(session, workpool);
		expect(closed.dropped).toHaveLength(1);
		expect(workpool.status().items).toMatchObject({ cancelled: 1, queued: 0, running: 0 });
		expect(spawn).not.toHaveBeenCalled();
	});

	it("close cancels a workpool dispatch waiting for capability routing", async () => {
		const session = makeSession();
		const route = Promise.withResolvers<{
			snapshot: undefined;
			route: undefined;
			deferred: true;
		}>();
		session.routeGovernorTaskTransition = async () => route.promise;
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "cancel-pending-route");
		workpool.push(["inspect the page"], ["browser"]);
		await Bun.sleep(0);
		const closed = workpool.close();
		await finishPool(session, workpool);
		expect(closed.dropped).toHaveLength(1);
		expect(workpool.status().items).toMatchObject({ cancelled: 1, queued: 0, running: 0 });
		expect(spawn).not.toHaveBeenCalled();
	});

	it("does not start a workpool worker when a required capability is unavailable", async () => {
		const session = makeSession();
		session.routeGovernorTaskTransition = async () => ({
			snapshot: undefined,
			route: undefined,
			capabilityRoutes: [
				{
					...activeCapabilityRoute("browser"),
					state: "unavailable",
					selected: false,
					reason: "browser runtime is unavailable",
				},
			],
		});
		const spawn = vi.spyOn(structured, "runStructuredSubagent");
		const workpool = pool(session, "unavailable-capability");
		workpool.push(["inspect the page"], ["browser"]);
		await finishPool(session, workpool);
		expect(spawn).not.toHaveBeenCalled();
		expect(workpool.status().items.failed).toBe(1);
	});

	it("hands a queued batch to a follow-up turn after the first turn settles", async () => {
		const session = makeSession([], 1);
		const first = Promise.withResolvers<void>();
		const follow = Promise.withResolvers<void>();
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			await first.promise;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const followSpy = vi.spyOn(executor, "runSubagentFollowUpTurn").mockImplementation(async options => {
			await follow.promise;
			markIdle(options.id);
			return singleResult(options.id, "second batch");
		});
		const workpool = pool(session, "handoff");
		workpool.push(["first", "second"]);
		await until(() => workpool.agents[0]?.queue.length === 1);
		first.resolve();
		await until(() => followSpy.mock.calls.length === 1);
		expect(workpool.batches.map(batch => batch.items.map(item => item.id))).toEqual([["handoff#1"], ["handoff#2"]]);
		expect(followSpy.mock.calls[0]?.[0].workPoolYieldItems).toEqual([{ id: "handoff#2", index: 1 }]);
		expect(followSpy.mock.calls[0]?.[0].message).toContain("After EACH item");
		expect(followSpy.mock.calls[0]?.[0].message).not.toContain("todo");
		follow.resolve();
		await finishPool(session, workpool);
	});
	it("tombstones the worker session when clearing the yield contract fails", async () => {
		const session = makeSession([], 1);
		let workerId = "";
		let disposed = false;
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			workerId = request.identity?.id ?? "missing";
			// Retained worker whose prompt rebuild throws after the runtime
			// contract already flipped: pool-local drop alone would leave it
			// messageable with a stale keyed declaration.
			AgentRegistry.global().register({
				id: workerId,
				displayName: workerId,
				kind: "sub",
				status: "idle",
				session: {
					setWorkPoolYieldItems: async () => {
						throw new Error("prompt rebuild boom");
					},
					dispose: async () => {
						disposed = true;
					},
				} as unknown as AgentSession,
			});
			return execution(workerId);
		});
		const workpool = pool(session, "poison");
		workpool.push(["one"]);
		await finishPool(session, workpool);
		// The successful turn result survives the cleanup failure, but the
		// poisoned worker is gone locally and left terminal in the registry: a
		// later persisted-agent scan must not resurrect it as parked.
		expect(workpool.batches[0]?.status).toBe("completed");
		expect(workpool.agents.length).toBe(0);
		expect(disposed).toBe(true);
		expect(AgentRegistry.global().get(workerId)?.status).toBe("aborted");
		expect(AgentRegistry.global().get(workerId)?.session).toBeNull();
	});

	it("requeues a dead agent's queued items onto another worker", async () => {
		const session = makeSession([], 2);
		const gates = new Map<string, PromiseWithResolvers<void>>();
		let firstId = "";
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			firstId ||= id;
			const gate = Promise.withResolvers<void>();
			gates.set(id, gate);
			await gate.promise;
			if (id !== firstId) markIdle(id);
			return execution(id);
		});
		vi.spyOn(executor, "runSubagentFollowUpTurn").mockImplementation(async options => {
			markIdle(options.id);
			return singleResult(options.id);
		});
		const workpool = pool(session, "requeue");
		workpool.push(["one", "two", "three"]);
		await until(() => workpool.agents.length === 2 && workpool.items[2]?.agentId === firstId);
		gates.get(firstId)?.resolve();
		await until(() => workpool.items[2]?.agentId !== firstId && workpool.items[2]?.status === "running");
		expect(workpool.agents.some(agent => agent.id === firstId)).toBe(false);
		for (const [id, gate] of gates) {
			if (id !== firstId) gate.resolve();
		}
		await finishPool(session, workpool);
	});

	it("uses the pool name as the aggregate job id and label", async () => {
		const session = makeSession([], 1);
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const manager = session.asyncJobManager!;
		const consume = vi.spyOn(manager, "consumeJobResults");
		const workpool = pool(session, "waiter");
		workpool.push(["one"]);
		const poolJob = manager.getJob("waiter");
		expect(poolJob?.id).toBe("waiter");
		expect(poolJob?.label).toBe("waiter");
		const polled = await new WaitTool(session).execute("wait-workpool", {});
		const details = polled.details;
		if (!details?.jobs) throw new Error("Expected a background-job wait result");
		expect(details.jobs?.map(job => job.id)).toEqual(["waiter"]);
		expect(details.jobs?.map(job => job.status)).toEqual(["completed"]);
		expect(workpool.peek().pending).toBe(0);
		expect(workpool.peek().batches).toHaveLength(1);
		expect(consume).toHaveBeenCalledWith([workpool.batches[0]!.jobId]);
	});

	it("auto-delivers one aggregate completion under the pool id", async () => {
		const deliveries: Array<{ id: string; text: string }> = [];
		const cards: CustomMessage[] = [];
		const session = makeSession(cards, 1, false, deliveries);
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "aggregate");
		workpool.push(["one"]);
		await finishPool(session, workpool);
		await session.asyncJobManager?.drainDeliveries({ filter: { ownerId: "Main" } });

		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]?.id).toBe("aggregate");
		expect(deliveries[0]?.text).toContain("Pool `aggregate`");
		expect(cards.map(cardMode)).toContain("completed");
	});

	it("reports failed batches on a drained aggregate job", async () => {
		const cards: CustomMessage[] = [];
		const session = makeSession(cards, 1, false, undefined, 5_000);
		const manager = session.asyncJobManager!;
		let delivered: { status: string; failedBatches: unknown; text: string } | undefined;
		manager.registerDeliverySink("Main", (_id, text, job) => {
			if (job) delivered = { status: job.status, failedBatches: job.latestDetails?.workpoolFailedBatches, text };
		});
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			const outcome = execution(id);
			return { ...outcome, result: { ...outcome.result, exitCode: 1, error: "Worker failed" } };
		});
		const workpool = pool(session, "failed-pool");
		workpool.push(["one"]);
		await finishPool(session, workpool);
		expect(manager.getJob(workpool.name)?.status).toBe("failed");
		await manager.drainDeliveries({ filter: { ownerId: "Main" } });
		expect(delivered).toMatchObject({ status: "failed", failedBatches: 1 });
		expect(delivered?.text).toContain("drained with 1 failed item(s)");
		expect(cards.map(cardMode)).toContain("failed");
		expect(workpool.status().items.failed).toBe(1);
	});

	it("sends new work to the least context-loaded idle agent", async () => {
		const session = makeSession([], 3);
		const gates = new Map<string, PromiseWithResolvers<void>>();
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const id = request.identity?.id ?? "missing";
			const gate = Promise.withResolvers<void>();
			gates.set(id, gate);
			request.onProgress?.({
				index: 0,
				id,
				agent: "scout",
				agentSource: "bundled",
				status: "running",
				task: request.assignment,
				recentTools: [],
				recentOutput: [],
				toolCount: 0,
				requests: 1,
				tokens: 1,
				contextTokens: id.endsWith("-1") ? 80 : id.endsWith("-2") ? 20 : 50,
				contextWindow: 100,
				cost: 0,
				durationMs: 1,
			});
			await gate.promise;
			markIdle(id);
			return execution(id);
		});
		vi.spyOn(executor, "runSubagentFollowUpTurn").mockImplementation(async options => {
			markIdle(options.id);
			return singleResult(options.id);
		});
		const workpool = pool(session, "loaded");
		workpool.push(["one", "two", "three"]);
		await until(() => workpool.agents.length === 3);
		gates.get("loaded-1")?.resolve();
		gates.get("loaded-2")?.resolve();
		await until(() => workpool.agents.filter(agent => agent.state === "idle").length === 2);
		workpool.push(["four"]);
		await until(() => workpool.items[3]?.status !== "queued");
		expect(workpool.items[3]?.agentId).toBe("loaded-2");
		gates.get("loaded-3")?.resolve();
		await finishPool(session, workpool);
	});

	it("spawns a fresh agent per item when eval.workpool.freshAgents is enabled", async () => {
		const session = makeSession([], 1, true);
		const gates: Array<PromiseWithResolvers<void>> = [];
		const runSpy = vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			const gate = Promise.withResolvers<void>();
			gates.push(gate);
			await gate.promise;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const followSpy = vi.spyOn(executor, "runSubagentFollowUpTurn");
		const workpool = pool(session, "fresh");
		workpool.push(["one", "two"]);
		await until(() => gates.length === 1);
		gates[0]?.resolve();
		await until(() => gates.length === 2);
		gates[1]?.resolve();
		await finishPool(session, workpool);

		expect(runSpy).toHaveBeenCalledTimes(2);
		expect(followSpy).not.toHaveBeenCalled();
		expect(workpool.batches.map(batch => batch.agentId)).toEqual(["fresh-1", "fresh-2"]);
		expect(workpool.batches.every(batch => batch.items.length === 1)).toBe(true);
		expect(workpool.status().freshAgents).toBe(true);
	});

	it("close drops queued items but lets the in-flight turn finish", async () => {
		const cards: CustomMessage[] = [];
		const deliveries: Array<{ id: string; text: string }> = [];
		const session = makeSession(cards, 1, false, deliveries);
		const first = Promise.withResolvers<void>();
		vi.spyOn(structured, "runStructuredSubagent").mockImplementation(async request => {
			await first.promise;
			const id = request.identity?.id ?? "missing";
			markIdle(id);
			return execution(id);
		});
		const workpool = pool(session, "closing");
		workpool.push(["running", "queued"]);
		await until(() => workpool.items[0]?.status === "running" && workpool.items[1]?.status === "queued");
		expect(workpool.close()).toEqual({ dropped: ["closing#2"] });
		expect(workpool.items[1]?.status).toBe("cancelled");
		first.resolve();
		await finishPool(session, workpool);
		await session.asyncJobManager?.drainDeliveries({ filter: { ownerId: "Main" } });
		expect(workpool.peek().pending).toBe(0);
		expect(deliveries[0]?.text).toContain("drained with 1 cancelled item(s)");
		expect(cards.map(cardMode)).toContain("cancelled");
	});
});
