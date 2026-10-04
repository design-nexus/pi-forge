import { expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "../src/tools/bash";

function makeTool(): BashTool {
	return new BashTool({
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
	} as unknown as ToolSession);
}

it("does not add verification metadata to an ordinary command when verification is explicitly false", async () => {
	const result = await makeTool().execute("ordinary", { command: "exit 0", verification: false });
	expect(result.isError).not.toBe(true);
	expect(result.details).not.toHaveProperty("verification");
});

it("accepts a foreground verification command with async explicitly false", async () => {
	const result = await makeTool().execute("foreground", { command: "exit 0", verification: true, async: false });
	expect(result.isError).not.toBe(true);
	expect(result.details).toMatchObject({ verification: { passed: true } });
});
