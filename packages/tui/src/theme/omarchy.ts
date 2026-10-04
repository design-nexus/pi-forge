import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import dark from "./defaults/dark-catppuccin.json" with { type: "json" };
import light from "./defaults/light-catppuccin.json" with { type: "json" };
import type { ThemeJson } from "./schema";

/** Resolve the current and legacy palette paths without changing desktop settings. */
export function omarchyPalettePaths(
	home = os.homedir(),
	state = process.env.XDG_STATE_HOME,
	config = process.env.XDG_CONFIG_HOME,
): string[] {
	return [
		path.join(state || path.join(home, ".local/state"), "omarchy/current/theme/colors.toml"),
		path.join(config || path.join(home, ".config"), "omarchy/current/theme/colors.toml"),
	];
}

/** Build a complete semantic theme from Omarchy's palette, including custom themes. */
export function parseOmarchyTheme(content: string): ThemeJson {
	const parsed: unknown = Bun.TOML.parse(content);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Omarchy palette");
	const palette = parsed as Record<string, unknown>;
	const color = (key: string, fallback?: string): string => {
		const value = palette[key];
		if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
		if (value === undefined && fallback !== undefined) return fallback;
		throw new Error(`Invalid Omarchy color: ${key}`);
	};
	const bg = color("background");
	const fg = color("foreground");
	const mode = palette.mode;
	if (mode !== "dark" && mode !== "light") throw new Error("Invalid Omarchy mode");
	const base = structuredClone(mode === "light" ? light : dark) as ThemeJson;
	const muted = color("muted", fg);
	base.name = "omarchy";
	base.vars = {
		...base.vars,
		base: bg,
		mantle: color("dark_background", bg),
		crust: color("darker_background", bg),
		surface0: color("lighter_background", bg),
		surface1: color("selection", bg),
		surface2: muted,
		text: fg,
		subtext0: color("dark_foreground", muted),
		subtext1: color("light_foreground", fg),
		overlay0: muted,
		overlay1: muted,
		overlay2: muted,
		blue: color("blue", color("accent", fg)),
		lavender: color("accent", fg),
		mauve: color("magenta", fg),
		pink: color("magenta", fg),
		peach: color("orange", color("yellow", fg)),
		yellow: color("yellow", fg),
		green: color("green", fg),
		red: color("red", fg),
		maroon: color("red", fg),
		teal: color("cyan", fg),
		sky: color("cyan", fg),
		sapphire: color("blue", fg),
	};
	base.colors.accent = color("accent", fg);
	for (const key of Object.keys(base.colors) as (keyof ThemeJson["colors"])[]) {
		if (base.colors[key] === "") base.colors[key] = fg;
	}
	base.export = { pageBg: bg, cardBg: color("dark_background", bg), infoBg: color("lighter_background", bg) };
	return base;
}

export function readOmarchyTheme(paths = omarchyPalettePaths()): ThemeJson | undefined {
	for (const file of paths) {
		try {
			return parseOmarchyTheme(fs.readFileSync(file, "utf8"));
		} catch {
			/* unavailable or being replaced */
		}
	}
	return undefined;
}

/** watchFile follows replaced directories/symlinks and can recover after disappearance. */
export function watchOmarchyTheme(onTheme: (value: ThemeJson) => void, paths = omarchyPalettePaths()): () => void {
	let previous = "";
	const refresh = () => {
		const value = readOmarchyTheme(paths);
		if (!value) return;
		const fingerprint = JSON.stringify(value);
		if (fingerprint === previous) return;
		previous = fingerprint;
		onTheme(value);
	};
	for (const file of paths) fs.watchFile(file, { persistent: false, interval: 500 }, refresh);
	refresh();
	return () => {
		for (const file of paths) fs.unwatchFile(file, refresh);
	};
}
