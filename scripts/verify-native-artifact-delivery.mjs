#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createGoWorkerManifest } from "./lib/go-worker-adapter.mjs";
import { createProcessSupervisorManifest } from "./lib/runtime-process-supervisor.mjs";
import { createArcadeDbNativeBridgeManifest } from "./lib/arcadedb-native-bridge.mjs";
import { acquireVerifiedNativeArtifact } from "./lib/native-artifact-delivery.mjs";
import { installDistribution, inspectDistribution, uninstallDistribution } from "./lib/distribution-lifecycle.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8")).version;
const scratchRoot = path.join(sourceRoot, "tmp", `native-delivery-e2e-${process.pid}`);
const fixtureRoot = path.join(scratchRoot, "fixture");
const targetMap = {
  "darwin-arm64": { package: "head-agent-worker-darwin-arm64", directory: "darwin-arm64", goos: "darwin", goarch: "arm64", worker: "head-agent-worker", supervisor: "head-agent-supervisor", bridge: "head-agent-arcadedb-bridge" },
  "darwin-x64": { package: "head-agent-worker-darwin-amd64", directory: "darwin-x64", goos: "darwin", goarch: "amd64", worker: "head-agent-worker", supervisor: "head-agent-supervisor", bridge: "head-agent-arcadedb-bridge" },
  "linux-arm64": { package: "head-agent-worker-linux-arm64", directory: "linux-arm64", goos: "linux", goarch: "arm64", worker: "head-agent-worker", supervisor: "head-agent-supervisor", bridge: "head-agent-arcadedb-bridge" },
  "linux-x64": { package: "head-agent-worker-linux-amd64", directory: "linux-x64", goos: "linux", goarch: "amd64", worker: "head-agent-worker", supervisor: "head-agent-supervisor", bridge: "head-agent-arcadedb-bridge" },
  "win32-x64": { package: "head-agent-worker-windows-amd64", directory: "windows-x64", goos: "windows", goarch: "amd64", worker: "head-agent-worker.exe", supervisor: "head-agent-supervisor.exe", bridge: "head-agent-arcadedb-bridge.exe" },
};
const target = targetMap[`${process.platform}-${process.arch}`];
assert(target, `Native delivery fixture does not support ${process.platform}-${process.arch}.`);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function writeOctal(header, start, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text, start, length - 1, "ascii");
  header[start + length - 1] = 0;
}

function tarEntry(name, bytes, mode = 0o644) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, bytes.length);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 32;
  const padding = Buffer.alloc((512 - bytes.length % 512) % 512);
  return Buffer.concat([header, bytes, padding]);
}

function archive(entries) {
  return zlib.gzipSync(Buffer.concat([
    ...entries.map(({ name, bytes, mode }) => tarEntry(name, bytes, mode)),
    Buffer.alloc(1024),
  ]), { level: 9, mtime: 0 });
}

