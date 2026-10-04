import { expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "../src/tools/bash";

function makeSession(autoBackground: boolean): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		skills: [],
		getSessionFile: () => null,
		settings: Settings.isolated({
			"async.enabled": true,
			"bash.autoBackground.enabled": autoBackground,
			"bashInterceptor.enabled": false,
			"astGrep.enabled": false,
			"astEdit.enabled": false,
			"grep.enabled": false,
			"glob.enabled": false,
		}),
		getClientBridge: () => undefined,
	} as unknown as ToolSession;
}

it("keeps ordinary foreground commands usable with auto-background enabled and no job manager", async () => {
	const tool = new BashTool(makeSession(true));
	const result = await tool.execute("ordinary", { command: "exit 0" });
	expect(result.isError).not.toBe(true);
	expect(result.details).not.toHaveProperty("verification");
});

it("reports verification failure when a foreground command times out", async () => {
	const tool = new BashTool(makeSession(false));
	const result = await tool.execute("timeout", { command: "sleep 2", timeout: 0.05, verification: true });
	expect(result.isError).toBe(true);
	expect(result.details).toMatchObject({ verification: { passed: false } });
});
