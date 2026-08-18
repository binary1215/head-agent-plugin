import assert from "node:assert/strict";
import { summarize } from "../src/main.mjs";

assert.deepEqual(summarize(2), { doubled: 4, incremented: 3 });
