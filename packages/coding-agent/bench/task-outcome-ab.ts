import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "@oh-my-pi/pi-utils";
import { CLI_THINKING_LEVELS } from "@oh-my-pi/pi-tui/thinking";
import * as vcs from "@oh-my-pi/pi-natives/vcs";

export interface PacketManifest {
	id: string;
	category: string;
	sourceCommit: string;
	taskFile: string;
	acceptanceCommand: string[];
	expectedChangedFiles: string[];
	repeatCount: number;
	notes: string;
	/** Optional path allowlist for tasks whose correct implementation touches a variable subset. */
	allowedChangedFiles?: string[];
	/** Repository-relative destination to source-file overlays used as benchmark support files. */
	supportFiles?: Record<string, string>;
	/** Frozen settings overlay copied with the packet, applied to the benchmark CLI. */
	configFile?: string;
	/** Require a completed, host-accepted integration gate snapshot in the parent session. */
	requiredIntegrationGate?: { status: "verified" | "reconciled"; minimumRepairAttempts?: number };
}

export interface RunSummary {
	system: "omp" | "piforge";
	cliPath: string;
	model: string;
	thinkingLevel: string;
	exitCode: number;
	testExitCode: number;
	passed: boolean;
	orchestrationPassed: boolean;
	orchestrationFailure: string | null;
	budgetStopReason: "token_cap" | "time_cap" | null;
	adaptiveMode: "off" | "auto" | null;
	governorDecisions: Array<{
		trigger: string;
		band: string;
		workerCount: number;
		verificationFloor?: string;
	}>;
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
	sessionDirectory: string;
	workspacePath: string;
	testOutput: string;
}

