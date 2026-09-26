import { Markdown } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme } from "@oh-my-pi/pi-tui/theme";
import { replaceTabs } from "@oh-my-pi/pi-tui/render/render-utils";
import { promptCompare, promptInspect, promptStats } from "../prompt-engine/inspection";
import { PromptSetupOverlay } from "../prompt-engine/setup-overlay";
import { cfgPromptCapabilities, cfgPromptModules, cfgPromptProfile } from "../prompt-engine/settings";
import { commandConsumed, parseSubcommand, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

export const BUILTIN_PROMPT_SLASH_COMMANDS: readonly SlashCommandSpec[] = [
	{
		name: "prompt",
		icon: "settings",
		description: "Inspect and configure system-prompt modules",
		allowArgs: true,
		subcommands: [
			{ name: "stats", description: "Show loaded modules and token counts" },
			{ name: "compare", description: "Compare prompt profiles using this session's context and tools" },
			{ name: "inspect", description: "Show the assembled system prompt; supports --redact" },
			{ name: "setup", description: "Configure a prompt profile and module policies" },
		],
		handle: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			if ((!verb || verb === "stats") && !rest) {
				await runtime.output(promptStats(runtime.session));
				return commandConsumed();
			}
			if (verb === "inspect" && (!rest || rest === "--redact")) {
				await runtime.output(promptInspect(runtime.session, { redact: rest === "--redact" }));
				return commandConsumed();
			}
			if (verb === "compare" && !rest) {
				await runtime.output(promptCompare(runtime.session));
				return commandConsumed();
			}
			if (verb === "setup" && !rest) {
				await runtime.output("/prompt setup requires the interactive terminal UI.");
				return commandConsumed();
			}
			return usage("Usage: /prompt [stats|compare|inspect [--redact]|setup]", runtime);
		},
		handleTui: async (command, runtime) => {
			const { verb, rest } = parseSubcommand(command.args);
			const ctx = runtime.ctx;
			ctx.editor.setText("");
			if ((!verb || verb === "stats") && !rest) {
				ctx.presentCommandOutput(new Markdown(replaceTabs(promptStats(ctx.session)), 1, 1, getMarkdownTheme()));
				return;
			}
			if (verb === "inspect" && (!rest || rest === "--redact")) {
				ctx.presentCommandOutput(new Markdown(replaceTabs(promptInspect(ctx.session, { redact: rest === "--redact" })), 1, 1, getMarkdownTheme()));
				return;
			}
			if (verb === "compare" && !rest) {
				ctx.presentCommandOutput(new Markdown(replaceTabs(promptCompare(ctx.session)), 1, 1, getMarkdownTheme()));
				return;
			}
			if (verb !== "setup" || rest) {
				ctx.showError("Usage: /prompt [stats|compare|inspect [--redact]|setup]");
				return;
			}
			const overlayState: { handle?: { hide(): void } } = {};
			const close = () => {
				overlayState.handle?.hide();
				ctx.ui.setFocus(ctx.editor);
				ctx.ui.requestRender();
			};
			const overlay = new PromptSetupOverlay(
				ctx.session,
				ctx.session.promptSettingsOverride?.profile ?? cfgPromptProfile.get(ctx.settings),
				ctx.session.promptSettingsOverride?.modules ?? cfgPromptModules.get(ctx.settings),
				ctx.session.promptSettingsOverride?.capabilities ?? cfgPromptCapabilities.get(ctx.settings),
				async (scope, profile, overrides, capabilities) => {
					try {
						if (scope === "session") {
							await ctx.session.setPromptSettingsOverride({ profile, modules: overrides, capabilities });
						} else if (scope === "project") {
							ctx.settings.setProjectValue(cfgPromptProfile, profile);
							ctx.settings.setProjectValue(cfgPromptModules, overrides);
							ctx.settings.setProjectValue(cfgPromptCapabilities, capabilities);
						} else {
							cfgPromptProfile.set(ctx.settings, profile);
							cfgPromptModules.set(ctx.settings, overrides);
							cfgPromptCapabilities.set(ctx.settings, capabilities);
						}
						await ctx.settings.flush();
						await ctx.session.refreshBaseSystemPrompt();
						close();
						ctx.showStatus(`Saved ${profile} prompt profile to ${scope} configuration.`);
					} catch (error) {
						ctx.showError(error instanceof Error ? error.message : String(error));
					}
				},
				close,
				() => ctx.ui.requestRender(),
			);
			overlayState.handle = ctx.ui.showOverlay(overlay, { anchor: "bottom-center", width: "80%", maxHeight: "80%" });
			ctx.ui.setFocus(overlay);
			ctx.ui.requestRender();
		},
	},
];
