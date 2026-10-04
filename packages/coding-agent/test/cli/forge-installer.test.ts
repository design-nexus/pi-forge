import { afterEach, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});
const installer = path.resolve(import.meta.dir, "../../../../scripts/install.sh");
it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
	"verified installation replaces a launcher entry without changing its checkout, and checksum failure preserves the installed app",
	async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-installer-"));
		temporary.push(root);
		const tools = path.join(root, "tools");
		const installDir = path.join(root, "bin");
		await fs.mkdir(installDir);
		const original = path.join(root, "checkout-launcher");
		await Bun.write(original, "original source launcher\n");
		const installed = path.join(installDir, "pi-forge");
		await fs.symlink(original, installed);
		const binary = path.join(root, "pi-forge-linux-x64");
		await Bun.write(
			binary,
			'#!/bin/sh\ncase "$1" in --version) echo pi-forge/0.1.0;; --smoke-test) exit 0;; *) exit 1;; esac\n',
		);
		const checksum = new Bun.CryptoHasher("sha256").update(await Bun.file(binary).arrayBuffer()).digest("hex");
		await Bun.write(path.join(root, "SHA256SUMS"), `${checksum}  pi-forge-linux-x64\n`);
		const curl = path.join(tools, "curl");
		await Bun.write(
			curl,
			// Shell parameter expansion is intentional in this executable fixture.
			// oxlint-disable-next-line no-template-curly-in-string
			'#!/bin/sh\nasset=\noutput=\nwhile [ "$#" -gt 0 ]; do\n case "$1" in -o) shift; output=$1;; https://github.com/design-nexus/pi-forge/releases/download/v0.1.0/*) asset=${1##*/};; esac\n shift\ndone\n[ -n "$asset" ] && [ -n "$output" ] || exit 9\ncat "$PI_FORGE_FIXTURE_DIR/$asset" > "$output"\n',
		);
		await fs.chmod(curl, 0o700);
		const env = {
			...process.env,
			PATH: `${tools}:${process.env.PATH}`,
			PI_FORGE_FIXTURE_DIR: root,
			PI_FORGE_INSTALL_DIR: installDir,
		};
		const success = await $`sh ${installer} --ref v0.1.0`.env(env).quiet().nothrow();
		expect(success.exitCode).toBe(0);
		expect((await fs.lstat(installed)).isSymbolicLink()).toBe(false);
		expect(await Bun.file(original).text()).toBe("original source launcher\n");
		const before = Bun.hash(await Bun.file(installed).arrayBuffer());
		await Bun.write(path.join(root, "SHA256SUMS"), `${"0".repeat(64)}  pi-forge-linux-x64\n`);
		const failure = await $`sh ${installer} --ref v0.1.0`.env(env).quiet().nothrow();
		expect(failure.exitCode).not.toBe(0);
		expect(Bun.hash(await Bun.file(installed).arrayBuffer())).toBe(before);
	},
);
