import { createStorageOptions } from "./storage.ts";

export function cacheStorage(root: string) {
	return createStorageOptions(`${root}/cache`, false);
}
