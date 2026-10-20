import fs from "node:fs";
import path from "node:path";
import { fixture } from "./session-work-linkage-fixture.mjs";
import { buildWorldModel } from "../../scripts/lib/world-model.mjs";
import { updateProjectDirection } from "../../scripts/lib/project-direction.mjs";
import { readGraphProject } from "../../scripts/lib/discovery-index.mjs";

// Shared synthetic input for source and actual-browser checks. No user records.
export async function explorerFixture(t, { history = false, adversarial = false } = {}) {
  const f = fixture(t, "Investigate relay; do not deploy");
  fs.mkdirSync(path.join(f.root, "src"));
  fs.writeFileSync(path.join(f.root, "src/main.mjs"), "import { relay } from './relay.mjs';\nexport function run(value) { return relay(value); }\n");
  fs.writeFileSync(path.join(f.root, "src/relay.mjs"), "export function relay(value) { return value; }\n");
  const label = "긴 한국어 목적: 입력 경로와 이전 판단을 보존하며 관련 코드 근거를 확인합니다. ".repeat(5);
  const attack = "</script><img src='https://example.invalid/pixel' onerror='globalThis.graphXss=1'><svg onload='globalThis.graphXss=1'>";
  updateProjectDirection({ root: f.root, input: { goal: adversarial ? `relay ${attack}` : label,
    constraints: ["Synthetic local evidence only"], cancelledActions: ["Do not deploy", "기존 기록을 삭제하지 말 것"] } });
  f.save({ summary: "Local investigation result", judgments: [{ assessment: "Inspect relay before editing", reason: "Keep exact prior rationale" }],
    pending: ["Check caller evidence"], unknowns: ["External outcome remains unverified"] });
  await buildWorldModel({ root: f.root });
  if (history) {
    fs.appendFileSync(path.join(f.root, "src/relay.mjs"), "\n// second retained revision\n");
    await buildWorldModel({ root: f.root });
  }
  return { ...f, projectId: readGraphProject(f.root).project.projectId, label, attack };
}
