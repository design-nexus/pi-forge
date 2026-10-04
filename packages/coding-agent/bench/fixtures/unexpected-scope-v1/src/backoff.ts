export function retryDelay(attempt: number, baseMs: number, maxMs: number): number {
	void maxMs;
	return baseMs * 2 ** Math.max(0, attempt - 1);
}
