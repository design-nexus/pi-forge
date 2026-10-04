import { expect, it } from "bun:test";
import { recentHistory } from "../src/history.ts";
import { normalizeLabels } from "../src/labels.ts";
import { preview } from "../src/preview.ts";

it("canonicalizes labels and keeps the first occurrence without changing input", () => {
	const labels = Object.freeze([" Fix ", "FIX", "", "   ", "Review", "fix", " review "]);
	expect(normalizeLabels(labels)).toEqual(["fix", "review"]);
});

it("returns no labels for empty input", () => {
	expect(normalizeLabels([])).toEqual([]);
});

it("returns the newest entries in chronological order without changing input", () => {
	const entries = Object.freeze(["old", "middle", "new"]);
	expect(recentHistory(entries, 2)).toEqual(["middle", "new"]);
});

it("hides all history when the requested limit is zero or negative", () => {
	expect(recentHistory(["private"], 0)).toEqual([]);
	expect(recentHistory(["private"], -1)).toEqual([]);
});

it("returns an independent copy when the limit exceeds available history", () => {
	const entries = ["only"];
	const result = recentHistory(entries, 10);
	result.push("later");
	expect(entries).toEqual(["only"]);
	expect(result).toEqual(["only", "later"]);
});

it("combines canonical labels and hidden history through the existing consumer", () => {
	expect(preview([" Draft ", "draft"], ["private"], 0)).toEqual({ labels: ["draft"], entries: [] });
});
