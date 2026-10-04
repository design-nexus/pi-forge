import type { ProviderDescriptor, RetryPolicy } from "./provider.ts";

export interface ClientOptions {
	retry?: Partial<RetryPolicy>;
}

export function resolveRetryPolicy(provider: ProviderDescriptor, options: ClientOptions = {}): RetryPolicy {
	return {
		maxAttempts: options.retry?.maxAttempts ?? 3,
		baseDelayMs: options.retry?.baseDelayMs ?? 250,
	};
}