function fixtureArchive() {
  const directory = path.join(fixtureRoot, target.directory);
  fs.mkdirSync(directory, { recursive: true });
  const workerFile = path.join(directory, target.worker);
  const supervisorFile = path.join(directory, target.supervisor);
  const bridgeFile = path.join(directory, target.bridge);
  fs.writeFileSync(workerFile, "fixture worker\n", { mode: 0o755 });
  fs.writeFileSync(supervisorFile, "fixture supervisor\n", { mode: 0o755 });
  fs.writeFileSync(bridgeFile, "fixture arcadedb bridge\n", { mode: 0o755 });
  const workerManifest = createGoWorkerManifest({ platform: process.platform, arch: process.arch, binaryFile: workerFile, manifestDirectory: directory });
  const supervisorManifest = createProcessSupervisorManifest({ platform: process.platform, arch: process.arch, binaryFile: supervisorFile, manifestDirectory: directory });
  const bridgeManifest = createArcadeDbNativeBridgeManifest({ platform: process.platform, arch: process.arch, binaryFile: bridgeFile, manifestDirectory: directory });
  const metadata = { version, commit: "a".repeat(40), goos: target.goos, goarch: target.goarch, cgoEnabled: false };
  const files = [
    ["BUILD-METADATA.json", Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`), 0o644],
    ["WORKER-MANIFEST.json", Buffer.from(`${JSON.stringify(workerManifest, null, 2)}\n`), 0o644],
    ["SUPERVISOR-MANIFEST.json", Buffer.from(`${JSON.stringify(supervisorManifest, null, 2)}\n`), 0o644],
    ["ARCADEDB-BRIDGE-MANIFEST.json", Buffer.from(`${JSON.stringify(bridgeManifest, null, 2)}\n`), 0o644],
    [target.worker, fs.readFileSync(workerFile), 0o755],
    [target.supervisor, fs.readFileSync(supervisorFile), 0o755],
    [target.bridge, fs.readFileSync(bridgeFile), 0o755],
  ];
  return archive(files.map(([name, bytes, mode]) => ({ name: `${target.directory}/${name}`, bytes, mode })));
}

function fetchFixture(assetName, archiveBytes, { unavailable = false } = {}) {
  return async (url) => {
    if (unavailable) return new Response("missing", { status: 404 });
    if (url.endsWith("/SHA256SUMS")) {
      return new Response(`${sha256(archiveBytes)}  ${assetName}\n`, { status: 200, headers: { "content-length": String(66 + assetName.length) } });
    }
    if (url.endsWith(`/${assetName}`)) return new Response(archiveBytes, { status: 200, headers: { "content-length": String(archiveBytes.length) } });
    return new Response("missing", { status: 404 });
  };
}

try {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const archiveBytes = fixtureArchive();
  const assetName = `${target.package}.tar.gz`;
  const acquired = await acquireVerifiedNativeArtifact({
    version,
    mode: "required",
    fetchImplementation: fetchFixture(assetName, archiveBytes),
    temporaryParent: scratchRoot,
  });
  assert.equal(acquired.status, "verified");
  assert.equal(acquired.assetName, assetName);

  const installRoot = path.join(scratchRoot, "install");
  const binDirectory = path.join(scratchRoot, "bin");
  const installed = installDistribution({
    sourceRoot,
    installRoot,
    binDirectory,
    nativeOverlayRoot: acquired.pluginRoot,
  });
  assert.equal(installed.native.status, "verified");
  assert.equal(inspectDistribution({ installRoot, binDirectory }).native, "verified");
  const releaseTarget = path.join(installRoot, "releases", installed.releaseId, "dist", target.directory);
  assert.equal(fs.existsSync(path.join(releaseTarget, target.worker)), true);
  assert.equal(fs.existsSync(path.join(releaseTarget, target.bridge)), true);
  acquired.cleanup();

  const unavailable = await acquireVerifiedNativeArtifact({
    version,
    mode: "auto",
    fetchImplementation: fetchFixture(assetName, archiveBytes, { unavailable: true }),
    temporaryParent: scratchRoot,
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.reasonCode, "HEAD_NATIVE_RELEASE_UNAVAILABLE");

  const corruptedFetch = async (url) => {
    if (url.endsWith("/SHA256SUMS")) return new Response(`${"0".repeat(64)}  ${assetName}\n`, { status: 200 });
    return new Response(archiveBytes, { status: 200 });
  };
  await assert.rejects(
    acquireVerifiedNativeArtifact({ version, mode: "auto", fetchImplementation: corruptedFetch, temporaryParent: scratchRoot }),
    (error) => error.code === "HEAD_NATIVE_ARCHIVE_DIGEST_MISMATCH",
  );

  const unsafeArchive = archive([{ name: "../escape", bytes: Buffer.from("unsafe"), mode: 0o644 }]);
  await assert.rejects(
    acquireVerifiedNativeArtifact({ version, mode: "required", fetchImplementation: fetchFixture(assetName, unsafeArchive), temporaryParent: scratchRoot }),
    (error) => error.code === "HEAD_NATIVE_ARCHIVE_PATH_UNSAFE",
  );

  uninstallDistribution({ installRoot, binDirectory, purge: true });
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    platform: process.platform,
    arch: process.arch,
    verifiedArchiveInstalled: true,
    automaticFallbackVerified: true,
    checksumFailureClosed: true,
    pathEscapeRejected: true,
    immutableReleaseIncludesNative: true,
  }, null, 2)}\n`);
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}
