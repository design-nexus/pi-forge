import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "@oh-my-pi/pi-utils";

interface PacketManifest {
	id: string;
	category: string;
	sourceCommit: string;
	taskFile: string;
	acceptanceCommand: string[];
	expectedChangedFiles: string[];
	repeatCount: number;
	notes: string;
}

interface RunSummary {
	system: "omp" | "piforge";
	cliPath: string;
	model: string;
	exitCode: number;
	testExitCode: number;
	passed: boolean;
	changedFiles: string[];
	filesWithinScope: boolean;
	toolCalls: string[];
	assistantTurns: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costUsd: number;
	wallTimeMs: number;
	humanInterventions: number;
	transcriptPath: string;
	testOutput: string;
}

function parseArgs(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index++) {
		const key = args[index];
		if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key ?? ""}`);
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
		values.set(key, value);
		index++;
	}
	return values;
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (!value) throw new Error(`Missing required option ${key}`);
	return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseTranscript(
	transcript: string,
): Pick<
	RunSummary,
	| "toolCalls"
	| "assistantTurns"
	| "inputTokens"
	| "outputTokens"
	| "cacheReadTokens"
	| "cacheWriteTokens"
	| "totalTokens"
	| "costUsd"
> {
	const toolCalls: string[] = [];
	const totals = {
		assistantTurns: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costUsd: 0,
	};
	for (const line of transcript.split("\n")) {
		if (!line) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message)) continue;
		const message = event.message;
		if (message.role !== "assistant") continue;
		totals.assistantTurns++;
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (isRecord(part) && part.type === "toolCall" && typeof part.name === "string") toolCalls.push(part.name);
			}
		}
		if (!isRecord(message.usage)) continue;
		const usage = message.usage;
		totals.inputTokens += numberField(usage, "input");
		totals.outputTokens += numberField(usage, "output");
		totals.cacheReadTokens += numberField(usage, "cacheRead");
		totals.cacheWriteTokens += numberField(usage, "cacheWrite");
		totals.totalTokens += numberField(usage, "totalTokens") || numberField(usage, "total");
		if (isRecord(usage.cost)) totals.costUsd += numberField(usage.cost, "total");
	}
	return { toolCalls, ...totals };
}

async function runCommand(
	command: string[],
	cwd: string,
): Promise<{ exitCode: number; output: string; durationMs: number }> {
	const startedAt = performance.now();
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return {
		exitCode,
		output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
		durationMs: performance.now() - startedAt,
	};
}

async function fileSnapshot(root: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	const glob = new Bun.Glob("**/*");
	for await (const relative of glob.scan({ cwd: root, onlyFiles: true, dot: true })) {
		if (relative.startsWith("node_modules/")) continue;
		files.set(relative, await Bun.file(path.join(root, relative)).text());
	}
	return files;
}

async function runSystem(
	system: RunSummary["system"],
	cliPath: string,
	model: string,
	packetDir: string,
	manifest: PacketManifest,
	outputDir: string,
	repeat: number,
	packetFiles: Map<string, string>,
): Promise<RunSummary> {
	const runDir = path.join(outputDir, `${system}-${repeat}`);
	await fs.mkdir(runDir, { recursive: true });
	await fs.cp(packetDir, runDir, { recursive: true, force: true });
	const prompt = `@${manifest.taskFile}`;
	const startedAt = performance.now();
	const { exitCode, output: transcript } = await runCommand(
		[
			process.execPath,
			path.resolve(cliPath),
			"--print",
			"--mode",
			"json",
			"--auto-approve",
			"--model",
			model,
			"--cwd",
			runDir,
			"--no-session",
			"--max-time",
			"10m",
			prompt,
		],
		runDir,
	);
	const wallTimeMs = performance.now() - startedAt;
	const transcriptPath = path.join(outputDir, `${system}-${repeat}.jsonl`);
	await Bun.write(transcriptPath, transcript);
	const telemetry = parseTranscript(transcript);
	const test = await runCommand(manifest.acceptanceCommand, runDir);
	const runFiles = await fileSnapshot(runDir);
	const changed = [...new Set([...packetFiles.keys(), ...runFiles.keys()])].filter(
		relative => packetFiles.get(relative) !== runFiles.get(relative),
	);
	const expectedChanges = new Set(manifest.expectedChangedFiles);
	const changedOutsideScope = changed.filter(relative => !expectedChanges.has(relative));
	return {
		system,
		cliPath: path.resolve(cliPath),
		model,
		exitCode,
		testExitCode: test.exitCode,
		passed:
			exitCode === 0 &&
			test.exitCode === 0 &&
			changed.length === manifest.expectedChangedFiles.length &&
			changedOutsideScope.length === 0,
		changedFiles: changed,
		filesWithinScope: changedOutsideScope.length === 0,
		...telemetry,
		wallTimeMs,
		humanInterventions: 0,
		transcriptPath,
		testOutput: test.output,
	};
}

const args = parseArgs(process.argv.slice(2));
const packetDir = path.resolve(
	args.get("--packet") ?? path.join(import.meta.dir, "fixtures/prompt-profile-retry-delay-v1"),
);
const outputDir = path.resolve(required(args, "--out"));
const ompCli = required(args, "--omp-cli");
const piforgeCli = required(args, "--piforge-cli");
const ompRevision = args.get("--omp-revision");
const piforgeRevision = args.get("--piforge-revision");
const model = args.get("--model") ?? "openai-codex/gpt-5.5";
const manifest = (await Bun.file(path.join(packetDir, "manifest.json")).json()) as PacketManifest;
const taskText = await Bun.file(path.join(packetDir, manifest.taskFile)).text();
if (!taskText.trim() || manifest.repeatCount < 1)
	throw new Error("The benchmark packet is missing a task or repeat count.");
await fs.mkdir(outputDir, { recursive: true });
const packetFiles = await fileSnapshot(packetDir);
const runs: RunSummary[] = [];
for (let repeat = 1; repeat <= manifest.repeatCount; repeat++) {
	const systems =
		repeat % 2 === 1
			? ([
					["omp", ompCli],
					["piforge", piforgeCli],
				] as const)
			: ([
					["piforge", piforgeCli],
					["omp", ompCli],
				] as const);
	for (const [system, cliPath] of systems) {
		runs.push(await runSystem(system, cliPath, model, packetDir, manifest, outputDir, repeat, packetFiles));
	}
}
const report = {
	packet: manifest,
	model,
	createdAt: new Date().toISOString(),
	conditions: { autoApprove: true, sessionPersistence: false, taskPrompt: manifest.taskFile },
	sources: {
		omp: { cliPath: path.resolve(ompCli), revision: ompRevision ?? null },
		piforge: { cliPath: path.resolve(piforgeCli), revision: piforgeRevision ?? null },
	},
	runs,
};
await Bun.write(path.join(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
