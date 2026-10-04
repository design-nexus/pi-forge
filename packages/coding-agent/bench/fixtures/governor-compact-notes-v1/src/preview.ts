import { recentHistory } from "./history.ts";
import { normalizeLabels } from "./labels.ts";

export function preview(labels: readonly string[], entries: readonly string[], limit: number) {
	return { labels: normalizeLabels(labels), entries: recentHistory(entries, limit) };
}
