import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { fileSnapshot, readRunTelemetry, runSystem } from "../bench/task-outcome-ab";
import type { PacketManifest, RunSummary } from "../bench/task-outcome-ab";

function assistant(tool: string, input: number, cost: number): object {
	return {
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", name: tool }],
			usage: { input, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: input + 9, cost: { total: cost } },
		},
	};
}

it("counts persisted worker and auxiliary requests once without repeating task summary usage", async () => {
	using dir = TempDir.createSync("@benchmark-telemetry-");
	await Bun.write(
		dir.join("root.jsonl"),
		[
			assistant("task", 10, 0.1),
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "task",
					details: { results: [{ usage: { input: 20, cost: { total: 0.2 } } }] },
				},
			},
			{ type: "model_usage", usage: { input: 1, output: 1, totalTokens: 2, cost: { total: 0.01 } } },
		]
			.map(entry => JSON.stringify(entry))
			.join("\n"),
	);
	await Bun.write(dir.join("root/worker.jsonl"), JSON.stringify(assistant("edit", 20, 0.2)));
	const result = await readRunTelemetry(dir.path());
	expect(result).toMatchObject({
		toolCalls: expect.arrayContaining(["task", "edit"]),
		assistantTurns: 2,
		inputTokens: 31,
		outputTokens: 5,
		cacheReadTokens: 6,
		cacheWriteTokens: 8,
		totalTokens: 50,
	});
	expect(result.costUsd).toBeCloseTo(0.31);
});

it("starts reruns from the packet even when a prior workspace has extra files", async () => {
	using dir = TempDir.createSync("@benchmark-rerun-");
	const packet = dir.join("packet");
	const out = dir.join("out");
	await fs.mkdir(out);
	await Bun.write(path.join(packet, "task.md"), "Fixture assignment");
	await Bun.write(path.join(packet, "result.txt"), "before");
	const cli = dir.join("cli.ts");
	await Bun.write(
		cli,
		`
import * as fs from "node:fs/promises";
const args = process.argv;
const sessions = args[args.indexOf("--session-dir") + 1];
if (!(await fs.stat(sessions)).isDirectory()) process.exit(10);
if (await Bun.file("extra.txt").exists()) process.exit(9);
await Bun.write("result.txt", "after");
await Bun.write(sessions + "/root.jsonl", JSON.stringify(${JSON.stringify(assistant("edit", 10, 0.1))}));
`,
	);
	const manifest: PacketManifest = {
		id: "fixture",
		category: "edit",
		sourceCommit: "fixture",
		taskFile: "task.md",
		acceptanceCommand: [process.execPath, "-e", "process.exit(0)"],
		expectedChangedFiles: ["result.txt"],
		repeatCount: 1,
		notes: "fixture",
	};
	const files = await fileSnapshot(packet);
	const first = await runSystem("piforge", cli, "fixture", packet, manifest, out, 1, files);
	await Bun.write(path.join(first.workspacePath, "extra.txt"), "stale");
	const second = await runSystem("piforge", cli, "fixture", packet, manifest, out, 1, files);
	expect(first.passed).toBe(true);
	expect(second.passed).toBe(true);
	expect(second.workspacePath).not.toBe(first.workspacePath);
	expect(second.transcriptPath).not.toBe(first.transcriptPath);
	expect(second.changedFiles).toEqual(["result.txt"]);
});

