#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
    const skillFiles = ["SKILL.md", "references/runtime-composition.md", "references/conversation-ux.md", "references/authority-and-roles.md"];
    for (const file of skillFiles) {
      const relative = path.join("skills", "head-agent-core", file);
      assert.deepEqual(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, relative)),
        fs.readFileSync(path.resolve(relative)), `Generated Claude skill bytes differ: ${file}`);
    }
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "test")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, ".git")), false);
    assert.equal(fs.existsSync(path.join(snapshotRoot, "plugins", built.pluginName, "legacy")), false);
    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, ".head-source-distribution-manifest.json"), "utf8"));
    const conversationSkill = "skills/head-conversation/SKILL.md";
    const conversationBytes = fs.readFileSync(path.resolve(conversationSkill));
    assert.deepEqual(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, conversationSkill)), conversationBytes);
    const conversationEntry = runtimeManifest.files.find(file => file.path === conversationSkill);
    assert.ok(conversationEntry, "The new conversation Skill must be packaged, not just linked");
    assert.equal(conversationEntry.sha256, crypto.createHash("sha256").update(conversationBytes).digest("hex"));
    assert.equal(conversationEntry.bytes, conversationBytes.length);
    assert.equal(runtimeManifest.files.some((file) => file.path === "legacy" || file.path.startsWith("legacy/")), false);
    assert.equal(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, "LICENSE"), "utf8").startsWith("MIT License\n"), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, ".claude-plugin", "plugin.json"), "utf8")).license, "MIT");
    assert.equal(JSON.parse(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, ".claude-plugin", "plugin.json"), "utf8")).hooks, "./hooks/claude.json");
    const startupHooks = JSON.parse(fs.readFileSync(path.join(snapshotRoot, "plugins", built.pluginName, "hooks", "claude.json"), "utf8"));
    assert.deepEqual(Object.keys(startupHooks.hooks), ["SessionStart", "PreToolUse"]);
    assert.match(startupHooks.hooks.SessionStart[0].hooks[0].command, /session-host-hook\.mjs/);
    assert.deepEqual(startupHooks.hooks.PreToolUse.map(group => group.hooks[0].server), ["head_core", "plugin:head-agent-core:head_core"]);
    assert.ok(startupHooks.hooks.PreToolUse.every(group => group.hooks[0].tool === "head_session_host_request_prepare"));
    assert.equal(/permissionDecision|updatedInput/.test(JSON.stringify(startupHooks)), false);
    assert.ok(runtimeManifest.files.some(file => file.path === "scripts/lib/session-host-request.mjs"));
    assert.ok(runtimeManifest.files.some((file) => file.path === "scripts/lib/session-host-adapter.mjs"));

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
      mitLicensePackaged: true,
      exactSkillFilesVerified: skillFiles,
      conversationSkillVerified: { path: conversationSkill, sha256: conversationEntry.sha256, bytes: conversationBytes.length },
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
