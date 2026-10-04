import { describe, expect, it } from "bun:test";
import { PromptSession } from "../src/session.ts";

const browser = { name: "browser", instruction: "Use browser navigation and page inspection." };

describe("session capability transitions", () => {
	it("keeps the live prompt and tool snapshot stable until the streaming turn ends", () => {
		const session = new PromptSession();
		const before = session.snapshot();
		session.beginTurn();
		session.activate(browser);

		expect(session.snapshot()).toEqual(before);

		session.endTurn();
		expect(session.snapshot()).toEqual({
			revision: 1,
			tools: ["browser"],
			instructions: [browser.instruction],
		});
	});

	it("coalesces repeated activation into one committed prompt change", () => {
		const session = new PromptSession();
		session.beginTurn();
		session.activate(browser);
		session.activate(browser);
		session.endTurn();

		expect(session.snapshot().revision).toBe(1);
		expect(session.snapshot().tools).toEqual(["browser"]);
	});

	it("applies the last queued operation when activation is then revoked", () => {
		const session = new PromptSession();
		session.beginTurn();
		session.activate(browser);
		session.deactivate("browser");
		session.endTurn();

		expect(session.snapshot()).toEqual({ revision: 0, tools: [], instructions: [] });
	});

	it("updates prompt instructions and tools together outside a streaming turn", () => {
		const session = new PromptSession();
		session.activate(browser);
		expect(session.snapshot()).toEqual({
			revision: 1,
			tools: ["browser"],
			instructions: [browser.instruction],
		});
		session.deactivate("browser");
		expect(session.snapshot()).toEqual({ revision: 2, tools: [], instructions: [] });
	});
});