export interface RunBudget {
	maxTimeMs: number;
	maxTotalTokens: number;
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

export function parseTranscript(
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
		if (!isRecord(event)) continue;
		const auxiliary = event.type === "model_usage";
		const message = auxiliary ? event : event.message;
		if (!isRecord(message)) continue;
		if (!auxiliary && ((event.type !== "message_end" && event.type !== "message") || message.role !== "assistant"))
			continue;
		if (!auxiliary) totals.assistantTurns++;
		if (!auxiliary && Array.isArray(message.content)) {
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

async function runBudgetedCommand(
	command: string[],
	cwd: string,
	sessionDirectory: string,
	budget: RunBudget | null,
	transcriptPath: string,
): Promise<{ exitCode: number; output: string; durationMs: number; stopReason: RunSummary["budgetStopReason"] }> {
	const startedAt = performance.now();
	const child = Bun.spawn(command, { cwd, stdout: Bun.file(transcriptPath), stderr: "pipe" });
	const stderrPromise = new Response(child.stderr).text();
	let stopReason: RunSummary["budgetStopReason"] = null;
	if (budget) {
		while (child.exitCode === null) {
			const elapsedMs = performance.now() - startedAt;
			if (elapsedMs >= budget.maxTimeMs) {
				stopReason = "time_cap";
				child.kill();
				break;
			}
			if ((await readTokenUsage(sessionDirectory)) >= budget.maxTotalTokens) {
				stopReason = "token_cap";
				child.kill();
				break;
			}
			await Bun.sleep(Math.min(500, Math.max(1, budget.maxTimeMs - elapsedMs)));
		}
	}
	const [stderr, exitCode] = await Promise.all([stderrPromise, child.exited]);
	const stdout = await Bun.file(transcriptPath).text();
	return {
		exitCode,
		output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
		durationMs: performance.now() - startedAt,
		stopReason,
	};
}

async function readTokenUsage(sessionDirectory: string): Promise<number> {
	let totalTokens = 0;
	const glob = new Bun.Glob("**/*.jsonl");
	for await (const relative of glob.scan({ cwd: sessionDirectory, onlyFiles: true })) {
		totalTokens += parseTranscript(await Bun.file(path.join(sessionDirectory, relative)).text()).totalTokens;
	}
	return totalTokens;
}

async function readGovernorDecisions(sessionDirectory: string): Promise<RunSummary["governorDecisions"]> {
	const decisions: RunSummary["governorDecisions"] = [];
	const glob = new Bun.Glob("**/*.jsonl");
	for await (const relative of glob.scan({ cwd: sessionDirectory, onlyFiles: true })) {
		const transcript = await Bun.file(path.join(sessionDirectory, relative)).text();
		for (const line of transcript.split("\n")) {
			if (!line) continue;
			let event: unknown;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isRecord(event) || event.type !== "custom" || event.customType !== "adaptive-governor-decision") continue;
			const data = event.data;
			if (!isRecord(data) || !isRecord(data.decision)) continue;
			const decision = data.decision;
			if (
				typeof data.trigger !== "string" ||
				typeof decision.band !== "string" ||
				typeof decision.workerCount !== "number"
			)
				continue;
			decisions.push({
				trigger: data.trigger,
				band: decision.band,
				workerCount: decision.workerCount,
				...(typeof decision.verificationFloor === "string"
					? { verificationFloor: decision.verificationFloor }
					: {}),
			});
		}
	}
	return decisions;
}

export async function fileSnapshot(root: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	const glob = new Bun.Glob("**/*");
	for await (const relative of glob.scan({ cwd: root, onlyFiles: true, dot: true })) {
		if (relative.startsWith("node_modules/")) continue;
		files.set(relative, await Bun.file(path.join(root, relative)).text());
	}
	return files;
}

async function linkRepositoryDependencies(repositoryPath: string, runDir: string): Promise<void> {
	const sourceNodeModules = path.join(repositoryPath, "node_modules");
	const targetNodeModules = path.join(runDir, "node_modules");
	await fs.mkdir(targetNodeModules, { recursive: true });
	const sourceEntries = await fs.readdir(sourceNodeModules, { withFileTypes: true });
	for (const entry of sourceEntries) {
		const source = path.join(sourceNodeModules, entry.name);
		const target = path.join(targetNodeModules, entry.name);
		if (entry.name === "@oh-my-pi") {
			await fs.mkdir(target, { recursive: true });
			for (const packageDir of await fs.readdir(path.join(runDir, "packages"), { withFileTypes: true })) {
				if (!packageDir.isDirectory()) continue;
				const packagePath = path.join(runDir, "packages", packageDir.name);
				let packageName: unknown;
				try {
					packageName = (await Bun.file(path.join(packagePath, "package.json")).json()).name;
				} catch {
					continue;
				}
				if (typeof packageName !== "string" || !packageName.startsWith("@oh-my-pi/")) continue;
				const packageTarget = path.join(target, packageName.slice("@oh-my-pi/".length));
				await fs.symlink(packagePath, packageTarget, "dir");
			}
			continue;
		}
		if (entry.name.startsWith("@") && entry.isDirectory()) {
			await fs.mkdir(target, { recursive: true });
			for (const scopedEntry of await fs.readdir(source, { withFileTypes: true })) {
				await fs.symlink(path.join(source, scopedEntry.name), path.join(target, scopedEntry.name), "dir");
			}
			continue;
		}
		await fs.symlink(source, target, entry.isDirectory() ? "dir" : undefined);
	}
}

export async function runSystem(
	system: RunSummary["system"],
	cliPath: string,
	model: string,
	packetDir: string,
	manifest: PacketManifest,
	outputDir: string,
	repeat: number,
	packetFiles: Map<string, string>,
	repositoryPath?: string,
	adaptiveMode: "off" | "auto" | null = null,
	budget: RunBudget | null = null,
	thinkingLevel = "low",
): Promise<RunSummary> {
	if (!CLI_THINKING_LEVELS.includes(thinkingLevel))
		throw new Error(`--thinking must be one of: ${CLI_THINKING_LEVELS.join(", ")}`);
	const artifactDir = await fs.mkdtemp(path.join(outputDir, `${system}-${repeat}-`));
	const runDir = path.join(artifactDir, "workspace");
	const sessionDirectory = path.join(artifactDir, "sessions");
	const sourceRepo = repositoryPath ? vcs.requireGit(repositoryPath) : null;
	let worktreeRepo = sourceRepo;
	if (repositoryPath) {
		if (!sourceRepo) throw new Error(`No git repository at ${repositoryPath}`);
		await sourceRepo.worktreeAdd(runDir, manifest.sourceCommit, { detach: true, clone: false });
		worktreeRepo = vcs.requireGit(runDir);
		for (const ignored of ["node_modules", "target"])
			await fs.rm(path.join(runDir, ignored), { recursive: true, force: true });
		if (
			await fs
				.stat(path.join(repositoryPath, "node_modules"))
				.then(info => info.isDirectory())
				.catch(() => false)
		)
			await linkRepositoryDependencies(repositoryPath, runDir);
		const nativeDirectory = path.join(repositoryPath, "packages/natives/native");
		for (const filename of await fs.readdir(nativeDirectory)) {
			if (!filename.endsWith(".node")) continue;
			await fs.symlink(path.join(nativeDirectory, filename), path.join(runDir, "packages/natives/native", filename));
		}
	} else {
		await fs.cp(packetDir, runDir, { recursive: true, force: true });
	}
	for (const [destination, source] of Object.entries(manifest.supportFiles ?? {})) {
		const target = path.join(runDir, destination);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.copyFile(path.resolve(packetDir, source), target);
	}
	await fs.mkdir(sessionDirectory, { recursive: true });
	const adaptiveConfigPath = adaptiveMode ? path.join(runDir, ".omp/config.yml") : undefined;
	if (adaptiveConfigPath) {
		if (await Bun.file(adaptiveConfigPath).exists())
			throw new Error(`Cannot apply Governor benchmark setting over existing ${adaptiveConfigPath}`);
		await fs.mkdir(path.dirname(adaptiveConfigPath), { recursive: true });
		await Bun.write(adaptiveConfigPath, `adaptive:\n  mode: ${adaptiveMode}\n`);
	}
	const prompt = `@${manifest.taskFile}`;
	const transcriptPath = path.join(artifactDir, "transcript.jsonl");
	const {
		exitCode,
		output: transcript,
		durationMs: wallTimeMs,
		stopReason,
	} = await runBudgetedCommand(
		[
			process.execPath,
			path.resolve(cliPath),
			"--print",
			"--mode",
			"json",
			"--auto-approve",
			"--model",
			model,
			"--thinking",
			thinkingLevel,
			"--cwd",
			runDir,
			"--session-dir",
			sessionDirectory,
			...(manifest.configFile ? ["--config", path.resolve(runDir, manifest.configFile)] : []),
			...(budget ? ["--max-time", `${Math.floor(budget.maxTimeMs / 1000)}s`] : []),
			prompt,
		],
		runDir,
		sessionDirectory,
		budget,
		transcriptPath,
	);
	await Bun.write(transcriptPath, transcript);
	const telemetry = await readRunTelemetry(sessionDirectory);
	const orchestrationFailure = await readIntegrationOutcome(sessionDirectory, manifest.requiredIntegrationGate);
	const governorDecisions = await readGovernorDecisions(sessionDirectory);
	const test = await runCommand(manifest.acceptanceCommand, runDir);
	let changed: string[];
	if (adaptiveConfigPath) {
		const config = await Bun.file(adaptiveConfigPath).text();
		if (config !== `adaptive:\n  mode: ${adaptiveMode}\n`)
			throw new Error("Benchmark agent modified the temporary Governor settings overlay");
		await fs.rm(adaptiveConfigPath, { force: true });
		await fs.rm(path.dirname(adaptiveConfigPath), { recursive: false }).catch(() => {});
	}
	if (worktreeRepo) {
		if (!sourceRepo) throw new Error(`No source git repository at ${repositoryPath ?? ""}`);
		for (const [destination, source] of Object.entries(manifest.supportFiles ?? {})) {
			const actual = await Bun.file(path.join(runDir, destination)).text();
			if (actual !== (await Bun.file(path.resolve(packetDir, source)).text())) {
				changed = [destination];
				throw new Error(`Benchmark agent modified support file ${destination}`);
			}
			await fs.rm(path.join(runDir, destination), { force: true });
		}
		changed = [
			...new Set([...(await worktreeRepo.changedFiles({})), ...(await worktreeRepo.lsFiles(true, true))]),
		].sort();
		await Bun.write(
			path.join(artifactDir, "final.diff"),
			await worktreeRepo.diffText({ binary: true, maxBytes: 20_000_000 }),
		);
		await sourceRepo.worktreeRemove(runDir, true);
	} else {
		const runFiles = await fileSnapshot(runDir);
		changed = [...new Set([...packetFiles.keys(), ...runFiles.keys()])].filter(
			relative => packetFiles.get(relative) !== runFiles.get(relative),
		);
	}
	const allowedChanges = manifest.allowedChangedFiles ?? manifest.expectedChangedFiles;
	const allowedChangeSet = new Set(allowedChanges);
	const changedOutsideScope = changed.filter(relative => !allowedChangeSet.has(relative));
	const changedSetMatches = manifest.allowedChangedFiles
		? changed.length > 0
		: changed.length === manifest.expectedChangedFiles.length && changedOutsideScope.length === 0;
	return {
		system,
		cliPath: path.resolve(cliPath),
		model,
		thinkingLevel,
		exitCode,
		testExitCode: test.exitCode,
		passed:
			exitCode === 0 &&
			test.exitCode === 0 &&
			changedSetMatches &&
			changedOutsideScope.length === 0 &&
			orchestrationFailure === null,
		orchestrationPassed: orchestrationFailure === null,
		orchestrationFailure,
		budgetStopReason: stopReason,
		adaptiveMode,
		governorDecisions,
		changedFiles: changed,
		filesWithinScope: changedOutsideScope.length === 0,
		...telemetry,
		wallTimeMs,
		humanInterventions: 0,
		transcriptPath,
		sessionDirectory,
		workspacePath: runDir,
		testOutput: test.output,
	};
}

/** Gate yield output alone is insufficient: only the parent's host job snapshot proves acceptance. */
export async function readIntegrationOutcome(
	sessionDirectory: string,
	requirement: PacketManifest["requiredIntegrationGate"],
): Promise<string | null> {
	if (!requirement) return null;
	const glob = new Bun.Glob("*.jsonl");
	for await (const relative of glob.scan({ cwd: sessionDirectory, onlyFiles: true })) {
		let latest: Record<string, unknown> | undefined;
		for (const line of (await Bun.file(path.join(sessionDirectory, relative)).text()).split("\n")) {
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isRecord(entry) || !isRecord(entry.message)) continue;
			const message = entry.message;
			if (message.role !== "toolResult" || message.toolName !== "wait" || !isRecord(message.details)) continue;
			if (!Array.isArray(message.details.jobs)) continue;
			for (const job of message.details.jobs) {
				if (isRecord(job) && job.id === "Integration gate") latest = job;
			}
		}
		if (!latest) continue;
		const structured = latest.structured;
		if (
			latest.status !== "completed" ||
			!isRecord(structured) ||
			structured.status !== "valid" ||
			!isRecord(structured.data)
		)
			return "Integration gate did not complete with a host-accepted structured result";
		if (structured.data.status !== requirement.status)
			return `Integration gate did not report required status ${requirement.status}`;
		if (numberField(structured.data, "repairAttempts") < (requirement.minimumRepairAttempts ?? 0))
			return "Integration gate did not report the required repair attempts";
		return null;
	}
	return "Missing parent integration gate completion snapshot";
}

/** Persisted assistant messages are authoritative; task result summaries repeat worker usage. */
export async function readRunTelemetry(sessionDirectory: string): Promise<BenchmarkTelemetry> {
	const totals = parseTranscript("");
	const glob = new Bun.Glob("**/*.jsonl");
	let files = 0;
	for await (const relative of glob.scan({ cwd: sessionDirectory, onlyFiles: true })) {
		files++;
		const transcript = await Bun.file(path.join(sessionDirectory, relative)).text();
		const parsed = parseTranscript(transcript);
		totals.toolCalls.push(...parsed.toolCalls);
		for (const key of telemetryNumbers) totals[key] += parsed[key];
	}
	if (files === 0) throw new Error(`No persisted session telemetry in ${sessionDirectory}`);
	return totals;
}

const telemetryNumbers = [
	"assistantTurns",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"totalTokens",
	"costUsd",
] as const;
type BenchmarkTelemetry = Pick<RunSummary, "toolCalls" | (typeof telemetryNumbers)[number]>;

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const packetDir = path.resolve(
		args.get("--packet") ?? path.join(import.meta.dir, "fixtures/prompt-profile-retry-delay-v1"),
	);
	const outputDir = path.resolve(required(args, "--out"));
	const ompCli = required(args, "--omp-cli");
	const piforgeCli = required(args, "--piforge-cli");
	const ompRevision = args.get("--omp-revision");
	const piforgeRevision = args.get("--piforge-revision");
	const repository = args.get("--repository");
	const repositoryPath = repository ? path.resolve(repository) : undefined;
	const model = args.get("--model") ?? "openai-codex/gpt-6-luna";
	const thinkingLevel = args.get("--thinking") ?? "low";
	if (!CLI_THINKING_LEVELS.includes(thinkingLevel))
		throw new Error(`--thinking must be one of: ${CLI_THINKING_LEVELS.join(", ")}`);
	const selectedSystem = args.get("--system") ?? "both";
	if (selectedSystem !== "both" && selectedSystem !== "omp" && selectedSystem !== "piforge")
		throw new Error("--system must be both, omp, or piforge");
	const adaptiveMode = args.get("--adaptive-mode") ?? "off";
	if (adaptiveMode !== "off" && adaptiveMode !== "auto") throw new Error("--adaptive-mode must be off or auto");
	const maxTimeMs = Number(args.get("--time-cap-seconds") ?? 600) * 1000;
	const maxTotalTokens = Number(args.get("--token-cap") ?? 1_000_000);
	const budgetMode = args.get("--budget") ?? "unbounded";
	if (budgetMode !== "capped" && budgetMode !== "unbounded") throw new Error("--budget must be capped or unbounded");
	if (budgetMode === "capped" && (!Number.isSafeInteger(maxTimeMs) || maxTimeMs < 1_000))
		throw new Error("--time-cap-seconds must be >= 1");
	if (budgetMode === "capped" && (!Number.isSafeInteger(maxTotalTokens) || maxTotalTokens < 1))
		throw new Error("--token-cap must be a positive integer");
	const budget: RunBudget | null = budgetMode === "unbounded" ? null : { maxTimeMs, maxTotalTokens };
	const manifest = (await Bun.file(path.join(packetDir, "manifest.json")).json()) as PacketManifest;
	const repeatCount = Number(args.get("--repeat-count") ?? 1);
	const taskText = await Bun.file(path.join(packetDir, manifest.taskFile)).text();
	if (!taskText.trim() || !Number.isSafeInteger(repeatCount) || repeatCount < 1 || repeatCount > manifest.repeatCount)
		throw new Error("The benchmark packet is missing a task or repeat count.");
	await fs.mkdir(outputDir, { recursive: true });
	const packetFiles = await fileSnapshot(packetDir);
	const runs: RunSummary[] = [];
	for (let repeat = 1; repeat <= repeatCount; repeat++) {
		const pairedSystems =
			repeat % 2 === 1
				? ([
						["omp", ompCli],
						["piforge", piforgeCli],
					] as const)
				: ([
						["piforge", piforgeCli],
						["omp", ompCli],
					] as const);
		const systems = pairedSystems.filter(([system]) => selectedSystem === "both" || system === selectedSystem);
		for (const [system, cliPath] of systems) {
			runs.push(
				await runSystem(
					system,
					cliPath,
					model,
					packetDir,
					manifest,
					outputDir,
					repeat,
					packetFiles,
					repositoryPath,
					selectedSystem === "piforge" ? adaptiveMode : null,
					budget,
					thinkingLevel,
				),
			);
		}
	}
	const report = {
		packet: manifest,
		model,
		thinkingLevel,
		createdAt: new Date().toISOString(),
		conditions: {
			autoApprove: true,
			sessionPersistence: true,
			taskPrompt: manifest.taskFile,
			selectedSystem,
			budget: budget ? { maxTimeMs: budget.maxTimeMs, maxTotalTokens: budget.maxTotalTokens } : null,
			adaptiveMode: selectedSystem === "piforge" ? adaptiveMode : null,
			thinkingLevel,
			repeatCount,
		},
		sources: {
			omp: { cliPath: path.resolve(ompCli), revision: ompRevision ?? null },
			piforge: { cliPath: path.resolve(piforgeCli), revision: piforgeRevision ?? null },
		},
		runs,
	};
	await Bun.write(path.join(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) await main();
