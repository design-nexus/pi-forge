import { afterEach, expect, it, vi } from "bun:test";
import * as omarchy from "../src/theme/omarchy";
import type { ThemeJson } from "../src/theme/schema";
import {
	getCurrentThemeName,
	getThemeEpoch,
	initTheme,
	setSymbolPreset,
	setThemeSource,
	stopThemeWatcher,
	theme,
	onTerminalAppearanceChange,
} from "../src/theme/theme";

afterEach(async () => {
	stopThemeWatcher();
	vi.restoreAllMocks();
	setThemeSource("terminal");
	await initTheme(false);
	stopThemeWatcher();
});
it("following Omarchy keeps its palette across terminal changes and glyph changes, then disposes on switching back", async () => {
	const first = omarchy.parseOmarchyTheme('mode="dark"\nbackground="#102030"\nforeground="#cdd6f4"\naccent="#89b4fa"');
	const second = omarchy.parseOmarchyTheme(
		'mode="light"\nbackground="#eff1f5"\nforeground="#4c4f69"\naccent="#8839ef"',
	);
	let emit: ((value: ThemeJson) => void) | undefined;
	const dispose = vi.fn(() => {});
	vi.spyOn(omarchy, "readOmarchyTheme").mockReturnValue(first);
	vi.spyOn(omarchy, "watchOmarchyTheme").mockImplementation(callback => {
		emit = callback;
		return dispose;
	});
	await initTheme(false);
	setThemeSource("omarchy");
	const before = getThemeEpoch();
	onTerminalAppearanceChange("light");
	expect(getCurrentThemeName()).toBe("omarchy");
	expect(getThemeEpoch()).toBe(before);
	emit?.(second);
	expect(theme.isLight).toBe(true);
	expect(getThemeEpoch()).toBeGreaterThan(before);
	vi.spyOn(omarchy, "readOmarchyTheme").mockReturnValue(undefined);
	await setSymbolPreset("ascii");
	expect(theme.isLight).toBe(true);
	expect(theme.getSymbolPreset()).toBe("ascii");
	setThemeSource("terminal");
	await Bun.sleep(0);
	expect(dispose).toHaveBeenCalledTimes(1);
	expect(getCurrentThemeName()).not.toBe("omarchy");
});
