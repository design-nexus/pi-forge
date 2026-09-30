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
		const taskTerms = contextTerms(
			`${withoutFileMentions(currentRequest)} ${withoutFileMentions(activeTodo?.content ?? "")}`,
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
