import { expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { fileSnapshot, readRunTelemetry, runSystem } from "../bench/task-outcome-ab";
import type { PacketManifest } from "../bench/task-outcome-ab";

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
const args = process.argv;
const sessions = args[args.indexOf("--session-dir") + 1];
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
