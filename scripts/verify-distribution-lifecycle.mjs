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
const sourceVersion = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")).version;
const upgradedVersion = `${sourceVersion}-e2e`;
const scratchRoot = path.join(sourceRoot, "tmp", `distribution-e2e-${process.pid}`);
const installRoot = path.join(scratchRoot, "user-data", "head-agent-core");
const binDirectory = path.join(scratchRoot, "user-home", ".local", "bin");
const upgradedSource = path.join(scratchRoot, "upgraded-source");
const projectRoot = path.join(scratchRoot, "project-without-git-or-graphdb");
const coreOnlyProjectRoot = path.join(scratchRoot, "core-only-project");
const evidenceResumeProjectRoot = path.join(scratchRoot, "project-awaiting-evidence");
const runtimeForbiddenMarkers = [
  ["ultimate", "goal"].join("_"),
  ["neo", "pick"].join(""),
];
const runtimeTextExtensions = new Set([".json", ".js", ".md", ".mjs", ".ps1", ".sh", ".txt"]);

function assertRuntimeSurfaceIsolated(root) {
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { stack.push(absolute); continue; }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      assert.equal(runtimeForbiddenMarkers.some((marker) => relative.toLowerCase().includes(marker)), false, relative);
      if (!runtimeTextExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const text = fs.readFileSync(absolute, "utf8").toLowerCase();
      assert.equal(runtimeForbiddenMarkers.some((marker) => text.includes(marker)), false, relative);
    }
  }
}

