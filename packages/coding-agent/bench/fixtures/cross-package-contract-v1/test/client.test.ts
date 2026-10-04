import { describe, expect, it } from "bun:test";
import { resolveRetryPolicy } from "../src/client.ts";
import { providers } from "../src/provider.ts";

describe("provider retry policy contract", () => {
	it("uses the provider's retry defaults when the caller leaves retry unset", () => {
		expect(resolveRetryPolicy(providers.patient)).toEqual({ maxAttempts: 5, baseDelayMs: 800 });
	});

	it("lets caller fields override provider defaults independently", () => {
		expect(resolveRetryPolicy(providers.patient, { retry: { maxAttempts: 2 } })).toEqual({
			maxAttempts: 2,
			baseDelayMs: 800,
		});
	});

	it("keeps the built-in policy when the provider and caller omit retry values", () => {
		expect(resolveRetryPolicy(providers.standard)).toEqual({ maxAttempts: 3, baseDelayMs: 250 });
	});

	it("lets an explicit caller delay override the provider delay", () => {
		expect(resolveRetryPolicy(providers.patient, { retry: { baseDelayMs: 100 } })).toEqual({
			maxAttempts: 5,
			baseDelayMs: 100,
		});
	});
});
