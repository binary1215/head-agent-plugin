#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildClaudeMarketplaceSnapshot, verifyClaudeMarketplaceSnapshot } from "./lib/claude-marketplace.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || "";
}

const providedRoot = option("--root", "");
if (providedRoot) {
  process.stdout.write(`${JSON.stringify(verifyClaudeMarketplaceSnapshot({
    root: path.resolve(providedRoot),
    expectedRepository: option("--expected-repository"),
    expectedMarketplaceName: option("--expected-marketplace-name"),
    expectedCommit: option("--expected-commit"),
    requireNativeBundle: process.argv.includes("--require-native"),
  }), null, 2)}\n`);
} else {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "head-agent-claude-marketplace-"));
  const snapshotRoot = path.join(temporaryRoot, "snapshot");
  try {
    const built = buildClaudeMarketplaceSnapshot({ sourceRoot: path.resolve("."), outputRoot: snapshotRoot });
    const verified = verifyClaudeMarketplaceSnapshot({ root: snapshotRoot });
    assert.deepEqual(verified, built);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "test")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, ".git")), false);

    const unexpectedDirectory = path.join(snapshotRoot, "plugins", built.pluginName, "unexpected-empty-directory");
    fs.mkdirSync(unexpectedDirectory);
    assert.throws(
      () => verifyClaudeMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CLAUDE_MARKETPLACE_TREE_MISMATCH" },
    );
    fs.rmdirSync(unexpectedDirectory);

    assert.throws(
      () => verifyClaudeMarketplaceSnapshot({ root: snapshotRoot, expectedCommit: "0".repeat(40) }),
      { code: "HEAD_CLAUDE_MARKETPLACE_COMMIT_MISMATCH" },
    );

    const mcpFile = path.join(snapshotRoot, "plugins", built.pluginName, ".mcp.json");
    const mcpBytes = fs.readFileSync(mcpFile);
    const mcp = JSON.parse(mcpBytes.toString("utf8"));
    mcp.mcpServers.head_core.args[0] = "scripts/mcp-server.mjs";
    fs.writeFileSync(mcpFile, `${JSON.stringify(mcp, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyClaudeMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CLAUDE_MARKETPLACE_MCP_INVALID" },
    );
    fs.writeFileSync(mcpFile, mcpBytes);

    const readmeFile = path.join(snapshotRoot, "plugins", built.pluginName, "README.md");
    const readmeBytes = fs.readFileSync(readmeFile);
    fs.appendFileSync(readmeFile, "tamper\n", "utf8");
    assert.throws(
      () => verifyClaudeMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CLAUDE_MARKETPLACE_SOURCE_FILE_DRIFT" },
    );
    fs.writeFileSync(readmeFile, readmeBytes);

    const catalogFile = path.join(snapshotRoot, ".claude-plugin", "marketplace.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    catalog.plugins[0].source = "../outside";
    fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyClaudeMarketplaceSnapshot({ root: snapshotRoot }),
      { code: "HEAD_CLAUDE_MARKETPLACE_ENTRY_INVALID" },
    );

    process.stdout.write(`${JSON.stringify({
      status: "claude_marketplace_packaging_verified",
      marketplaceName: built.marketplaceName,
      pluginName: built.pluginName,
      pluginVersion: built.pluginVersion,
      sourceDistributionReleaseId: built.sourceDistributionReleaseId,
      pluginFileCount: built.pluginFileCount,
      claudePluginRootProjection: true,
      pathEscapeRejected: true,
      unexpectedTreeContentRejected: true,
      sourceCommitMismatchRejected: true,
      mcpProjectionTamperRejected: true,
      sourceFileTamperRejected: true,
      excludedDevelopmentTrees: true,
      credentialInputsAccepted: false,
      sourceAllowlistOnly: true,
      authorityEffect: "none",
    }, null, 2)}\n`);
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (path.dirname(resolvedTemporaryRoot) === resolvedOsTemp
      && path.basename(resolvedTemporaryRoot).startsWith("head-agent-claude-marketplace-")) {
      fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
    }
  }
}
