import { describe, expect, it } from "bun:test";
import { auditStorage } from "../src/audit.ts";
import { cacheStorage } from "../src/cache.ts";
import { historyStorage } from "../src/history.ts";
import { projectStorage } from "../src/project.ts";

describe("migrated storage contract", () => {
	it("preserves write access and paths for cache and project storage", () => {
		expect(cacheStorage("/work")).toEqual({ path: "/work/cache", mode: "write" });
		expect(projectStorage("/work")).toEqual({ path: "/work/project", mode: "write" });
	});

	it("keeps history storage read-only under the new mode contract", () => {
		expect(historyStorage("/work")).toEqual({ path: "/work/history", mode: "read" });
	});
	it("keeps audit storage read-only and preserves its path", () => {
		expect(auditStorage("/work")).toEqual({ path: "/work/audit", mode: "read" });
	});
});
