import { afterEach, expect, it, mock } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "../src/tools/bash";

afterEach(() => mock.restore());

function makeSession(): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		skills: [],
		getSessionFile: () => null,
		settings: Settings.isolated({
			"async.enabled": false,
			"bash.autoBackground.enabled": false,
			"bashInterceptor.enabled": false,
			"astGrep.enabled": false,
			"astEdit.enabled": false,
			"grep.enabled": false,
			"glob.enabled": false,
		}),
		getClientBridge: () => undefined,
	} as unknown as ToolSession;
}

it("reports verification success and failure while leaving ordinary results unmarked", async () => {
	const tool = new BashTool(makeSession());
	const passed = await tool.execute("passed", { command: "exit 0", verification: true });
	const failed = await tool.execute("failed", { command: "exit 7", verification: true });
	const ordinary = await tool.execute("ordinary", { command: "exit 7" });
	expect(passed.details).toMatchObject({ verification: { passed: true } });
	expect(failed.isError).toBe(true);
	expect(failed.details).toMatchObject({ verification: { passed: false } });
	expect(ordinary.details).not.toHaveProperty("verification");
});

it("rejects verification checks requested as asynchronous jobs or services", async () => {
	const tool = new BashTool(makeSession());
	await expect(tool.execute("async", { command: "exit 0", verification: true, async: true })).rejects.toThrow(
		/foreground/iu,
	);
	await expect(tool.execute("service", { command: "exit 0", verification: true, name: "server" })).rejects.toThrow(
		/foreground/iu,
	);
});
