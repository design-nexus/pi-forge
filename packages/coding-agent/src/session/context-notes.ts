import * as path from "node:path";
import { textContent } from "@oh-my-pi/pi-tui/chat/transcript-entry";
import { prompt } from "@oh-my-pi/pi-utils";
import type { CustomEntry, SessionEntry } from "./session-entries";
import contextNotesPrompt from "../prompts/system/context-notes.md" with { type: "text" };
import { getLatestTodoPhasesFromEntries, nextActionableTask } from "../tools/todo";
import { extractFileMentions, withoutFileMentions } from "../utils/file-mention-parser";
import { toolResultPaths } from "./tool-result-paths";

export const CONTEXT_NOTES_ENTRY_TYPE = "experimental_context_notes";
export const MAX_CONTEXT_NOTES_BYTES = 16_384;
export const MAX_CONTEXT_NOTES_SOURCE_IDS = 16;
export const MAX_CONTEXT_NOTES_SOURCE_ID_CHARS = 128;
export const MAX_CONTEXT_NOTES_FINDINGS = 32;
export const MAX_CONTEXT_NOTES_CONTEXT_TOKENS = 4_096;
export const CONTEXT_NOTES_CONTEXT_WINDOW_SHARE = 0.1;
export const MIN_CONTEXT_NOTES_CONTEXT_TOKENS = 512;
const MAX_CONTEXT_NOTE_SOURCE_MATCH_CHARS = 16_384;
const MAX_CONTEXT_NOTE_TASKS = 64;
const MAX_CONTEXT_NOTE_TASK_CHARS = 4_096;
const CONTEXT_NOTES_SOURCE_ID_RE = /^[A-Za-z0-9_-]+$/;
const CONTEXT_NOTE_QUERY_STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"also",
	"and",
	"are",
	"before",
	"being",
	"between",
	"but",
	"check",
	"could",
	"does",
	"fix",
	"for",
	"from",
	"have",
	"into",
	"its",
	"keep",
	"make",
	"more",
	"need",
	"not",
	"please",
	"should",
	"that",
	"the",
	"their",
	"then",
	"there",
	"this",
	"through",
	"using",
	"with",
	"work",
	"would",
]);

export type ContextNotesEntry =
	| { version: 1; text: string }
	| { version: 2; text: string; sourceEntryIds: string[] }
	| { version: 3; text: string; sourceEntryIds: string[]; retention: "window" }
	| { version: 4; findings: ContextNotesFinding[] };

export type ContextNotesRetention = "pinned" | "window";

export interface ContextNotesFinding {
	text: string;
	retention: ContextNotesRetention;
	sourceEntryIds: string[];
}

export interface ContextNotesRevision {
	text: string;
	entryId: string;
	sourceEntryIds?: string[];
	retention?: ContextNotesRetention;
	findings?: ContextNotesFinding[];
}

export function contextNotesTokenBudget(contextWindow: number): number | undefined {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
	return Math.min(
		contextWindow,
		MAX_CONTEXT_NOTES_CONTEXT_TOKENS,
		Math.max(MIN_CONTEXT_NOTES_CONTEXT_TOKENS, Math.floor(contextWindow * CONTEXT_NOTES_CONTEXT_WINDOW_SHARE)),
	);
}

export function isContextNotesSourceIds(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_CONTEXT_NOTES_SOURCE_IDS &&
		value.every(
			id =>
				typeof id === "string" &&
				id.length <= MAX_CONTEXT_NOTES_SOURCE_ID_CHARS &&
				CONTEXT_NOTES_SOURCE_ID_RE.test(id),
		) &&
		new Set(value).size === value.length
	);
}

export function isContextNotesFindings(value: unknown): value is ContextNotesFinding[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONTEXT_NOTES_FINDINGS) return false;
	let bytes = 0;
	let sources = 0;
	for (const item of value) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
		const finding = item as Record<string, unknown>;
		if (
			Object.keys(finding).length !== 3 ||
			typeof finding.text !== "string" ||
			finding.text.trim().length === 0 ||
			(finding.retention !== "pinned" && finding.retention !== "window") ||
			!isContextNotesSourceIds(finding.sourceEntryIds)
		)
			return false;
		bytes += Buffer.byteLength(finding.text, "utf8");
		sources += finding.sourceEntryIds.length;
	}
	return bytes <= MAX_CONTEXT_NOTES_BYTES && sources <= MAX_CONTEXT_NOTES_SOURCE_IDS;
}

function isContextNotesEntry(entry: SessionEntry): entry is CustomEntry<unknown> {
	return entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE;
}

