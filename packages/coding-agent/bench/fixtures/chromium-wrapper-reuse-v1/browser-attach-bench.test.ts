import { expect, test } from "bun:test";
import { $ } from "bun";
import { $which } from "@oh-my-pi/pi-utils";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findReusableCdp } from "../../src/tools/browser/attach";

test.skipIf(process.platform !== "linux" || !$which("cc"))(
	"reuses Chromium launched through a compiled distro wrapper",
	async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-browser-wrapper-bench-"));
		const wrapper = path.join(root, "google-chrome");
		const target = path.join(root, "chrome");
		const profile = path.join(root, "profile");
		const cdp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("{}") });
		await Bun.write(target, Bun.file(process.execPath));
		await fs.chmod(target, 0o755);
		const source = path.join(root, "launcher.c");
		await Bun.write(
			source,
			`#include <stdlib.h>\n#include <unistd.h>\nint main(int argc, char **argv) { setenv("CHROME_WRAPPER", argv[0], 1); return execv(${JSON.stringify(target)}, argv); }\n`,
		);
		await $`${$which("cc")!} ${source} -o ${wrapper}`.quiet();
		const child = Bun.spawn(
			[
				wrapper,
				"--eval",
				'process.stdout.write("ready\\n"); await Bun.stdin.text()',
				`--user-data-dir=${profile}`,
				`--remote-debugging-port=${cdp.port}`,
			],
			{
				stdin: "pipe",
				stdout: "pipe",
				stderr: "ignore",
			},
		);
		const readiness = child.stdout.getReader();
		await readiness.read();
		readiness.releaseLock();
		try {
			expect(await findReusableCdp(wrapper, { appArgs: [`--user-data-dir=${profile}`] })).toEqual({
				cdpUrl: `http://127.0.0.1:${cdp.port}`,
				pid: child.pid,
			});
		} finally {
			child.kill();
			await child.exited;
			cdp.stop(true);
			await fs.rm(root, { recursive: true, force: true });
		}
	},
);
