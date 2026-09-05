#!/usr/bin/env node
// Host execution smoke, separate from the Linux cross-build artifact matrix.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installDistribution, inspectDistribution, rollbackDistribution, uninstallDistribution } from "./lib/distribution-lifecycle.mjs";
import { createGoWorkerManifest } from "./lib/go-worker-adapter.mjs";
import { createProcessSupervisorManifest } from "./lib/runtime-process-supervisor.mjs";
import { createArcadeDbNativeBridgeManifest } from "./lib/arcadedb-native-bridge.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryParent = path.join(sourceRoot, "tmp");
fs.mkdirSync(temporaryParent, { recursive: true });
const scratchRoot = fs.mkdtempSync(path.join(temporaryParent, "native-host-smoke-"));
const nativeRoot = path.join(scratchRoot, "native");
const installRoot = path.join(scratchRoot, "installation");
const binDirectory = path.join(scratchRoot, "bin with spaces");
const ownedChildren = new Map();
const completedPids = new Set();
let interrupted = false;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

async function stop(child) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const windowsTreeStop = async (force) => {
    const args = ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])];
    // Request tree termination before the root disappears; killing only the
    // root first loses Windows descendant ownership information.
    const cleanup = spawn("taskkill.exe", args, { shell: false, windowsHide: true, stdio: "ignore" });
    process.stderr.write(`CHILD_START pid=${cleanup.pid} parent=${process.pid} command=taskkill.exe ${args.join(" ")} cwd=${sourceRoot} ports=none\n`);
    await new Promise((resolve, reject) => { cleanup.once("error", reject); cleanup.once("close", resolve); });
    process.stderr.write(`CHILD_END pid=${cleanup.pid} command=taskkill.exe\n`);
  };
  if (process.platform === "win32") await windowsTreeStop(false);
  else { try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  await Promise.race([new Promise((resolve) => child.once("close", resolve)), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (!alive(child.pid)) return;
  if (process.platform === "win32") {
    await windowsTreeStop(true);
  } else { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
}

async function run(command, args, { cwd = sourceRoot, env = {}, timeoutMs = 120_000, ...options } = {}) {
  assert.equal(interrupted, false, "Host smoke was interrupted.");
  process.stderr.write(`CHILD_PREPARE parent=${process.pid} command=${JSON.stringify([command, ...args])} cwd=${cwd} ports=none\n`);
  const child = spawn(command, args, {
    cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
  if (child.pid) ownedChildren.set(child.pid, child);
  process.stderr.write(`CHILD_START pid=${child.pid ?? "spawn-failed"} parent=${process.pid} command=${command} cwd=${cwd} ports=none\n`);
  let output = "";
  let errorOutput = "";
  let limitError = null;
  const terminate = (message) => { limitError ||= new Error(message); void stop(child).catch((error) => { limitError ||= error; }); };
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
    if (Buffer.byteLength(output) > 4 * 1024 * 1024) terminate(`Output limit exceeded: ${command}`);
  });
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk.toString("utf8");
    process.stderr.write(chunk);
    if (Buffer.byteLength(errorOutput) > 4 * 1024 * 1024) terminate(`Error output limit exceeded: ${command}`);
  });
  const timer = setTimeout(() => terminate(`Timed out: ${command}`), timeoutMs);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (limitError) throw limitError;
    assert.equal(code, 0, errorOutput || output || `${command} exited with ${code}`);
    return output.trim();
  } finally {
    clearTimeout(timer);
    await stop(child);
    if (child.pid) {
      assert.equal(alive(child.pid), false, `Owned child remains: ${child.pid}`);
      ownedChildren.delete(child.pid);
      completedPids.add(child.pid);
    }
    process.stderr.write(`CHILD_END pid=${child.pid ?? "spawn-failed"} exit=${child.exitCode} signal=${child.signalCode || "none"}\n`);
  }
}