function isContextNotesData(data: unknown): data is ContextNotesEntry {
	if (data === null || typeof data !== "object") return false;
	const candidate = data as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (candidate.version === 4) {
		return keys.length === 2 && isContextNotesFindings(candidate.findings);
	}
	if (typeof candidate.text !== "string" || Buffer.byteLength(candidate.text, "utf8") > MAX_CONTEXT_NOTES_BYTES)
		return false;
	if (candidate.version === 1) return keys.length === 2 && keys.includes("text");
	if (candidate.version === 2)
		return (
			keys.length === 3 &&
			keys.includes("sourceEntryIds") &&
			isContextNotesSourceIds(candidate.sourceEntryIds) &&
			candidate.sourceEntryIds.length > 0
		);
	if (candidate.version === 3)
		return (
			keys.length === 4 &&
			keys.includes("sourceEntryIds") &&
			candidate.retention === "window" &&
			isContextNotesSourceIds(candidate.sourceEntryIds)
		);
	return false;
}

/**
 * Returns the latest valid notebook revision visible after the active context-reset boundary.
 * A window-scoped revision expires at the next compaction without reviving older revisions.
 * Invalid historical custom entries are ignored so a malformed journal record cannot mask an
 * earlier valid notebook revision.
 */
export function getContextNotes(entries: readonly SessionEntry[]): ContextNotesRevision | undefined {
	let crossedCompaction = false;
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type === "reset_boundary") return undefined;
		if (entry.type === "compaction") {
			crossedCompaction = true;
			continue;
		}
		if (!isContextNotesEntry(entry) || !isContextNotesData(entry.data)) continue;
		if (entry.data.version !== 1) {
			const priorIds = new Set(entries.slice(0, index).map(prior => prior.id));
			const sourceIds =
				entry.data.version === 4
					? entry.data.findings.flatMap(finding => finding.sourceEntryIds)
					: entry.data.sourceEntryIds;
			if (sourceIds.some(id => !priorIds.has(id))) continue;
		}
		if (entry.data.version === 3 && crossedCompaction) return undefined;
		if (entry.data.version === 4) {
			const findings = entry.data.findings
				.filter(finding => !crossedCompaction || finding.retention === "pinned")
				.map(finding => ({ ...finding, sourceEntryIds: [...finding.sourceEntryIds] }));
			return findings.length > 0
				? { text: findings.map(finding => finding.text).join("\n"), entryId: entry.id, findings }
				: undefined;
		}
		return {
			text: entry.data.text,
			entryId: entry.id,
			...(entry.data.version === 2 ? { sourceEntryIds: [...entry.data.sourceEntryIds] } : {}),
			...(entry.data.version === 3
				? {
						retention: entry.data.retention,
						...(entry.data.sourceEntryIds.length > 0 ? { sourceEntryIds: [...entry.data.sourceEntryIds] } : {}),
					}
				: {}),
		};
	}
	return undefined;
}

/** Resolve only file references that identify one cited source path. */
function matchingSourcePaths(mentions: readonly string[], sourcePaths: ReadonlySet<string>): Set<string> {
	const matches = new Set<string>();
	for (const mention of mentions) {
		const normalized = path.normalize(mention);
		if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) continue;
		const candidates = [...sourcePaths].filter(sourcePath => {
			const candidate = path.normalize(sourcePath);
			return (
				candidate === normalized || (!path.isAbsolute(normalized) && candidate.endsWith(`${path.sep}${normalized}`))
			);
		});
		if (candidates.length === 1) matches.add(candidates[0]);
	}
	return matches;
}

/** Match useful words from the current task against a finding without external model calls. */
function contextTerms(text: string): Set<string> {
	return new Set(
		text
			.slice(0, MAX_CONTEXT_NOTE_SOURCE_MATCH_CHARS)
			.toLowerCase()
			.match(/[\p{L}\p{N}]{3,}/gu)
			?.filter(term => !CONTEXT_NOTE_QUERY_STOP_WORDS.has(term)) ?? [],
	);
}

