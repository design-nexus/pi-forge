import { describe, expect, it } from "bun:test";
import { retryDelay } from "../src/backoff.ts";
import { scheduledRetryDelay } from "../src/timer.ts";

describe("bounded retry scheduling", () => {
	it("caps the shared retry delay at the configured maximum", () => {
		expect(retryDelay(5, 100, 500)).toBe(500);
	});

	it("uses the shared bounded backoff behavior in the retry timer", () => {
		expect(scheduledRetryDelay(5, { baseMs: 100, maxMs: 500 })).toBe(500);
	});

	it("keeps exponential growth below the cap", () => {
		expect(scheduledRetryDelay(3, { baseMs: 100, maxMs: 1000 })).toBe(400);
	});
});
