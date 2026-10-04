export interface RetryOptions {
	baseMs: number;
	maxMs: number;
}

export function scheduledRetryDelay(attempt: number, options: RetryOptions): number {
	return options.baseMs * 2 ** Math.max(0, attempt - 1);
}
