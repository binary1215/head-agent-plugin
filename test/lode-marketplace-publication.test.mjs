import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { artifactCompositionForIdentity } from "../scripts/lib/lode-artifact-composition.mjs";
import { buildCodexMarketplaceSnapshot, verifyCodexMarketplaceSnapshot } from "../scripts/lib/codex-marketplace.mjs";
import { buildClaudeMarketplaceSnapshot, verifyClaudeMarketplaceSnapshot } from "../scripts/lib/claude-marketplace.mjs";

const source = path.resolve(import.meta.dirname, "..");
const read = relative => fs.readFileSync(path.join(source, relative), "utf8");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function inventory(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file).replaceAll("\\", "/"), hash(fs.readFileSync(file))];
    }).sort(([a], [b]) => a.localeCompare(b));
}
function fixture(t) {
  const parent = fs.realpathSync(process.env.LODE_AGENT_TEST_TMP || process.env.HEAD_AGENT_TEST_TMP || os.tmpdir());
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, "lode-marketplace-publication-")));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert(path.basename(root).startsWith("lode-marketplace-publication-"));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 20 : 0, retryDelay: 100 });
  });
  return root;
}

test("CI publishes canonical and compatibility identities to separate exact branches", () => {
  const workflow = read(".github/workflows/go-worker-build-release.yml");
  for (const [job, next, provider] of [["marketplace", "claude_marketplace", "codex"], ["claude_marketplace", null, "claude"]]) {
    const start = workflow.indexOf(`  ${job}:\n`);
    assert(start >= 0);
    const body = workflow.slice(start, next ? workflow.indexOf(`  ${next}:\n`, start) : undefined);
    const rows = [...body.matchAll(/- identity: (\w+)\n +marketplace_name: ([\w-]+)\n +branch: ([\w-]+)/g)]
      .map(([, identity, name, branch]) => ({ identity, name, branch }));
    assert.deepEqual(rows, [
      { identity: "lode", name: "lode-agent-plugin", branch: `lode-${provider}-marketplace` },
      { identity: "head", name: "head-agent-plugin", branch: `${provider}-marketplace` },
    ]);
    assert(body.includes("fail-fast: false"), "One carrier's failure must not cancel its independent sibling");
    for (const expected of [
      "MARKETPLACE_BRANCH: ${{ matrix.branch }}", "MARKETPLACE_NAME: ${{ matrix.marketplace_name }}",
      '--marketplace-name "${MARKETPLACE_NAME}"', '--expected-marketplace-name "${MARKETPLACE_NAME}"',
      '--source-commit "${GITHUB_SHA}"', "--require-native", "--native-root",
      '--force-with-lease="refs/heads/${MARKETPLACE_BRANCH}:${EXPECTED_SHA}"',
      'if [[ "${MARKETPLACE_NAME}" != "head-agent-plugin" ]]; then exit 1; fi',
    ]) assert(body.includes(expected), `${job} missing ${expected}`);
    assert.match(body, /MARKETPLACE_NAME.*head-agent-plugin.*GITHUB_REPOSITORY.*binary1215\/lode.*expected_sha/);
    assert(body.indexOf('if [[ "${MARKETPLACE_NAME}" != "head-agent-plugin" ]]') < body.indexOf("node legacy/marketplace-ownership/verify.mjs"));
    assert.match(body, /needs\.javascript\.result == 'success'.*needs\.host_smoke\.result == 'success'/);
  }
});

