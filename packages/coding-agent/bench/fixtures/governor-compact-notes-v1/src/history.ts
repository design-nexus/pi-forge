export function recentHistory(entries: readonly string[], limit: number): string[] {
	return entries.slice(-limit);
}
