export interface StorageOptions {
	path: string;
	readOnly: boolean;
}

export function createStorageOptions(path: string, readOnly: boolean): StorageOptions {
	return { path, readOnly };
}
