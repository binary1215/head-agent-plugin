#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installDistribution,
  inspectDistribution,
  rollbackDistribution,
  uninstallDistribution,
} from "./lib/distribution-lifecycle.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(sourceRoot, "tmp", `distribution-e2e-${process.pid}`);
const installRoot = path.join(scratchRoot, "user-data", "head-agent-core");
const binDirectory = path.join(scratchRoot, "user-home", ".local", "bin");
const upgradedSource = path.join(scratchRoot, "upgraded-source");

function copySourceFixture() {
  fs.mkdirSync(upgradedSource, { recursive: true });
  for (const entry of [".codex-plugin", ".mcp.json", "README.md", "assets", "docs", "native", "package.json", "scripts", "skills"]) {
    const source = path.join(sourceRoot, entry);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(upgradedSource, entry), {
      recursive: true,
      filter: (candidate) => !candidate.split(path.sep).some((part) => [".git", "dist", "node_modules", "test", "tmp", "__pycache__"].includes(part)),
    });
  }
  for (const relative of ["package.json", path.join(".codex-plugin", "plugin.json")]) {
    const file = path.join(upgradedSource, relative);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    value.version = "0.3.0-alpha.47-e2e";
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

try {
  const installed = installDistribution({ sourceRoot, installRoot, binDirectory });
  assert.equal(installed.status, "installed");
  assert.equal(installed.version, "0.3.0-alpha.47");
  assert.equal(inspectDistribution({ installRoot, binDirectory }).activeReleaseId, installed.releaseId);

  const command = process.platform === "win32" ? path.join(binDirectory, "head-agent.cmd") : path.join(binDirectory, "head-agent");
  const version = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${command}" --version"`], { encoding: "utf8", shell: false, windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
  assert.equal(version.status, 0, version.stderr || version.error?.message);
  assert.equal(JSON.parse(version.stdout).version, "0.3.0-alpha.47");

  copySourceFixture();
  const upgradedPluginFile = path.join(upgradedSource, ".codex-plugin", "plugin.json");
  const upgradedPlugin = JSON.parse(fs.readFileSync(upgradedPluginFile, "utf8"));
  fs.writeFileSync(upgradedPluginFile, `${JSON.stringify({ ...upgradedPlugin, version: "mismatched-e2e" }, null, 2)}\n`, "utf8");
  assert.throws(
    () => installDistribution({ sourceRoot: upgradedSource, installRoot, binDirectory }),
    (error) => error.code === "HEAD_DISTRIBUTION_VERSION_MISMATCH",
  );
  assert.equal(inspectDistribution({ installRoot, binDirectory }).activeReleaseId, installed.releaseId);
  fs.writeFileSync(upgradedPluginFile, `${JSON.stringify(upgradedPlugin, null, 2)}\n`, "utf8");
  const upgraded = installDistribution({ sourceRoot: upgradedSource, installRoot, binDirectory });
  assert.equal(upgraded.status, "upgraded");
  assert.notEqual(upgraded.releaseId, installed.releaseId);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).rollbackReleaseId, installed.releaseId);

  const rolledBack = rollbackDistribution({ installRoot, binDirectory });
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(rolledBack.activeReleaseId, installed.releaseId);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).version, "0.3.0-alpha.47");

  const uninstalled = uninstallDistribution({ installRoot, binDirectory, purge: false });
  assert.equal(uninstalled.status, "uninstalled");
  assert.equal(uninstalled.projectStatePreserved, true);
  assert.equal(fs.existsSync(path.join(installRoot, "releases", installed.releaseId)), true);
  assert.equal(fs.existsSync(command), false);

  const purged = uninstallDistribution({ installRoot, binDirectory, purge: true });
  assert.equal(purged.status, "not-installed");
  assert.equal(fs.existsSync(installRoot), false);

  process.stdout.write(`${JSON.stringify({
    status: "passed",
    installedReleaseId: installed.releaseId,
    upgradedReleaseId: upgraded.releaseId,
    rollbackVerified: true,
    failedUpgradePreservedCurrent: true,
    launcherVerified: true,
    projectStatePreserved: true,
  }, null, 2)}\n`);
} finally {
  if (fs.existsSync(scratchRoot)) fs.rmSync(scratchRoot, { recursive: true, force: true });
}
