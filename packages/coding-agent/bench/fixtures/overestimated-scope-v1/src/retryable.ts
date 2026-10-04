export function isRetryableStatus(status: number): boolean {
	return status >= 400;
}
