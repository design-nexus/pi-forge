import { createStorageOptions } from "./storage.ts";

export function historyStorage(root: string) {
	return createStorageOptions(`${root}/history`, true);
}