test("English and Korean defaults use Lode installation, while legacy updates stay documented", () => {
  for (const file of ["README.md", "README.ko.md"]) {
    const text = read(file);
    for (const command of [
      "codex plugin marketplace add binary1215/lode --ref lode-codex-marketplace",
      "codex plugin add lode-agent-core@lode-agent-plugin",
      "claude plugin marketplace add binary1215/lode@lode-claude-marketplace",
      "claude plugin install lode-agent-core@lode-agent-plugin",
      "codex plugin marketplace upgrade head-agent-plugin",
      "claude plugin update head-agent-core@head-agent-plugin",
    ]) assert(text.includes(command), `${file}: ${command}`);
    assert(text.indexOf("lode-agent-core@lode-agent-plugin") < text.indexOf("head-agent-core@head-agent-plugin"));
  }
  for (const prefix of ["docs/", "docs/ko/"]) {
    for (const provider of ["codex", "claude"]) {
      const text = read(`${prefix}${provider}-marketplace.md`);
      assert(text.includes(`lode-${provider}-marketplace`));
      assert(text.includes("lode-agent-core@lode-agent-plugin"));
      assert(text.includes("head-agent-core@head-agent-plugin"));
      assert(text.indexOf("lode-agent-core@lode-agent-plugin") < text.indexOf("head-agent-core@head-agent-plugin"));
    }
  }
});

for (const [provider, build, verify, catalogPath] of [
  ["codex", buildCodexMarketplaceSnapshot, verifyCodexMarketplaceSnapshot, ".agents/plugins/marketplace.json"],
  ["claude", buildClaudeMarketplaceSnapshot, verifyClaudeMarketplaceSnapshot, ".claude-plugin/marketplace.json"],
]) {
  test(`${provider} snapshots keep separate install IDs, manifests, Skills and one tool vocabulary`, async t => {
    const root = fixture(t), oldRoot = path.join(root, "existing-head-address");
    const options = { sourceRoot: source, repository: "binary1215/lode", commit: "a".repeat(40) };
    const old = build({ ...options, outputRoot: oldRoot, name: "head-agent-plugin" });
    const original = inventory(oldRoot);
    for (const identity of ["lode", "head"]) {
      const composition = artifactCompositionForIdentity(identity);
      const outputRoot = identity === "head" ? oldRoot : path.join(root, "new-lode-address");
      const built = identity === "head" ? old : build({ ...options, outputRoot, name: composition.marketplaceName });
      assert.deepEqual(verify({ root: outputRoot, expectedRepository: options.repository, expectedMarketplaceName: composition.marketplaceName }), built);
      const catalog = JSON.parse(fs.readFileSync(path.join(outputRoot, catalogPath), "utf8"));
      assert.equal(catalog.name, composition.marketplaceName);
      assert.equal(catalog.plugins.length, 1);
      assert.equal(catalog.plugins[0].name, composition.pluginName);
      assert.deepEqual(fs.readdirSync(path.join(outputRoot, "plugins")), [composition.pluginName]);
      const pluginRoot = path.join(outputRoot, "plugins", composition.pluginName);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).engines,
        JSON.parse(read("package.json")).engines, "Declared Node support must survive all four package projections");
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8")).mcpServers), ["lode"]);
      assert.deepEqual(fs.readdirSync(path.join(pluginRoot, "skills")).sort(), Object.values(composition.skills).sort());
      const staged = await import(pathToFileURL(path.join(pluginRoot, "scripts/mcp-server.mjs")).href);
      assert(staged.tools.every(tool => tool.name.startsWith(composition.toolPrefix)));
      assert.equal(new Set(staged.tools.map(tool => tool.name)).size, staged.tools.length);
      assert.equal((await staged.dispatch({ id: 1, method: "initialize", params: {} })).result.serverInfo.name, "lode");
      assert.throws(() => verify({ root: outputRoot, expectedMarketplaceName: identity === "head" ? "lode-agent-plugin" : "head-agent-plugin" }));
      assert.throws(() => verify({ root: outputRoot, requireNativeBundle: true }), "Source-only snapshots cannot pass a native publication check");
      const marker = JSON.parse(fs.readFileSync(path.join(outputRoot, `.${identity}-agent-${provider === "claude" ? "claude-" : ""}marketplace-generated.json`), "utf8"));
      assert.equal(marker.sourceCommit, options.commit);
      assert.equal(marker.pluginName, composition.pluginName);
      assert.equal(marker.marketplaceName, composition.marketplaceName);
    }
    assert.deepEqual(inventory(oldRoot), original, "Canonical generation/verification cannot mutate a sibling HEAD snapshot");
  });
}