it("benchmarks a pinned repository worktree and records its patch before cleanup", async () => {
	using dir = TempDir.createSync("@benchmark-worktree-");
	const packet = dir.join("packet");
	const out = dir.join("out");
	await fs.mkdir(out);
	await Bun.write(path.join(packet, "task.md"), "Make a harmless README change");
	const repositoryPath = path.resolve(import.meta.dir, "../../..");
	const repository = vcs.requireGit(repositoryPath);
	const sourceCommit = await repository.resolveRef("HEAD");
	if (!sourceCommit) throw new Error("Expected HEAD in the current repository");
	const targetPath = "packages/coding-agent/src/tools/bash.ts";
	const originalSource = await Bun.file(path.join(repositoryPath, targetPath)).text();
	const cli = dir.join("cli.ts");
	await Bun.write(
		cli,
		`
const args = process.argv;
const sessions = args[args.indexOf("--session-dir") + 1];
const runDir = args[args.indexOf("--cwd") + 1];
await Bun.write(
		runDir + "/packages/coding-agent/src/tools/bash.ts",
		(await Bun.file(runDir + "/packages/coding-agent/src/tools/bash.ts").text()) + "\\n// Benchmark worktree contract\\n",
		);
await Bun.write(sessions + "/root.jsonl", JSON.stringify(${JSON.stringify(assistant("edit", 10, 0.1))}));
`,
	);
	const manifest: PacketManifest = {
		id: "repository-worktree",
		category: "harness contract",
		sourceCommit,
		taskFile: "task.md",
		acceptanceCommand: [
			process.execPath,
			"-e",
			'import { type } from "@oh-my-pi/omptype"; import { getBundledModel } from "@oh-my-pi/pi-catalog/models"; if (typeof type.raw !== "function" || !getBundledModel) process.exit(1)',
		],
		expectedChangedFiles: [],
		allowedChangedFiles: ["packages/coding-agent/src/tools/bash.ts", "package.json"],
		repeatCount: 1,
		notes: "The recorded diff includes the worktree change and removes the temporary checkout.",
		supportFiles: { "task.md": "task.md" },
	};
	let result: RunSummary;
	try {
		result = await runSystem("piforge", cli, "fixture", packet, manifest, out, 1, new Map(), repositoryPath);
	} catch (error) {
		const [artifact] = await fs.readdir(out);
		const transcript = artifact ? await Bun.file(path.join(out, artifact, "transcript.jsonl")).text() : "";
		throw new Error(`${String(error)}\n${transcript}`);
	}
	const patchPath = path.join(path.dirname(result.transcriptPath), "final.diff");
	const patch = await Bun.file(patchPath).text();
	expect(result.passed).toBe(true);
	expect(result.changedFiles).toEqual(["packages/coding-agent/src/tools/bash.ts"]);
	expect(patch).toContain("Benchmark worktree contract");
	expect(await Bun.file(result.workspacePath).exists()).toBe(false);
	expect(await Bun.file(path.join(repositoryPath, targetPath)).text()).toBe(originalSource);
}, 15_000);

it("applies an adaptive-mode overlay and stops the run at its cumulative token cap", async () => {
	using dir = TempDir.createSync("@benchmark-budget-");
	const packet = dir.join("packet");
	const out = dir.join("out");
	await fs.mkdir(out);
	await Bun.write(path.join(packet, "task.md"), "Use the supplied setting and stay idle.");
	const cli = dir.join("cli.ts");
	await Bun.write(
		cli,
		`
import * as fs from "node:fs/promises";
const args = process.argv;
const sessions = args[args.indexOf("--session-dir") + 1];
const cwd = args[args.indexOf("--cwd") + 1];
if ((await Bun.file(cwd + "/.omp/config.yml").text()) !== "adaptive:\\n  mode: auto\\n") process.exit(11);
console.log(JSON.stringify({ type: "benchmark-progress" }));
if (!(await Bun.file(cwd + "/../transcript.jsonl").text()).includes("benchmark-progress")) process.exit(12);
		await Bun.write(
			sessions + "/root.jsonl",
			[
				${JSON.stringify(assistant("read", 100, 0.1))},
				{ type: "custom", customType: "adaptive-governor-decision", data: { trigger: "scope", decision: { band: "complex", workerCount: 2, verificationFloor: "V2" } } },
			].map(JSON.stringify).join("\\n") + "\\n",
		);
await Bun.sleep(10_000);
`,
	);
	const manifest: PacketManifest = {
		id: "budget-overlay",
		category: "harness contract",
		sourceCommit: "fixture",
		taskFile: "task.md",
		acceptanceCommand: [process.execPath, "-e", "process.exit(0)"],
		expectedChangedFiles: [],
		repeatCount: 1,
		notes: "A provider run stops after the persisted usage crosses the cap.",
	};
	const result = await runSystem(
		"piforge",
		cli,
		"fixture",
		packet,
		manifest,
		out,
		1,
		await fileSnapshot(packet),
		undefined,
		"auto",
		{
			maxTimeMs: 5_000,
			maxTotalTokens: 50,
		},
	);
	expect(result.budgetStopReason).toBe("token_cap");
	expect(result.adaptiveMode).toBe("auto");
	expect(result.totalTokens).toBeGreaterThan(50);
	expect(result.exitCode).not.toBe(0);
	expect(result.governorDecisions).toEqual([
		{ trigger: "scope", band: "complex", workerCount: 2, verificationFloor: "V2" },
	]);
});

