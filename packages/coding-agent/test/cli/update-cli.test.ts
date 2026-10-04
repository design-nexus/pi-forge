import { afterEach, describe, expect, it, vi } from "bun:test";
import { getLatestRelease, resolveForgeRelease, runUpdateCommand } from "../../src/cli/update-cli";

afterEach(() => vi.restoreAllMocks());

describe("Pi Forge release lookup", () => {
	it("queries only Forge releases with cancellation and selects binary updates", async () => {
		const urls: string[] = [];
		let signal: AbortSignal | null | undefined;
		const release = await getLatestRelease({
			fetchImpl: async (input, init) => {
				urls.push(String(input));
				signal = init?.signal;
				return Response.json({ tag_name: "v0.1.1", draft: false, prerelease: false });
			},
		});
		expect(urls).toEqual(["https://api.github.com/repos/design-nexus/pi-forge/releases/latest"]);
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(release.version).toBe("0.1.1");
		expect(release.dist).toBe("binary");
	});
	it("does not fall back to OMP or npm when Forge has no releases", async () => {
		const urls: string[] = [];
		await expect(
			getLatestRelease({
				fetchImpl: async input => {
					urls.push(String(input));
					return new Response(null, { status: 404 });
				},
			}),
		).rejects.toThrow("no OMP fallback");
		expect(urls).toEqual(["https://api.github.com/repos/design-nexus/pi-forge/releases/latest"]);
	});
	it("rejects drafts and prereleases on stable while canary can select a published prerelease", async () => {
		expect(() => resolveForgeRelease({ tag_name: "v0.1.1", draft: true, prerelease: false }, "stable")).toThrow();
		expect(() =>
			resolveForgeRelease({ tag_name: "v0.2.0-beta.1", draft: false, prerelease: true }, "stable"),
		).toThrow();
		const release = await getLatestRelease({
			channel: "canary",
			fetchImpl: async () =>
				Response.json([
					{ tag_name: "v0.3.0", draft: true, prerelease: false },
					{ tag_name: "v0.2.0-beta.1", draft: false, prerelease: true },
				]),
		});
		expect(release.version).toBe("0.2.0-beta.1");
	});
	it("checks the app release without installing on --check", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const fetchStub = Object.assign(
			async () => Response.json({ tag_name: "v0.1.1", draft: false, prerelease: false }),
			{ preconnect: globalThis.fetch.preconnect },
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);
		await runUpdateCommand({ force: false, check: true });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});
it("source updates explain manual checkout updates without fetching or replacing the installation", async () => {
	const output: string[] = [];
	vi.spyOn(console, "log").mockImplementation(value => output.push(String(value)));
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	await runUpdateCommand({ force: true, check: false });
	expect(fetchSpy).not.toHaveBeenCalled();
	expect(output.join("\n")).toContain("Source installation");
});
