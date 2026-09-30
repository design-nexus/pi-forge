import { Markdown } from "@oh-my-pi/pi-tui";
import { getMarkdownTheme } from "@oh-my-pi/pi-tui/theme";
import { replaceTabs } from "@oh-my-pi/pi-tui/render/render-utils";
import { promptCompare, promptInspect, promptStats } from "../prompt-engine/inspection";
import type { ToolCapabilityRouteRequest } from "../prompt-engine/capability-router";
import { PromptSetupOverlay } from "../prompt-engine/setup-overlay";
import { cfgPromptCapabilities, cfgPromptModules, cfgPromptProfile } from "../prompt-engine/settings";
import type { AgentSession } from "../session/agent-session";
import { commandConsumed, parseSubcommand, usage } from "./helpers/parse";
import type { SlashCommandSpec } from "./types";

const ROUTABLE_PROMPT_CAPABILITIES = new Set(["lsp", "subagents", "debugger", "github", "images", "browser", "mcp"]);

function parseCapabilityRoute(value: string): ToolCapabilityRouteRequest | undefined {
	const [id, toolName, ...extra] = value.trim().split(/\s+/u);
	if (!id || extra.length > 0 || !ROUTABLE_PROMPT_CAPABILITIES.has(id)) return undefined;
	if (id === "mcp") {
		return toolName ? { id, toolName, signal: "explicit" } : undefined;
	}
	if (toolName) return undefined;
	return { id: id as ToolCapabilityRouteRequest["id"], signal: "explicit" };
}

async function routePromptCapability(session: AgentSession, value: string, release = false): Promise<string> {
	const request = parseCapabilityRoute(value);
	if (!request) return "Usage: /prompt route <lsp|subagents|debugger|github|images|browser|mcp mcp__server_tool>";
	try {
		const decision = release
			? await session.releaseToolCapability(request)
			: await session.routeToolCapability(request);
		const activation = release
			? decision.reason.endsWith("activation released")
				? "released"
				: decision.state
			: decision.selected
				? "activated"
				: decision.state;
		const cost = release ? undefined : decision.estimatedActivationTokens;
		const costText = cost === undefined ? "" : ` · estimated activation ${cost.toLocaleString()} tokens`;
		return `Capability ${decision.id}: ${activation} · ${decision.reason}${costText}`;
	} catch (error) {
		return `Capability routing failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

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
			{ name: "route", description: "Activate a capability for this session" },
			{ name: "unroute", description: "Restore a capability's prior session presentation" },
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
			if (verb === "route" && rest) {
				await runtime.output(await routePromptCapability(runtime.session, rest));
				return commandConsumed();
			}
			if (verb === "unroute" && rest) {
				await runtime.output(await routePromptCapability(runtime.session, rest, true));
				return commandConsumed();
			}
			if (verb === "setup" && !rest) {
				await runtime.output("/prompt setup requires the interactive terminal UI.");
				return commandConsumed();
			}
			return usage("Usage: /prompt [stats|compare|inspect [--redact]|route|unroute <capability>|setup]", runtime);
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
				ctx.presentCommandOutput(
					new Markdown(
						replaceTabs(promptInspect(ctx.session, { redact: rest === "--redact" })),
						1,
						1,
						getMarkdownTheme(),
					),
				);
				return;
			}
			if (verb === "compare" && !rest) {
				ctx.presentCommandOutput(new Markdown(replaceTabs(promptCompare(ctx.session)), 1, 1, getMarkdownTheme()));
				return;
			}
			if (verb === "route" && rest) {
				try {
					const message = await routePromptCapability(ctx.session, rest);
					ctx.presentCommandOutput(new Markdown(replaceTabs(message), 1, 1, getMarkdownTheme()));
				} catch (error) {
					ctx.showError(error instanceof Error ? error.message : String(error));
				}
				return;
			}
			if (verb === "unroute" && rest) {
				const message = await routePromptCapability(ctx.session, rest, true);
				ctx.presentCommandOutput(new Markdown(replaceTabs(message), 1, 1, getMarkdownTheme()));
				return;
			}
			if (verb !== "setup" || rest) {
				ctx.showError("Usage: /prompt [stats|compare|inspect [--redact]|route|unroute <capability>|setup]");
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
