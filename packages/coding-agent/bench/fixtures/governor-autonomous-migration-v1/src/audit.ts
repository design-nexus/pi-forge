import { createStorageOptions } from "./storage.ts";

export function auditStorage(root: string) {
	return createStorageOptions(`${root}/audit`, true);
}
