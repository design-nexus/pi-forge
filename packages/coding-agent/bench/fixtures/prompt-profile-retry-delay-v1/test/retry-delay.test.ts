import { describe, expect, it } from "bun:test";
import { retryDelay } from "../src/retry-delay";

describe("retryDelay", () => {
	it("doubles the delay by attempt and clamps it at the maximum", () => {
		expect(retryDelay(0, 100, 1000)).toBe(100);
		expect(retryDelay(1, 100, 1000)).toBe(200);
		expect(retryDelay(3, 100, 1000)).toBe(800);
		expect(retryDelay(20, 100, 1000)).toBe(1000);
	});

	it("rejects an invalid attempt or delay range", () => {
		for (const args of [
			[-1, 100, 1000],
			[1.5, 100, 1000],
			[0, 0, 1000],
			[0, Number.POSITIVE_INFINITY, 1000],
			[0, 100, 99],
		] as const) {
			expect(() => retryDelay(...args)).toThrow(RangeError);
		}
	});
});