it("honors a medium effort override and lets an unbounded run finish without a CLI time limit", async () => {
	using dir = TempDir.createSync("@benchmark-unbounded-");
	const packet = dir.join("packet");
	const out = dir.join("out");
	await fs.mkdir(out);
	await Bun.write(path.join(packet, "task.md"), "Finish the local task.");
	const cli = dir.join("cli.ts");
	await Bun.write(
		cli,
		`
const args = process.argv;
if (args.includes("--max-time")) process.exit(12);
if (args[args.indexOf("--thinking") + 1] !== "medium") process.exit(13);
if (args[args.indexOf("--model") + 1] !== "openai-codex/gpt-6-luna") process.exit(14);
const sessions = args[args.indexOf("--session-dir") + 1];
await Bun.write(sessions + "/root.jsonl", JSON.stringify(${JSON.stringify(assistant("read", 100, 0))}));
await Bun.sleep(50);
`,
	);
	const manifest: PacketManifest = {
		id: "unbounded-run",
		category: "harness contract",
		sourceCommit: "fixture",
		taskFile: "task.md",
		acceptanceCommand: [process.execPath, "-e", "process.exit(0)"],
		expectedChangedFiles: [],
		repeatCount: 1,
		notes: "An unbounded run waits for its process to finish.",
	};
	const result = await runSystem(
		"piforge",
		cli,
		"openai-codex/gpt-6-luna",
		packet,
		manifest,
		out,
		1,
		await fileSnapshot(packet),
		undefined,
		"off",
		null,
		"medium",
	);
	expect(result.passed).toBe(true);
	expect(result.budgetStopReason).toBeNull();
	expect(result.totalTokens).toBeGreaterThan(0);
	expect(result.model).toBe("openai-codex/gpt-6-luna");
	expect(result.thinkingLevel).toBe("medium");
});

it("defaults the benchmark CLI to one Luna Low run with no token or time cutoff", async () => {
	using dir = TempDir.createSync("@benchmark-defaults-");
	const packet = dir.join("packet");
	const out = dir.join("out");
	await Bun.write(path.join(packet, "TASK.md"), "Fixture assignment");
	await Bun.write(path.join(packet, "benchmark.yml"), "task:\n  maxEffort: low\n");
	const manifest: PacketManifest = {
		id: "default-settings",
		category: "harness contract",
		sourceCommit: "fixture",
		taskFile: "TASK.md",
		configFile: "benchmark.yml",
		acceptanceCommand: [process.execPath, "-e", "process.exit(0)"],
		expectedChangedFiles: [],
		repeatCount: 3,
		notes: "Run counts and effort must not silently increase benchmark consumption.",
	};
	await Bun.write(path.join(packet, "manifest.json"), JSON.stringify(manifest));
	const cli = dir.join("cli.ts");
	await Bun.write(
		cli,
		`
const args = process.argv;
if (args.includes("--max-time")) process.exit(12);
if (args[args.indexOf("--thinking") + 1] !== "low") process.exit(13);
if (args[args.indexOf("--model") + 1] !== "openai-codex/gpt-6-luna") process.exit(14);
const configIndex = args.indexOf("--config");
if (configIndex === -1 || (await Bun.file(args[configIndex + 1]).text()) !== "task:\\n  maxEffort: low\\n") process.exit(15);
const sessions = args[args.indexOf("--session-dir") + 1];
await Bun.write(sessions + "/root.jsonl", JSON.stringify(${JSON.stringify(assistant("read", 10, 0))}));
`,
	);
	const child = Bun.spawn(
		[
			process.execPath,
			path.resolve(import.meta.dir, "../bench/task-outcome-ab.ts"),
			"--packet",
			packet,
			"--out",
			out,
			"--omp-cli",
			cli,
			"--piforge-cli",
			cli,
			"--system",
			"piforge",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`Benchmark CLI failed: ${stdout}\n${stderr}`);
	const report = await Bun.file(path.join(out, "summary.json")).json();
	expect(report.conditions).toMatchObject({ budget: null, thinkingLevel: "low", repeatCount: 1 });
	expect(report.runs).toHaveLength(1);
	expect(report.runs[0]).toMatchObject({
		model: "openai-codex/gpt-6-luna",
		thinkingLevel: "low",
		passed: true,
		budgetStopReason: null,
	});
});
