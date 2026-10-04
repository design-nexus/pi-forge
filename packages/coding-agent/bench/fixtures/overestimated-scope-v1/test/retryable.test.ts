import { describe, expect, it } from "bun:test";
import { isRetryableStatus } from "../src/retryable.ts";

describe("shared retry classification", () => {
	it("does not retry permanent client errors", () => {
		expect(isRetryableStatus(400)).toBe(false);
		expect(isRetryableStatus(404)).toBe(false);
	});

	it("retries throttling and server errors", () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(503)).toBe(true);
	});
});
