/** Paths confirmed by a successful file tool result. Callers exclude failed results. */
export function toolResultPaths(toolName: string, details: unknown): string[] {
	if (!details || typeof details !== "object") return [];
	if (toolName === "read" || toolName === "write") {
		return "resolvedPath" in details && typeof details.resolvedPath === "string" ? [details.resolvedPath] : [];
	}
	if (toolName !== "edit") return [];
	const files =
		"perFileResults" in details && Array.isArray(details.perFileResults) ? details.perFileResults : [details];
	return files.flatMap(file => {
		if (!file || typeof file !== "object") return [];
		const paths: string[] = [];
		if ("path" in file && typeof file.path === "string") paths.push(file.path);
		if ("sourcePath" in file && typeof file.sourcePath === "string") paths.push(file.sourcePath);
		return paths;
	});
}
