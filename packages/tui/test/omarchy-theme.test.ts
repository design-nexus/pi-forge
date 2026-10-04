import { afterEach, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseOmarchyTheme, readOmarchyTheme, watchOmarchyTheme } from "../src/theme/omarchy";
import { createTheme } from "../src/theme/loader";
import type { ThemeJson } from "../src/theme/schema";

const temporary: string[] = [];
const disposals: (() => void)[] = [];
afterEach(async () => {
	for (const stop of disposals.splice(0)) stop();
	await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});
const palette = (background: string, mode = "dark") =>
	`mode = "${mode}"\nbackground = "${background}"\nforeground = "#cdd6f4"\naccent = "#89b4fa"\nred = "#f38ba8"\ngreen = "#a6e3a1"\n`;
it("transforms dark and light desktop palettes into complete rendered themes", () => {
	const dark = createTheme(parseOmarchyTheme(palette("#102030")), { mode: "truecolor" });
	expect(dark.fg("accent", "text")).toContain("38;2;137;180;250");
	const light = createTheme(parseOmarchyTheme(palette("#f0f0f0", "light")), { mode: "truecolor" });
	expect(light.fg("error", "failure")).toContain("38;2;243;139;168");
	expect(() => parseOmarchyTheme(palette("invalid"))).toThrow("background");
});
it("falls back to the legacy palette location when current state is unavailable", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-palette-"));
	temporary.push(root);
	const current = path.join(root, "current/colors.toml");
	const legacy = path.join(root, "legacy/colors.toml");
	await Bun.write(legacy, palette("#102030", "light"));
	expect(readOmarchyTheme([current, legacy])?.vars?.base).toBe("#102030");
});
it("follows replaced palette files, retains valid data through malformed writes, and stops after disposal", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "forge-theme-watch-"));
	temporary.push(root);
	const file = path.join(root, "colors.toml");
	await Bun.write(file, palette("#102030"));
	const values: ThemeJson[] = [];
	const changed = Promise.withResolvers<void>();
	const stop = watchOmarchyTheme(
		value => {
			values.push(value);
			if (value.vars?.base === "#203040") changed.resolve();
		},
		[file],
	);
	disposals.push(stop);
	await Bun.write(file, "malformed = [");
	await Bun.sleep(650);
	expect(values.map(value => value.vars?.base)).toEqual(["#102030"]);
	await Bun.write(path.join(root, "next.toml"), palette("#203040"));
	await fs.rename(path.join(root, "next.toml"), file);
	await changed.promise;
	expect(values.map(value => value.vars?.base)).toEqual(["#102030", "#203040"]);
	stop();
	await Bun.write(file, palette("#304050"));
	await Bun.sleep(650);
	expect(values.map(value => value.vars?.base)).toEqual(["#102030", "#203040"]);
}, 5000);