interface ContextTaskNode {
	name: string;
	task: string;
	dependsOn: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read only a bounded, valid structured task batch from the active transcript. */
function latestContextTaskGraph(entries: readonly SessionEntry[]): ContextTaskNode[] {
	const boundary = Math.max(
		entries.findLastIndex(entry => entry.type === "reset_boundary"),
		entries.findLastIndex(entry => entry.type === "compaction"),
	);
	for (let index = entries.length - 1; index > boundary; index--) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		for (const part of [...entry.message.content].reverse()) {
			if (part.type !== "toolCall" || part.name !== "task" || !isRecord(part.arguments)) continue;
			const rawTasks = part.arguments.tasks;
			if (!Array.isArray(rawTasks) || rawTasks.length === 0 || rawTasks.length > MAX_CONTEXT_NOTE_TASKS) return [];
			const nodes: ContextTaskNode[] = [];
			const indexes = new Map<string, number>();
			for (const [taskIndex, rawTask] of rawTasks.entries()) {
				if (
					!isRecord(rawTask) ||
					typeof rawTask.name !== "string" ||
					typeof rawTask.task !== "string" ||
					rawTask.task.trim() === "" ||
					rawTask.task.length > MAX_CONTEXT_NOTE_TASK_CHARS ||
					(rawTask.dependsOn !== undefined &&
						(!Array.isArray(rawTask.dependsOn) ||
							rawTask.dependsOn.length > MAX_CONTEXT_NOTE_TASKS ||
							rawTask.dependsOn.some(name => typeof name !== "string" || name.trim() === "")))
				) {
					return [];
				}
				const name = rawTask.name.trim();
				const key = name.toLowerCase();
				if (!name || indexes.has(key)) return [];
				const dependencies =
					(rawTask.dependsOn as string[] | undefined)?.map(dependency => dependency.trim()) ?? [];
				if (new Set(dependencies.map(dependency => dependency.toLowerCase())).size !== dependencies.length)
					return [];
				indexes.set(key, taskIndex);
				nodes.push({
					name,
					task: rawTask.task,
					dependsOn: dependencies,
				});
			}
			const remaining = nodes.map(node => node.dependsOn.length);
			const children = new Map<number, number[]>();
			for (const [taskIndex, node] of nodes.entries()) {
				for (const dependency of node.dependsOn) {
					const dependencyIndex = indexes.get(dependency.toLowerCase());
					if (dependencyIndex === undefined || dependencyIndex === taskIndex) return [];
					const dependents = children.get(dependencyIndex);
					if (dependents) dependents.push(taskIndex);
					else children.set(dependencyIndex, [taskIndex]);
				}
			}
			let ready = remaining.flatMap((count, taskIndex) => (count === 0 ? [taskIndex] : []));
			let visited = 0;
			while (ready.length > 0) {
				const next: number[] = [];
				for (const taskIndex of ready) {
					visited++;
					for (const child of children.get(taskIndex) ?? []) {
						remaining[child] -= 1;
						if (remaining[child] === 0) next.push(child);
					}
				}
				ready = next;
			}
			return visited === nodes.length ? nodes : [];
		}
	}
	return [];
}

/** Extend current-turn terms only across graph nodes that match current task evidence. */
function dependencyAwareTaskTerms(entries: readonly SessionEntry[], taskTerms: Set<string>): Set<string> {
	if (taskTerms.size === 0) return taskTerms;
	const graph = latestContextTaskGraph(entries);
	if (graph.length === 0) return taskTerms;
	const indexes = new Map(graph.map((node, index) => [node.name.toLowerCase(), index]));
	const adjacent = graph.map(() => new Set<number>());
	for (const [index, node] of graph.entries()) {
		for (const dependency of node.dependsOn) {
			const dependencyIndex = indexes.get(dependency.toLowerCase());
			if (dependencyIndex === undefined) continue;
			adjacent[index]!.add(dependencyIndex);
			adjacent[dependencyIndex]!.add(index);
		}
	}
	const related = new Set<number>();
	for (const [index, node] of graph.entries()) {
		const nodeTerms = contextTerms(node.task);
		if ([...nodeTerms].some(term => taskTerms.has(term))) related.add(index);
	}
	const queue = [...related];
	while (queue.length > 0) {
		const index = queue.shift()!;
		for (const neighbor of adjacent[index]!) {
			if (related.has(neighbor)) continue;
			related.add(neighbor);
			queue.push(neighbor);
		}
	}
	const expanded = new Set(taskTerms);
	for (const index of related) for (const term of contextTerms(graph[index]!.task)) expanded.add(term);
	return expanded;
}

/**
 * Renders the context injection for the latest visible non-empty notebook revision.
 * An absent or explicitly cleared notebook returns an empty string so callers add no context.
 */
