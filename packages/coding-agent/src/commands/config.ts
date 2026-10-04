/**
 * Manage configuration settings.
 */

import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { configHelp as commandHelp } from "../cli/command-help";
import { type ConfigAction, type ConfigCommandArgs, runConfigCommand } from "../cli/config-cli";
import { importOmpData } from "../cli/import-omp";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

const ACTIONS: ConfigAction[] = ["list", "get", "set", "reset", "path", "init-xdg", "import-omp"];

export default class Config extends Command {
	static description = commandHelp.description;
	static args = {
		action: Args.string({
			description: "Config action",
			required: false,
			options: ACTIONS,
		}),
		key: Args.string({
			description: "Setting key",
			required: false,
		}),
		value: Args.string({
			description: "Value (for set/reset)",
			required: false,
			multiple: true,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON" }),
		from: Flags.string({ description: "OMP configuration root to import" }),
		sessions: Flags.boolean({ description: "Include saved sessions" }),
		assets: Flags.boolean({ description: "Include custom agents, skills, rules, themes and extensions" }),
		"dry-run": Flags.boolean({ description: "Preview import without copying data" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Config);
		if (args.action === "import-omp") {
			console.log(
				JSON.stringify(
					await importOmpData({
						from: flags.from,
						sessions: flags.sessions,
						assets: flags.assets,
						dryRun: flags["dry-run"],
					}),
					null,
					2,
				),
			);
			return;
		}
		const action = (args.action ?? "list") as ConfigAction;
		const value = Array.isArray(args.value) ? args.value.join(" ") : args.value;

		const cmd: ConfigCommandArgs = {
			action,
			key: args.key,
			value,
			flags: {
				json: flags.json,
			},
		};

		await initTheme();
		await runConfigCommand(cmd);
	}
}
