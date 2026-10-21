import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { discoverTools } from "../scripts/mcp-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("architecture and recovery guidance preserve whole-Run integration, not per-member checkpoint gates", () => {
  for (const name of ["architecture.md", "session-recovery.md"]) {
    const english = read(`docs/${name}`), korean = read(`docs/ko/${name}`);
    assert.match(english, /one whole Run ResultPacket/u, name);
    assert.match(korean, /하나의 전체 Run ResultPacket/u, name);
    for (const text of [english, korean]) {
      assert(text.includes("ReviewDecision")); assert(text.includes("HF-010"));
      assert(text.includes("authorization")); assert(text.includes("lease"));
      assert(text.includes("bounded-worker-wave.md"));
    }
    assert.doesNotMatch(english, /each member still requires its own ResultPacket|checkpoint integration independently/u);
    assert.doesNotMatch(korean, /각 구성원에는 여전히 자체 ResultPacket|체크포인트 통합을 독립적으로 거칩니다/u);
  }
});

test("architecture documents the existing typed user-review operation without giving reads promotion authority", () => {
  const discovery = discoverTools({ name: "lode_onboarding_review" }, "ordinary"), review = discovery.tools[0];
  assert.equal(discovery.grantsAuthorization, false);
  assert(review); assert.equal(review.annotations.readOnlyHint, false); assert.equal(review.invokeWith, "lode_tools_call");
  assert.equal(review.executionMode, undefined, "Product review is not worker-managed execution");
  for (const name of ["lode_onboarding_status", "lode_project_graph"]) {
    assert.equal(discoverTools({ name }, "ordinary").tools[0].annotations.readOnlyHint, true);
  }
  for (const name of ["docs/architecture.md", "docs/ko/architecture.md"]) {
    const text = read(name);
    assert(text.includes("`lode_onboarding_review`")); assert(text.includes("`decisionScope: product-canon-bootstrap`"));
    assert.doesNotMatch(text, /Only a CLI-supplied|CLI로 제공되고/u);
  }
  assert.match(read("docs/architecture.md"), /explicit user-authored `ReviewDecision`/u);
  assert.match(read("docs/architecture.md"), /Read-only status and graph operations cannot review or promote/u);
});