export function renderContextNotes(entries: readonly SessionEntry[]): string {
	const notes = getContextNotes(entries);
	if (!notes || notes.text.length === 0) return "";
	if (notes.findings) {
		const currentTurnStart = entries.findLastIndex(
			entry => entry.type === "message" && entry.message.role === "user",
		);
		if (currentTurnStart < 0) return renderContextFindingsContent(notes.findings);
		const currentTurnIds = new Set(entries.slice(currentTurnStart).map(entry => entry.id));
		const touchedPaths = new Set(
			entries
				.slice(currentTurnStart)
				.flatMap(entry =>
					entry.type === "message" &&
					entry.message.role === "toolResult" &&
					!entry.message.isError &&
					(entry.message.toolName === "edit" || entry.message.toolName === "write")
						? toolResultPaths(entry.message.toolName, entry.message.details)
						: [],
				),
		);
		const sources = new Map(entries.map(entry => [entry.id, entry]));
		const sourceIndexes = new Map(entries.map((entry, index) => [entry.id, index]));
		const sourcePaths = new Map<string, string[]>();
		const sourceTerms = new Map<string, Set<string>>();
		const allSourcePaths = new Set<string>();
		for (const finding of notes.findings) {
			for (const id of finding.sourceEntryIds) {
				if (sourcePaths.has(id)) continue;
				const source = sources.get(id);
				const paths =
					source?.type === "message" && source.message.role === "toolResult" && !source.message.isError
						? toolResultPaths(source.message.toolName, source.message.details)
						: [];
				sourcePaths.set(id, paths);
				if (
					source?.type === "message" &&
					(source.message.role === "user" || (source.message.role === "toolResult" && !source.message.isError))
				) {
					const content = textContent(source.message.content).slice(0, MAX_CONTEXT_NOTE_SOURCE_MATCH_CHARS);
					sourceTerms.set(id, contextTerms(content));
				}
				for (const sourcePath of paths) allSourcePaths.add(sourcePath);
			}
		}
		const currentUser = entries[currentTurnStart];
		const currentRequest =
			currentUser.type === "message" && currentUser.message.role === "user"
				? textContent(currentUser.message.content)
				: "";
		const fileMentions = extractFileMentions(currentRequest);
		const mentionedPaths = matchingSourcePaths(fileMentions, allSourcePaths);
		const resetBoundary = entries.findLastIndex(entry => entry.type === "reset_boundary");
		const activeTodo = nextActionableTask(getLatestTodoPhasesFromEntries(entries.slice(resetBoundary + 1)));
		const todoPaths = matchingSourcePaths(activeTodo ? extractFileMentions(activeTodo.content) : [], allSourcePaths);
		const taskTerms = dependencyAwareTaskTerms(
			entries,
			contextTerms(`${withoutFileMentions(currentRequest)} ${withoutFileMentions(activeTodo?.content ?? "")}`),
		);
		const score = (finding: ContextNotesFinding): number => {
			if (finding.sourceEntryIds.some(id => currentTurnIds.has(id))) return 4;
			if (finding.sourceEntryIds.some(id => sourcePaths.get(id)?.some(sourcePath => mentionedPaths.has(sourcePath))))
				return 3;
			if (finding.sourceEntryIds.some(id => sourcePaths.get(id)?.some(sourcePath => todoPaths.has(sourcePath))))
				return 2;
			if (finding.sourceEntryIds.some(id => sourcePaths.get(id)?.some(sourcePath => touchedPaths.has(sourcePath))))
				return 1;
			const findingTerms = contextTerms(finding.text);
			const evidenceTerms = new Set(findingTerms);
			for (const id of finding.sourceEntryIds) {
				for (const term of sourceTerms.get(id) ?? []) evidenceTerms.add(term);
			}
			const sharedTerms = taskTerms.size > 0 ? [...evidenceTerms].filter(term => taskTerms.has(term)).length : 0;
			if (sharedTerms > 0) {
				const latestSourceIndex = Math.max(...finding.sourceEntryIds.map(id => sourceIndexes.get(id) ?? -1));
				const age = Math.max(0, currentTurnStart - latestSourceIndex);
				return (0.25 + Math.min(0.5, sharedTerms * 0.1)) / (1 + Math.log1p(age));
			}
			// Keep source-order stable without a positive relevance signal; recency alone
			// should not make unrelated findings displace authored context.
			return 0;
		};
		const ordered = notes.findings.toSorted((left, right) => score(right) - score(left));
		return renderContextFindingsContent(ordered);
	}
	return renderContextNotesContent(notes.text, notes.sourceEntryIds, notes.retention);
}

/** Render a proposed notebook revision with the same template used after commit. */
export function renderContextNotesContent(
	text: string,
	sourceEntryIds?: readonly string[],
	retention?: ContextNotesRetention,
): string {
	if (text.length === 0) return "";
	return prompt
		.render(contextNotesPrompt, { notes: text, sourceEntryIds, windowScoped: retention === "window" })
		.trim();
}

/** Render structured findings with the same template used after commit. */
export function renderContextFindingsContent(findings: readonly ContextNotesFinding[]): string {
	if (findings.length === 0) return "";
	return prompt.render(contextNotesPrompt, { findings }).trim();
}
