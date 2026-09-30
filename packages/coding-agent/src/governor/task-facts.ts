import type { TaskCapabilityId } from "../prompt-engine/capability-catalog";
import type { GovernorDecisionInput } from "./decision";

export interface GovernorTaskFacts {
	files: readonly string[];
	tasks: readonly {
		id: string;
		dependsOn: readonly string[];
		requiredCapabilities?: readonly TaskCapabilityId[];
	}[];
	highRisk: boolean;
	confidence: number;
	/** Capabilities required by this structured task source; never inferred from prompt text. */
	requiredCapabilities?: readonly TaskCapabilityId[];
	/** High-confidence capabilities inferred from task descriptions. */
	inferredCapabilities?: readonly TaskCapabilityId[];
	capabilityConfidence?: number;
}

/** Count distinct files, dependency edges, and the widest runnable task wave. */
export function signalsFromTaskFacts(facts: GovernorTaskFacts): GovernorDecisionInput["signals"] {
	const files = new Set(facts.files);
	if (files.has("")) throw new Error("Governor task files must have nonempty paths");
	const tasks = new Map(facts.tasks.map(task => [task.id, task]));
	if (tasks.size !== facts.tasks.length || tasks.has("")) {
		throw new Error("Governor tasks require unique nonempty ids");
	}
	const children = new Map<string, string[]>();
	const remaining = new Map<string, number>();
	let dependencyEdges = 0;
	for (const task of facts.tasks) {
		const dependencies = new Set(task.dependsOn);
		for (const dependency of dependencies) {
			if (!tasks.has(dependency)) throw new Error(`Governor task ${task.id} has unknown dependency ${dependency}`);
			const dependents = children.get(dependency);
			if (dependents) dependents.push(task.id);
			else children.set(dependency, [task.id]);
		}
		remaining.set(task.id, dependencies.size);
		dependencyEdges += dependencies.size;
	}
	let ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
	let independentTasks = 0;
	let visited = 0;
	while (ready.length > 0) {
		independentTasks = Math.max(independentTasks, ready.length);
		visited += ready.length;
		const next: string[] = [];
		for (const id of ready) {
			for (const child of children.get(id) ?? []) {
				const count = (remaining.get(child) ?? 0) - 1;
				remaining.set(child, count);
				if (count === 0) next.push(child);
			}
		}
		ready = next;
	}
	if (visited !== tasks.size) {
		const blocked = [...remaining].filter(([, count]) => count > 0).map(([id]) => id);
		throw new Error(`Governor task dependencies contain a cycle or blocked chain: ${blocked.join(", ")}`);
	}
	return {
		fileCount: files.size,
		taskCount: tasks.size,
		independentTasks,
		dependencyEdges,
		highRisk: facts.highRisk,
		confidence: facts.confidence,
	};
}
