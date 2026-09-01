#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexMarketplaceSnapshot, verifyCodexMarketplaceSnapshot } from "./lib/codex-marketplace.mjs";

const rootIndex = process.argv.indexOf("--root");
const providedRoot = rootIndex === -1 ? "" : process.argv[rootIndex + 1] || "";
const repositoryIndex = process.argv.indexOf("--expected-repository");
const expectedRepository = repositoryIndex === -1 ? null : process.argv[repositoryIndex + 1] || "";
const marketplaceIndex = process.argv.indexOf("--expected-marketplace-name");
const expectedMarketplaceName = marketplaceIndex === -1 ? null : process.argv[marketplaceIndex + 1] || "";
const allowLegacyBytePreservation = process.argv.includes("--allow-legacy-byte-preservation");
const requireNativeBundle = process.argv.includes("--require-native");

if (providedRoot) {
  process.stdout.write(`${JSON.stringify(verifyCodexMarketplaceSnapshot({
    root: path.resolve(providedRoot),
    expectedRepository,
    expectedMarketplaceName,
    allowLegacyBytePreservation,
    requireNativeBundle,
  }), null, 2)}\n`);
} else {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "head-agent-codex-marketplace-"));
  const snapshotRoot = path.join(temporaryRoot, "snapshot");
  try {
    const built = buildCodexMarketplaceSnapshot({ sourceRoot: path.resolve("."), outputRoot: snapshotRoot });
    const verified = verifyCodexMarketplaceSnapshot({ root: snapshotRoot });
    assert.deepEqual(verified, built);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "test")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, ".git")), false);
    assert.equal(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, "LICENSE"), "utf8").startsWith("MIT License\n"), true);
    const pluginManifestFile = path.join(snapshotRoot, "plugins", built.pluginName, ".codex-plugin", "plugin.json");
    const pluginManifestBytes = fs.readFileSync(pluginManifestFile, "utf8");
    assert.equal(JSON.parse(pluginManifestBytes).license, "MIT");

    const excessivePrompts = JSON.parse(pluginManifestBytes);
    excessivePrompts.interface.defaultPrompt.push("This fourth prompt must fail closed before Codex silently ignores it.");
    fs.writeFileSync(pluginManifestFile, `${JSON.stringify(excessivePrompts, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyCodexMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CODEX_MARKETPLACE_DEFAULT_PROMPTS_INVALID" },
    );
    fs.writeFileSync(pluginManifestFile, pluginManifestBytes, "utf8");

    const unexpectedDirectory = path.join(snapshotRoot, "plugins", built.pluginName, "unexpected-empty-directory");
    fs.mkdirSync(unexpectedDirectory);
    assert.throws(
      () => verifyCodexMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CODEX_MARKETPLACE_TREE_MISMATCH" },
    );
    fs.rmdirSync(unexpectedDirectory);

    const catalogFile = path.join(snapshotRoot, ".agents", "plugins", "marketplace.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    catalog.plugins[0].source.path = "../outside";
    fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyCodexMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CODEX_MARKETPLACE_ENTRY_INVALID" },
    );

    process.stdout.write(`${JSON.stringify({
      status: "codex_marketplace_packaging_verified",
      marketplaceName: built.marketplaceName,
      pluginName: built.pluginName,
      pluginVersion: built.pluginVersion,
      distributionReleaseId: built.distributionReleaseId,
      pluginFileCount: built.pluginFileCount,
      pathEscapeRejected: true,
      unexpectedTreeContentRejected: true,
      invalidDefaultPromptsRejected: true,
      excludedDevelopmentTrees: true,
      credentialInputsAccepted: false,
      sourceAllowlistOnly: true,
      authorityEffect: "none",
      mitLicensePackaged: true,
    }, null, 2)}\n`);
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (path.dirname(resolvedTemporaryRoot) === resolvedOsTemp
      && path.basename(resolvedTemporaryRoot).startsWith("head-agent-codex-marketplace-")) {
      fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
    }
  }
}