const interrupt = () => { interrupted = true; for (const child of ownedChildren.values()) void stop(child); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

function writeNewJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function launcherVersion() {
  const launcher = path.join(binDirectory, process.platform === "win32" ? "head-agent.cmd" : "head-agent");
  const output = process.platform === "win32"
    ? await run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${launcher}" --version"`], { windowsVerbatimArguments: true })
    : await run(launcher, ["--version"]);
  return JSON.parse(output).version;
}

try {
  process.stderr.write(`SMOKE_START pid=${process.pid} parent=${process.ppid} command=${JSON.stringify(process.argv)} cwd=${sourceRoot} ports=none\n`);
  const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")).version;
  const commit = (await run("git", ["rev-parse", "HEAD"])).trim();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const goos = { win32: "windows", linux: "linux", darwin: "darwin" }[process.platform];
  const goarch = { x64: "amd64", arm64: "arm64" }[process.arch];
  assert.ok(goos && goarch, `Unsupported smoke host: ${process.platform}/${process.arch}`);
  const targetDirectory = `${goos === "windows" ? "windows" : process.platform}-${process.arch}`;
  const binaryRoot = path.join(nativeRoot, "dist", targetDirectory);
  fs.mkdirSync(binaryRoot, { recursive: true });
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const binary of ["head-agent-worker", "head-agent-supervisor", "head-agent-arcadedb-bridge"]) {
    await run("go", ["build", "-trimpath", "-buildvcs=false", `-ldflags=-s -w -X main.version=${version} -X main.commit=${commit}`, "-o", path.join(binaryRoot, `${binary}${suffix}`), `./cmd/${binary}`], {
      cwd: path.join(sourceRoot, "native", "head-agent-worker"), env: { CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
    });
  }
  const manifestOptions = { platform: process.platform, arch: process.arch, manifestDirectory: binaryRoot };
  writeNewJson(path.join(binaryRoot, "WORKER-MANIFEST.json"), createGoWorkerManifest({
    ...manifestOptions, binaryFile: path.join(binaryRoot, `head-agent-worker${suffix}`),
    operations: ["worker.health.v1", "worker.lifecycle.v1", "repository.scan.v1"],
  }));
  writeNewJson(path.join(binaryRoot, "SUPERVISOR-MANIFEST.json"), createProcessSupervisorManifest({ ...manifestOptions, binaryFile: path.join(binaryRoot, `head-agent-supervisor${suffix}`) }));
  writeNewJson(path.join(binaryRoot, "ARCADEDB-BRIDGE-MANIFEST.json"), createArcadeDbNativeBridgeManifest({ ...manifestOptions, binaryFile: path.join(binaryRoot, `head-agent-arcadedb-bridge${suffix}`) }));
  writeNewJson(path.join(binaryRoot, "BUILD-METADATA.json"), { version, commit, goos, goarch, cgoEnabled: false });

  const locations = { sourceRoot, installRoot, binDirectory };
  const baseline = installDistribution(locations);
  assert.equal(baseline.status, "installed");
  assert.equal(await launcherVersion(), version);
  const installed = installDistribution({ ...locations, nativeOverlayRoot: nativeRoot });
  assert.equal(installed.status, "upgraded");
  assert.equal(installed.native.status, "verified");
  const installedRoot = path.join(installRoot, "releases", installed.releaseId);
  const doctor = JSON.parse(await run(process.execPath, [path.join(installedRoot, "scripts", "distribution.mjs"), "doctor", "--install-root", installRoot, "--bin-dir", binDirectory]));
  assert.equal(doctor.status, "ready");
  assert.equal(doctor.native, "verified");
  assert.equal(doctor.activeReleaseId, installed.releaseId);
  assert.equal(await launcherVersion(), version);
  // Native health, real scan parity, cancellation, and descendant cleanup are asserted
  // by existing verifiers against the installed bytes, without any live provider account.
  await run(process.execPath, [path.join(installedRoot, "scripts", "verify-go-worker.mjs"), "--plugin-root", installedRoot, "--repository-root", path.join(sourceRoot, "benchmarks", "repository-scan-v1", "basic")]);
  await run(process.execPath, [path.join(installedRoot, "scripts", "verify-process-supervisor.mjs"), "--plugin-root", installedRoot]);
  const rolledBack = rollbackDistribution({ installRoot, binDirectory });
  assert.equal(rolledBack.activeReleaseId, baseline.releaseId);
  assert.equal(inspectDistribution({ installRoot, binDirectory }).native, "javascript-fallback");
  assert.equal(await launcherVersion(), version);
  const uninstalled = uninstallDistribution({ installRoot, binDirectory, purge: true });
  assert.equal(uninstalled.status, "uninstalled");
  assert.equal(fs.existsSync(installRoot), false);
  assert.equal(fs.existsSync(path.join(binDirectory, "head-agent")), false);
  assert.equal(fs.existsSync(path.join(binDirectory, "head-agent.cmd")), false);
  process.stdout.write(`${JSON.stringify({
    status: "native_host_smoke_passed", platform: process.platform, arch: process.arch, node: process.version,
    hostNativeExecution: true, crossBuildOnly: false, installedReleaseId: installed.releaseId,
    doctorVerified: true, nativeHealthVerified: true, nativeScanParityVerified: true,
    supervisorCancellationAndDescendantCleanupVerified: true, rollbackVerified: true,
    launcherWithSpacesVerified: true, uninstallVerified: true,
    providerSessionCreated: false, projectAuthorityChanged: false,
  }, null, 2)}\n`);
} finally {
  for (const child of ownedChildren.values()) await stop(child);
  for (const pid of completedPids) assert.equal(alive(pid), false, `Owned process remains: ${pid}`);
  // Scratch is a unique directory directly below this verifier's source tmp root.
  assert.equal(path.dirname(scratchRoot), temporaryParent);
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  process.stderr.write(`SMOKE_CLEANUP pid=${process.pid} children=${ownedChildren.size} scratchRemoved=${!fs.existsSync(scratchRoot)} ports=none\n`);
}
