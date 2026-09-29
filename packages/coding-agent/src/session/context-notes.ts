import { prompt } from "@oh-my-pi/pi-utils";
import type { CustomEntry, SessionEntry } from "./session-entries";
import contextNotesPrompt from "../prompts/system/context-notes.md" with { type: "text" };

export const CONTEXT_NOTES_ENTRY_TYPE = "experimental_context_notes";
export const MAX_CONTEXT_NOTES_BYTES = 16_384;
export const MAX_CONTEXT_NOTES_SOURCE_IDS = 16;
export const MAX_CONTEXT_NOTES_SOURCE_ID_CHARS = 128;
const CONTEXT_NOTES_SOURCE_ID_RE = /^[A-Za-z0-9_-]+$/;

export type ContextNotesEntry = { version: 1; text: string } | { version: 2; text: string; sourceEntryIds: string[] };

export interface ContextNotesRevision {
	text: string;
	entryId: string;
	sourceEntryIds?: string[];
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

function isContextNotesEntry(entry: SessionEntry): entry is CustomEntry<unknown> {
	return entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE;
}

function isContextNotesData(data: unknown): data is ContextNotesEntry {
	if (data === null || typeof data !== "object") return false;
	const candidate = data as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (typeof candidate.text !== "string" || Buffer.byteLength(candidate.text, "utf8") > MAX_CONTEXT_NOTES_BYTES)
		return false;
	if (candidate.version === 1) return keys.length === 2 && keys.includes("text");
	if (candidate.version !== 2 || keys.length !== 3 || !keys.includes("sourceEntryIds")) return false;
	return isContextNotesSourceIds(candidate.sourceEntryIds) && candidate.sourceEntryIds.length > 0;
}

/**
 * Returns the latest valid notebook revision visible after the active context-reset boundary.
 * Invalid historical custom entries are ignored so a malformed journal record cannot mask an
 * earlier valid notebook revision.
 */
export function getContextNotes(entries: readonly SessionEntry[]): ContextNotesRevision | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type === "reset_boundary") return undefined;
		if (!isContextNotesEntry(entry) || !isContextNotesData(entry.data)) continue;
		if (entry.data.version === 2) {
			const priorIds = new Set(entries.slice(0, index).map(prior => prior.id));
			if (entry.data.sourceEntryIds.some(id => !priorIds.has(id))) continue;
		}
		return entry.data.version === 2
			? { text: entry.data.text, entryId: entry.id, sourceEntryIds: [...entry.data.sourceEntryIds] }
			: { text: entry.data.text, entryId: entry.id };
	}
	return undefined;
}

/**
 * Renders the context injection for the latest visible non-empty notebook revision.
 * An absent or explicitly cleared notebook returns an empty string so callers add no context.
 */
export function renderContextNotes(entries: readonly SessionEntry[]): string {
	const notes = getContextNotes(entries);
	if (!notes || notes.text.length === 0) return "";
	return prompt.render(contextNotesPrompt, { notes: notes.text, sourceEntryIds: notes.sourceEntryIds }).trim();
}
