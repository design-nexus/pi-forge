import { createStorageOptions } from "./storage.ts";

export function projectStorage(root: string) {
	return createStorageOptions(`${root}/project`, false);
}
