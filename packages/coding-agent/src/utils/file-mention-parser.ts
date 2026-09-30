/** Regex to match @filepath patterns in text. */
const FILE_MENTION_REGEX = /@(?:"([^"]+)"|'([^']+)'|([^\s@]+))/g;
const LEADING_PUNCTUATION_REGEX = /^[`"'([{<]+/;
const TRAILING_PUNCTUATION_REGEX = /[)\]}>.,;:!?"'`]+$/;
const MENTION_BOUNDARY_REGEX = /[\s([{<"'`]/;

function isMentionBoundary(text: string, index: number): boolean {
	if (index === 0) return true;
	return MENTION_BOUNDARY_REGEX.test(text[index - 1]);
}

function sanitizeMentionPath(rawPath: string): string | null {
	let cleaned = rawPath.trim();
	cleaned = cleaned.replace(LEADING_PUNCTUATION_REGEX, "");
	cleaned = cleaned.replace(TRAILING_PUNCTUATION_REGEX, "");
	cleaned = cleaned.trim();
	return cleaned.length > 0 ? cleaned : null;
}

/** Extract all @filepath mentions from text. */
export function extractFileMentions(text: string): string[] {
	const matches = [...text.matchAll(FILE_MENTION_REGEX)];
	const mentions: string[] = [];

	for (const match of matches) {
		const index = match.index ?? 0;
		if (!isMentionBoundary(text, index)) continue;

		const rawPath = match[1] ?? match[2] ?? match[3];
		if (!rawPath) continue;

		const cleaned = match[1] !== undefined || match[2] !== undefined ? rawPath.trim() : sanitizeMentionPath(rawPath);
		if (!cleaned) continue;

		mentions.push(cleaned);
	}

	return [...new Set(mentions)];
}

/** Remove valid @file references before matching the remaining natural-language task terms. */
export function withoutFileMentions(text: string): string {
	let result = text;
	for (const match of [...text.matchAll(FILE_MENTION_REGEX)].reverse()) {
		const index = match.index ?? 0;
		if (!isMentionBoundary(text, index)) continue;
		result = `${result.slice(0, index)} ${result.slice(index + match[0].length)}`;
	}
	return result.replace(/\s+/gu, " ").trim();
}