function copySourceFixture() {
  fs.mkdirSync(upgradedSource, { recursive: true });
  for (const entry of [".codex-plugin", ".mcp.json", "README.md", "README.ko.md", "assets", "docs", "native", "package.json", "scripts", "skills"]) {
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
    value.version = upgradedVersion;
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return JSON.parse(result.stdout);
}

function runGlobal(args) {
  const command = process.platform === "win32" ? path.join(binDirectory, "head-agent.cmd") : path.join(binDirectory, "head-agent");
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${command}" ${args.map((item) => `"${item}"`).join(" ")}"`], { encoding: "utf8", shell: false, windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(command, args, { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return JSON.parse(result.stdout);
}

function runGlobalFailure(args) {
  const command = process.platform === "win32" ? path.join(binDirectory, "head-agent.cmd") : path.join(binDirectory, "head-agent");
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${command}" ${args.map((item) => `"${item}"`).join(" ")}"`], { encoding: "utf8", shell: false, windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(command, args, { encoding: "utf8", shell: false });
  assert.notEqual(result.status, 0);
  return JSON.parse(result.stdout);
}

try {
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "src", "camera-service.mjs"), "export function captureCameraFrame() { return { captured: true }; }\n", "utf8");
  const installed = runNode([
    path.join(sourceRoot, "scripts", "distribution.mjs"),
    "install",
    "--source", sourceRoot,
    "--install-root", installRoot,
    "--bin-dir", binDirectory,
    "--native", "off",
    "--project", projectRoot,
    "--runtime", "claude,codex,opencode",
    "--profile", "product",
  ]);
  assert.equal(installed.status, "installed");
  assert.equal(installed.version, sourceVersion);
  assert.equal(installed.project.projectAction, "initialized");
  assert.equal(installed.project.onboardingAction, "started");
  assert.equal(installed.project.onboarding.storageMode, "local");
  assert.equal(installed.project.onboarding.candidateCount > 0, true);
  const generatedInstructions = fs.readFileSync(path.join(projectRoot, ".head", "generated", "head-instructions.md"), "utf8").toLowerCase();
  assert.equal(runtimeForbiddenMarkers.some((marker) => generatedInstructions.includes(marker)), false);
  const installedReleaseRoot = path.join(installRoot, "releases", installed.releaseId);
  assert.equal(fs.existsSync(path.join(installedReleaseRoot, "scripts", "workspace-host-export-mcp.mjs")), true);
  assert.equal(fs.existsSync(path.join(installedReleaseRoot, "scripts", "verify-live-provider-coordination.mjs")), true);
  assert.equal(fs.existsSync(path.join(installedReleaseRoot, "scripts", "verify-hostless-session-recovery.mjs")), true);
  assert.equal(fs.existsSync(path.join(installedReleaseRoot, "scripts", "lib", "workspace-host-export-driver.mjs")), true);
  assert.equal(fs.existsSync(path.join(installedReleaseRoot, "README.ko.md")), true);
  assert.equal(fs.readFileSync(path.join(installedReleaseRoot, "README.md"), "utf8").includes("[한국어](README.ko.md)"), true);
  assert.equal(fs.readFileSync(path.join(installedReleaseRoot, "README.ko.md"), "utf8").includes("[English](README.md)"), true);
  assertRuntimeSurfaceIsolated(installedReleaseRoot);
  assert.equal(fs.existsSync(path.join(projectRoot, ".git")), false);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).activeReleaseId, installed.releaseId);

  const command = process.platform === "win32" ? path.join(binDirectory, "head-agent.cmd") : path.join(binDirectory, "head-agent");
  const version = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${command}" --version"`], { encoding: "utf8", shell: false, windowsHide: true, windowsVerbatimArguments: true })
    : spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
  assert.equal(version.status, 0, version.stderr || version.error?.message);
  assert.equal(JSON.parse(version.stdout).version, sourceVersion);

  fs.mkdirSync(coreOnlyProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(coreOnlyProjectRoot, "core.mjs"), "export const coordinated = true;\n", "utf8");
  const coreOnly = runGlobal(["init", coreOnlyProjectRoot, "--runtime", "codex"]);
  assert.equal(coreOnly.status, "core_ready");
  assert.equal(coreOnly.profile, "core");
  assert.equal(coreOnly.productGovernanceActivated, false);
  assert.equal(coreOnly.onboardingAction, "not-activated");
  assert.equal(coreOnly.onboarding.candidateSetId, null);

  const projectBeforeResume = JSON.parse(fs.readFileSync(path.join(projectRoot, ".head", "project.json"), "utf8"));
  const sessionBeforeResume = JSON.parse(fs.readFileSync(path.join(projectRoot, ".head", "sessions", "current.json"), "utf8"));
  const onboardingStateFile = path.join(projectRoot, ".head", "onboarding", "current.json");
  const onboardingBeforeResume = fs.readFileSync(onboardingStateFile, "utf8");
  const resumed = runGlobal(["resume", projectRoot, "--runtime", "claude,codex,opencode", "--profile", "product"]);
  assert.equal(resumed.projectAction, "resumed");
  assert.equal(resumed.onboardingAction, "review-required");
  assert.equal(resumed.project.projectId, projectBeforeResume.projectId);
  assert.equal(resumed.project.sessionId, sessionBeforeResume.sessionId);
  assert.equal(fs.readFileSync(onboardingStateFile, "utf8"), onboardingBeforeResume);

  const managedOpenCodeFile = path.join(projectRoot, "opencode.json");
  const managedOpenCodeBeforeDrift = fs.readFileSync(managedOpenCodeFile, "utf8");
  fs.writeFileSync(managedOpenCodeFile, `${managedOpenCodeBeforeDrift}\nuser-edit`, "utf8");
  const driftFailure = runGlobalFailure(["resume", projectRoot, "--runtime", "claude,codex,opencode", "--profile", "product"]);
  assert.equal(driftFailure.code, "PROJECT_NOT_READY");
  assert.equal(fs.readFileSync(managedOpenCodeFile, "utf8"), `${managedOpenCodeBeforeDrift}\nuser-edit`);
  fs.writeFileSync(managedOpenCodeFile, managedOpenCodeBeforeDrift, "utf8");

  fs.mkdirSync(evidenceResumeProjectRoot, { recursive: true });
  const awaitingEvidence = runGlobal(["init", evidenceResumeProjectRoot, "--runtime", "codex", "--profile", "product"]);
  assert.equal(awaitingEvidence.status, "product_evidence_required");
  assert.equal(awaitingEvidence.onboarding.candidateCount, 0);
  fs.mkdirSync(path.join(evidenceResumeProjectRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(evidenceResumeProjectRoot, "src", "capture.mjs"), "export function captureDepthImage() { return true; }\n", "utf8");
  const resumedEvidence = runGlobal(["resume", evidenceResumeProjectRoot, "--runtime", "codex", "--profile", "product"]);
  assert.equal(resumedEvidence.status, "product_review_required");
  assert.equal(resumedEvidence.onboardingAction, "resumed-analysis");
  assert.equal(resumedEvidence.project.projectId, awaitingEvidence.project.projectId);
  assert.equal(resumedEvidence.project.sessionId, awaitingEvidence.project.sessionId);

  copySourceFixture();
  const upgradedReadmeFile = path.join(upgradedSource, "README.md");
  const upgradedReadme = fs.readFileSync(upgradedReadmeFile, "utf8");
  fs.writeFileSync(upgradedReadmeFile, `${upgradedReadme}\n${runtimeForbiddenMarkers[1]}\n`, "utf8");
  assert.throws(
    () => installDistribution({ sourceRoot: upgradedSource, installRoot, binDirectory }),
    (error) => error.code === "HEAD_DISTRIBUTION_DEVELOPMENT_CONTEXT_LEAK",
  );
  assert.equal(inspectDistribution({ installRoot, binDirectory }).activeReleaseId, installed.releaseId);
  fs.writeFileSync(upgradedReadmeFile, upgradedReadme, "utf8");
  const upgradedPluginFile = path.join(upgradedSource, ".codex-plugin", "plugin.json");
  const upgradedPlugin = JSON.parse(fs.readFileSync(upgradedPluginFile, "utf8"));
  fs.writeFileSync(upgradedPluginFile, `${JSON.stringify({ ...upgradedPlugin, version: "mismatched-e2e" }, null, 2)}\n`, "utf8");
  assert.throws(
    () => installDistribution({ sourceRoot: upgradedSource, installRoot, binDirectory }),
    (error) => error.code === "HEAD_DISTRIBUTION_VERSION_MISMATCH",
  );
  assert.equal(inspectDistribution({ installRoot, binDirectory }).activeReleaseId, installed.releaseId);
  fs.writeFileSync(upgradedPluginFile, `${JSON.stringify(upgradedPlugin, null, 2)}\n`, "utf8");
  const upgraded = runNode([
    path.join(sourceRoot, "scripts", "distribution.mjs"),
    "upgrade",
    "--source", upgradedSource,
    "--install-root", installRoot,
    "--bin-dir", binDirectory,
    "--native", "off",
    "--project", projectRoot,
    "--runtime", "claude,codex,opencode",
    "--profile", "product",
  ]);
  assert.equal(upgraded.status, "upgraded");
  assert.notEqual(upgraded.releaseId, installed.releaseId);
  assert.equal(upgraded.project.installationAction, "converged");
  assert.equal(upgraded.project.project.projectId, projectBeforeResume.projectId);
  assert.equal(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8").includes(upgraded.releaseId), true);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).rollbackReleaseId, installed.releaseId);

  const rolledBack = rollbackDistribution({ installRoot, binDirectory });
  assert.equal(rolledBack.status, "rolled-back");
  assert.equal(rolledBack.activeReleaseId, installed.releaseId);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).version, sourceVersion);
  const resumedAfterRollback = runGlobal(["resume", projectRoot, "--runtime", "claude,codex,opencode", "--profile", "product"]);
  assert.equal(resumedAfterRollback.installationAction, "converged");
  assert.equal(resumedAfterRollback.project.projectId, projectBeforeResume.projectId);
  assert.equal(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8").includes(installed.releaseId), true);

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
    workspaceHostExportBridgePackaged: true,
    liveProviderCoordinationVerifierPackaged: true,
    hostlessSessionRecoveryVerifierPackaged: true,
    publicInitializeResumeVerified: true,
    constitutionalCoreDefaultVerified: true,
    runtimeDevelopmentContextExcluded: true,
    projectAuthorityDeduplicated: true,
    gitAndGraphDbIndependentOnboardingVerified: true,
    managedProjectionConvergenceVerified: true,
    managedDriftRejectedWithoutOverwrite: true,
    awaitingEvidenceResumeVerified: true,
    projectStatePreserved: true,
  }, null, 2)}\n`);
} finally {
  if (fs.existsSync(scratchRoot)) fs.rmSync(scratchRoot, { recursive: true, force: true });
}
