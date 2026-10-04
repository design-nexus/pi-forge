export interface RetryPolicy {
	maxAttempts: number;
	baseDelayMs: number;
}

export interface ProviderDescriptor {
	id: string;
	retry?: Partial<RetryPolicy>;
}

export const providers: Record<string, ProviderDescriptor> = {
	standard: { id: "standard" },
	patient: { id: "patient", retry: { maxAttempts: 5, baseDelayMs: 800 } },
};
