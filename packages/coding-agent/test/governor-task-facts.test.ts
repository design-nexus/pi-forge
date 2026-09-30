import { expect, it } from "bun:test";
import { signalsFromTaskFacts } from "@oh-my-pi/pi-coding-agent/governor/task-facts";

it("derives the runnable task width from dependencies without counting dependent work as parallel", () => {
	expect(
		signalsFromTaskFacts({
			files: ["src/a.ts", "src/b.ts", "src/a.ts"],
			tasks: [
				{ id: "a", dependsOn: [] },
				{ id: "b", dependsOn: [] },
				{ id: "c", dependsOn: ["a", "a", "b"] },
				{ id: "d", dependsOn: ["c"] },
			],
			highRisk: true,
			confidence: 0.8,
		}),
	).toEqual({ fileCount: 2, taskCount: 4, independentTasks: 2, dependencyEdges: 3, highRisk: true, confidence: 0.8 });
});

it("rejects a cyclic or dangling task graph before a transition can be recorded", () => {
	const base = { files: [], highRisk: false, confidence: 0.9 };
	expect(() =>
		signalsFromTaskFacts({
			...base,
			tasks: [
				{ id: "a", dependsOn: ["b"] },
				{ id: "b", dependsOn: ["a"] },
			],
		}),
	).toThrow("cycle or blocked chain: a, b");
	expect(() => signalsFromTaskFacts({ ...base, tasks: [{ id: "a", dependsOn: ["missing"] }] })).toThrow(
		"unknown dependency",
	);
});
