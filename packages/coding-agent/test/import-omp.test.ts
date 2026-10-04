import { afterEach, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai/auth/sqlite-credential-store";
import { importOmpData } from "../src/cli/import-omp";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});
async function fixture(): Promise<{ root: string; source: string; destination: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-import-"));
	temporary.push(root);
	const source = path.join(root, "omp");
	const destination = path.join(root, "forge/agent");
	await Bun.write(path.join(source, "agent/config.yml"), "theme:\n  dark: dark-catppuccin\n");
	return { root, source, destination };
}
it("dry-run previews files and accounts without creating the Forge directory or modifying OMP", async () => {
	const { source, destination } = await fixture();
	const sourceDb = path.join(source, "agent/agent.db");
	const store = await SqliteAuthCredentialStore.open(sourceDb);
	await store.replaceAuthCredentials("test-provider", [{ type: "api_key", key: "fixture-only" }]);
	store.close();
	const before = Bun.hash(await Bun.file(sourceDb).arrayBuffer());
	const report = await importOmpData({ from: source, destination, dryRun: true });
	expect(report.copied).toContain("login:test-provider");
	await expect(fs.stat(path.dirname(destination))).rejects.toMatchObject({ code: "ENOENT" });
	expect(Bun.hash(await Bun.file(sourceDb).arrayBuffer())).toBe(before);
});
it("imports portable login data and selected assets without overwriting files or existing accounts", async () => {
	const { root, source, destination } = await fixture();
	const original = await SqliteAuthCredentialStore.open(path.join(source, "agent/agent.db"));
	await original.replaceAuthCredentials("existing", [{ type: "api_key", key: "source-key" }]);
	await original.replaceAuthCredentials("new", [{ type: "api_key", key: "import-key" }]);
	original.close();
	const current = await SqliteAuthCredentialStore.open(path.join(destination, "agent.db"));
	await current.replaceAuthCredentials("existing", [{ type: "api_key", key: "preserved-key" }]);
	current.close();
	await Bun.write(path.join(destination, "config.yml"), "theme:\n  dark: titanium\n");
	await Bun.write(path.join(source, "agent/sessions/task.jsonl"), "fixture-session\n");
	await Bun.write(path.join(source, "agent/agents/custom.md"), "custom agent\n");
	await Bun.write(path.join(root, "outside"), "not imported");
	await fs.symlink(path.join(root, "outside"), path.join(source, "agent/agents/link.md"));
	const report = await importOmpData({ from: source, destination, sessions: true, assets: true });
	expect(report.skipped).toContain("login:existing");
	expect(await Bun.file(path.join(destination, "config.yml")).text()).toContain("titanium");
	expect(await Bun.file(path.join(destination, "sessions/task.jsonl")).text()).toBe("fixture-session\n");
	expect(await Bun.file(path.join(destination, "agents/link.md")).exists()).toBe(false);
	const imported = SqliteAuthCredentialStore.readSnapshot(path.join(destination, "agent.db"));
	expect(imported.find(row => row.provider === "existing")?.credential).toEqual({
		type: "api_key",
		key: "preserved-key",
	});
	expect(imported.find(row => row.provider === "new")?.credential).toEqual({ type: "api_key", key: "import-key" });
});
it("dry-run skips existing credentials and refuses overlapping roots before copying", async () => {
	const { source, destination } = await fixture();
	const original = await SqliteAuthCredentialStore.open(path.join(source, "agent/agent.db"));
	await original.replaceAuthCredentials("existing", [{ type: "api_key", key: "source-key" }]);
	original.close();
	const current = await SqliteAuthCredentialStore.open(path.join(destination, "agent.db"));
	await current.replaceAuthCredentials("existing", [{ type: "api_key", key: "preserved-key" }]);
	current.close();
	const before = Bun.hash(await Bun.file(path.join(destination, "agent.db")).arrayBuffer());
	const report = await importOmpData({ from: source, destination, dryRun: true });
	expect(report.skipped).toContain("login:existing");
	expect(report.copied).not.toContain("login:existing");
	expect(Bun.hash(await Bun.file(path.join(destination, "agent.db")).arrayBuffer())).toBe(before);
	await expect(importOmpData({ from: source, destination: path.join(source, "nested") })).rejects.toThrow("overlap");
});
