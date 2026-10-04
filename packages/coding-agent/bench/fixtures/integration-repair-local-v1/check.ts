import assert from "node:assert/strict";
import { combined } from "./combined";
import { scale } from "./scale";

assert.equal(scale(2), 4, "the first worker must double its input");
if (!process.argv.includes("--scale-only")) {
	assert.equal(combined(2), 12, "the consumer must multiply the shared result by three");
	assert.equal(combined(-1), -6, "the combined contract must preserve negative inputs");
}
