import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyNativeBundleOverlay, verifyNativeOverlay } from "./native-artifact-delivery.mjs";

const DISTRIBUTION_PROTOCOL = "0.1.0";
const INCLUDE_ENTRIES = [
  ".codex-plugin",
  ".mcp.json",
  "LICENSE",
  "README.md",
  "README.ko.md",
  "assets",
  "docs",
  "native",
  "package.json",
  "scripts",
  "skills",
];
const EXCLUDED_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules", "test", "tmp", "__pycache__"]);
const RUNTIME_TEXT_EXTENSIONS = new Set([".json", ".js", ".md", ".mjs", ".ps1", ".sh", ".txt"]);

function developmentOnlyFiles() {
  const developmentGoal = `${["ULTIMATE", "GOAL"].join("_")}.md`;
  const validationProject = ["neo", "pick"].join("");
  return new Set([
    `docs/${developmentGoal}`,
    `docs/${validationProject}-onboarding-review-proposal.md`,
    "docs/HEAD-Agent_GraphDB_Brief_v4.md",
  ]);
}

function runtimeForbiddenMarkers() {
  return [
    ["ultimate", "goal"].join("_"),
    ["neo", "pick"].join(""),
  ];
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(code, `Cannot read valid JSON from ${file}: ${error.message}`);
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWriteJson(file, value) {
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicWriteFile(file, content, options = {}) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, { flag: "wx", ...options });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    if (!fs.existsSync(file)) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    const backup = `${file}.${process.pid}.${crypto.randomUUID()}.previous`;
    fs.renameSync(file, backup);
    try {
      fs.renameSync(temporary, file);
      fs.rmSync(backup, { force: true });
    } catch (replacementError) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      fs.renameSync(backup, file);
      fs.rmSync(temporary, { force: true });
      throw replacementError;
    }
  }
}

function normalizeRelative(file) {
  return file.split(path.sep).join("/");
}

function walkRegularFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
    const childRelative = path.join(relative, entry.name);
    const child = path.join(root, childRelative);
    if (entry.isSymbolicLink()) fail("HEAD_DISTRIBUTION_SYMLINK", `Distribution input cannot contain symlinks: ${childRelative}`);
    if (entry.isDirectory()) files.push(...walkRegularFiles(root, childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

function distributionFiles(sourceRoot, { includeNativeDist = false } = {}) {
  const files = [];
  for (const entry of includeNativeDist ? [...INCLUDE_ENTRIES, "dist"] : INCLUDE_ENTRIES) {
    const absolute = path.join(sourceRoot, entry);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail("HEAD_DISTRIBUTION_SYMLINK", `Distribution input cannot contain symlinks: ${entry}`);
    if (stat.isDirectory()) files.push(...walkRegularFiles(sourceRoot, entry));
    else if (stat.isFile()) files.push(entry);
  }
  const excluded = developmentOnlyFiles();
  return [...new Set(files)]
    .filter((relative) => !excluded.has(normalizeRelative(relative)))
    .sort((left, right) => normalizeRelative(left).localeCompare(normalizeRelative(right), "en"));
}

function verifyRuntimeSurface(sourceRoot, files) {
  const markers = runtimeForbiddenMarkers();
  for (const relative of files) {
    const normalized = normalizeRelative(relative);
    const lowerPath = normalized.toLowerCase();
    if (markers.some((marker) => lowerPath.includes(marker))) {
      fail("HEAD_DISTRIBUTION_DEVELOPMENT_ONLY_PATH", `Development-only file entered the runtime distribution: ${normalized}`);
    }
    if (!RUNTIME_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) continue;
    const text = fs.readFileSync(path.join(sourceRoot, relative), "utf8").toLowerCase();
    if (markers.some((marker) => text.includes(marker))) {
      fail("HEAD_DISTRIBUTION_DEVELOPMENT_CONTEXT_LEAK", `Development-only context entered a runtime file: ${normalized}`);
    }
  }
}

function validateSource(sourceRoot) {
  const manifestFile = path.join(sourceRoot, ".codex-plugin", "plugin.json");
  const packageFile = path.join(sourceRoot, "package.json");
  const cliFile = path.join(sourceRoot, "scripts", "head.mjs");
  if (!fs.existsSync(manifestFile) || !fs.existsSync(packageFile) || !fs.existsSync(cliFile)) {
    fail("HEAD_DISTRIBUTION_SOURCE_INVALID", "Source must contain .codex-plugin/plugin.json, package.json, and scripts/head.mjs.");
  }
  const plugin = readJson(manifestFile, "HEAD_DISTRIBUTION_MANIFEST_INVALID");
  const pkg = readJson(packageFile, "HEAD_DISTRIBUTION_PACKAGE_INVALID");
  if (!plugin.version || plugin.version !== pkg.version) {
    fail("HEAD_DISTRIBUTION_VERSION_MISMATCH", "Plugin and package versions must match.");
  }
  if (!plugin.license || plugin.license !== pkg.license) {
    fail("HEAD_DISTRIBUTION_LICENSE_MISMATCH", "Plugin and package license identifiers must match.");
  }
  const licenseFile = path.join(sourceRoot, "LICENSE");
  if (!fs.existsSync(licenseFile)) {
    fail("HEAD_DISTRIBUTION_LICENSE_MISSING", "Source must contain its declared LICENSE file.");
  }
  if (plugin.license === "MIT") {
    const licenseText = fs.readFileSync(licenseFile, "utf8");
    if (!licenseText.startsWith("MIT License\n") || !licenseText.includes("Permission is hereby granted, free of charge")) {
      fail("HEAD_DISTRIBUTION_LICENSE_INVALID", "The declared MIT license text is invalid.");
    }
  }
  return { plugin, pkg };
}

function buildManifest(sourceRoot, options = {}) {
  const { plugin, pkg } = validateSource(sourceRoot);
  const sourceFiles = distributionFiles(sourceRoot, options);
  verifyRuntimeSurface(sourceRoot, sourceFiles);
  const files = sourceFiles.map((relative) => {
    const bytes = fs.readFileSync(path.join(sourceRoot, relative));
    return { path: normalizeRelative(relative), bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  if (!files.length) fail("HEAD_DISTRIBUTION_EMPTY", "No distribution files were found.");
  const identityInput = {
    protocolVersion: DISTRIBUTION_PROTOCOL,
    name: plugin.name,
    version: plugin.version,
    files,
  };
  return {
    ...identityInput,
    releaseId: `release-${sha256(Buffer.from(canonical(identityInput))).slice(0, 24)}`,
    packageName: pkg.name,
  };
}

function copyManifestFiles(sourceRoot, stageRoot, manifest) {
  for (const file of manifest.files) {
    const source = path.join(sourceRoot, ...file.path.split("/"));
    const destination = path.join(stageRoot, ...file.path.split("/"));
    ensureDirectory(path.dirname(destination));
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  atomicWriteJson(path.join(stageRoot, "distribution-manifest.json"), manifest);
}

function copyVerifiedNativeOverlay(nativeOverlayRoot, stageRoot, platform, arch, version) {
  const overlay = path.resolve(nativeOverlayRoot);
  const verified = verifyNativeOverlay({ pluginRoot: overlay, platform, arch, version });
  const source = path.join(overlay, "dist", verified.targetDirectory);
  const destination = path.join(stageRoot, "dist", verified.targetDirectory);
  if (fs.existsSync(destination)) fail("HEAD_DISTRIBUTION_NATIVE_CONFLICT", "Native target already exists in the staged distribution.");
  ensureDirectory(path.dirname(destination));
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    filter: (candidate) => {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail("HEAD_DISTRIBUTION_SYMLINK", "Native distribution overlay cannot contain symlinks.");
      return true;
    },
  });
  verifyNativeOverlay({ pluginRoot: stageRoot, platform, arch, version });
  return verified;
}

function copyVerifiedNativeBundleOverlay(nativeOverlayRoot, stageRoot, version) {
  const overlay = path.resolve(nativeOverlayRoot);
  const verified = verifyNativeBundleOverlay({ pluginRoot: overlay, version });
  const source = path.join(overlay, "dist");
  const destination = path.join(stageRoot, "dist");
  if (fs.existsSync(destination)) fail("HEAD_DISTRIBUTION_NATIVE_CONFLICT", "Native bundle conflicts with the staged distribution.");
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    filter: (candidate) => {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail("HEAD_DISTRIBUTION_SYMLINK", "Native distribution bundle cannot contain symlinks.");
      return true;
    },
  });
  const staged = verifyNativeBundleOverlay({ pluginRoot: stageRoot, version, commit: verified.buildCommit });
  if (staged.nativeBundleId !== verified.nativeBundleId) {
    fail("HEAD_DISTRIBUTION_NATIVE_DRIFT", "Staged native bundle identity does not match its verified source.");
  }
  return staged;
}

function verifyRelease(releaseRoot, expectedReleaseId = null) {
  const manifestFile = path.join(releaseRoot, "distribution-manifest.json");
  const manifest = readJson(manifestFile, "HEAD_DISTRIBUTION_RELEASE_INVALID");
  if (expectedReleaseId && manifest.releaseId !== expectedReleaseId) {
    fail("HEAD_DISTRIBUTION_RELEASE_ID_MISMATCH", `Release pointer expected ${expectedReleaseId}, found ${manifest.releaseId}.`);
  }
  const identityInput = {
    protocolVersion: manifest.protocolVersion,
    name: manifest.name,
    version: manifest.version,
    files: manifest.files,
  };
  const computedReleaseId = `release-${sha256(Buffer.from(canonical(identityInput))).slice(0, 24)}`;
  if (computedReleaseId !== manifest.releaseId) fail("HEAD_DISTRIBUTION_MANIFEST_DRIFT", "Distribution manifest identity does not match its content list.");
  for (const file of manifest.files) {
    const absolute = path.resolve(releaseRoot, ...file.path.split("/"));
    const relative = path.relative(releaseRoot, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("HEAD_DISTRIBUTION_PATH_ESCAPE", `Unsafe release path: ${file.path}`);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("HEAD_DISTRIBUTION_FILE_INVALID", `Release entry is not a regular file: ${file.path}`);
    const bytes = fs.readFileSync(absolute);
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) fail("HEAD_DISTRIBUTION_FILE_DRIFT", `Release file failed integrity verification: ${file.path}`);
  }
  return manifest;
}

export function stageDistributionRelease({ sourceRoot, destinationRoot, includeNativeDist = false, nativeOverlayRoot = null } = {}) {
  if (!sourceRoot || !destinationRoot) {
    fail("HEAD_DISTRIBUTION_STAGE_ARGUMENTS", "Source and destination roots are required.");
  }
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const sourceInsideDestination = source.startsWith(`${destination}${path.sep}`);
  const destinationInsideSource = destination.startsWith(`${source}${path.sep}`);
  if (source === destination || sourceInsideDestination || destinationInsideSource) {
    fail("HEAD_DISTRIBUTION_STAGE_OVERLAP", "Distribution source and destination roots must not overlap.");
  }
  if (fs.existsSync(destination)) {
    fail("HEAD_DISTRIBUTION_STAGE_EXISTS", "Distribution destination already exists.");
  }
  if (includeNativeDist && nativeOverlayRoot) {
    fail("HEAD_DISTRIBUTION_NATIVE_CONFLICT", "Select either source native dist or one verified native bundle overlay.");
  }

  ensureDirectory(path.dirname(destination));
  const temporary = fs.mkdtempSync(`${destination}.stage-`);
  try {
    const sourceManifest = buildManifest(source, { includeNativeDist });
    copyManifestFiles(source, temporary, sourceManifest);
    if (nativeOverlayRoot) copyVerifiedNativeBundleOverlay(nativeOverlayRoot, temporary, sourceManifest.version);
    const manifest = nativeOverlayRoot ? buildManifest(temporary, { includeNativeDist: true }) : sourceManifest;
    if (nativeOverlayRoot) atomicWriteJson(path.join(temporary, "distribution-manifest.json"), manifest);
    verifyRelease(temporary, manifest.releaseId);
    fs.renameSync(temporary, destination);
    return manifest;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function verifyDistributionRelease({ releaseRoot, expectedReleaseId = null } = {}) {
  if (!releaseRoot) fail("HEAD_DISTRIBUTION_VERIFY_ARGUMENTS", "Release root is required.");
  return verifyRelease(path.resolve(releaseRoot), expectedReleaseId);
}

function defaultInstallRoot() {
  const base = process.env.HEAD_AGENT_INSTALL_ROOT;
  if (base) return path.resolve(base);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "head-agent-core");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "head-agent-core");
}

function defaultBinDirectory() {
  return path.resolve(process.env.HEAD_AGENT_BIN_DIR || path.join(os.homedir(), ".local", "bin"));
}

function resolveLocations(options = {}) {
  const locations = {
    installRoot: path.resolve(options.installRoot || defaultInstallRoot()),
    binDirectory: path.resolve(options.binDirectory || defaultBinDirectory()),
  };
  const filesystemRoot = path.parse(locations.installRoot).root;
  const forbidden = new Set([path.resolve(filesystemRoot), path.resolve(os.homedir()), locations.binDirectory]);
  if (forbidden.has(locations.installRoot)) {
    fail("HEAD_DISTRIBUTION_INSTALL_ROOT_UNSAFE", `Installation root is too broad or overlaps the command directory: ${locations.installRoot}`);
  }
  return locations;
}

function ownershipFile(installRoot) {
  return path.join(installRoot, "installation.json");
}

function claimInstallRoot(installRoot) {
  const markerFile = ownershipFile(installRoot);
  if (fs.existsSync(installRoot) && !fs.existsSync(markerFile)) {
    const entries = fs.readdirSync(installRoot);
    if (entries.length) fail("HEAD_DISTRIBUTION_INSTALL_ROOT_CONFLICT", "Installation root contains data not owned by HEAD Agent Core.");
  }
  ensureDirectory(installRoot);
  if (fs.existsSync(markerFile)) {
    const marker = readJson(markerFile, "HEAD_DISTRIBUTION_OWNERSHIP_INVALID");
    if (marker.product !== "head-agent-core" || marker.protocolVersion !== DISTRIBUTION_PROTOCOL) {
      fail("HEAD_DISTRIBUTION_OWNERSHIP_INVALID", "Installation root ownership marker is invalid.");
    }
  } else {
    atomicWriteJson(markerFile, { product: "head-agent-core", protocolVersion: DISTRIBUTION_PROTOCOL });
  }
}

function verifyInstallRootOwnership(installRoot) {
  const marker = readJson(ownershipFile(installRoot), "HEAD_DISTRIBUTION_OWNERSHIP_INVALID");
  if (marker.product !== "head-agent-core" || marker.protocolVersion !== DISTRIBUTION_PROTOCOL) {
    fail("HEAD_DISTRIBUTION_OWNERSHIP_INVALID", "Installation root is not owned by this HEAD Agent distribution protocol.");
  }
}

function pointerFile(installRoot) {
  return path.join(installRoot, "current.json");
}

function readPointer(installRoot, { required = true } = {}) {
  const file = pointerFile(installRoot);
  if (!fs.existsSync(file)) {
    if (required) fail("HEAD_DISTRIBUTION_NOT_INSTALLED", "HEAD Agent Core is not installed at the selected installation root.");
    return null;
  }
  const pointer = readJson(file, "HEAD_DISTRIBUTION_POINTER_INVALID");
  if (pointer.protocolVersion !== DISTRIBUTION_PROTOCOL || typeof pointer.activeReleaseId !== "string" || !Array.isArray(pointer.history)) {
    fail("HEAD_DISTRIBUTION_POINTER_INVALID", "The active release pointer is invalid.");
  }
  return pointer;
}

function releaseRoot(installRoot, releaseId) {
  if (!/^release-[a-f0-9]{24}$/.test(releaseId)) fail("HEAD_DISTRIBUTION_RELEASE_ID_INVALID", `Invalid release identity: ${releaseId}`);
  return path.join(installRoot, "releases", releaseId);
}

function launcherSource(installRoot) {
  const encodedRoot = Buffer.from(installRoot, "utf8").toString("base64");
  return `#!/usr/bin/env node\nimport fs from "node:fs";\nimport path from "node:path";\nimport { spawnSync } from "node:child_process";\nconst root = Buffer.from("${encodedRoot}", "base64").toString("utf8");\nconst pointer = JSON.parse(fs.readFileSync(path.join(root, "current.json"), "utf8"));\nif (!/^release-[a-f0-9]{24}$/.test(pointer.activeReleaseId)) throw new Error("Invalid active HEAD Agent release pointer.");\nconst cli = path.join(root, "releases", pointer.activeReleaseId, "scripts", "head.mjs");\nconst child = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit", shell: false });\nif (child.error) throw child.error;\nprocess.exitCode = child.status == null ? 1 : child.status;\n`;
}

function launcherPaths(binDirectory) {
  const launcher = path.join(binDirectory, "head-agent-launcher.mjs");
  const shellLauncher = path.join(binDirectory, "head-agent");
  const cmdLauncher = path.join(binDirectory, "head-agent.cmd");
  const markerFile = path.join(binDirectory, "head-agent-installation.json");
  return { launcher, shellLauncher, cmdLauncher, markerFile };
}

function verifyLauncherOwnership(installRoot, binDirectory) {
  const { launcher, shellLauncher, cmdLauncher, markerFile } = launcherPaths(binDirectory);
  const commandFiles = [launcher, shellLauncher, cmdLauncher];
  if (commandFiles.some((file) => fs.existsSync(file))) {
    if (!fs.existsSync(markerFile)) fail("HEAD_DISTRIBUTION_COMMAND_CONFLICT", "Command directory already contains an unowned head-agent launcher.");
    const marker = readJson(markerFile, "HEAD_DISTRIBUTION_COMMAND_OWNERSHIP_INVALID");
    if (marker.product !== "head-agent-core" || marker.installRoot !== installRoot) {
      fail("HEAD_DISTRIBUTION_COMMAND_CONFLICT", "Command directory belongs to another HEAD Agent installation.");
    }
  }
}

function writeLaunchers(installRoot, binDirectory) {
  ensureDirectory(binDirectory);
  verifyLauncherOwnership(installRoot, binDirectory);
  const { launcher, shellLauncher, cmdLauncher, markerFile } = launcherPaths(binDirectory);
  atomicWriteFile(launcher, launcherSource(installRoot));
  atomicWriteFile(shellLauncher, `#!/bin/sh\nscript_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$script_dir/head-agent-launcher.mjs" "$@"\n`, { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(shellLauncher, 0o755);
  atomicWriteFile(cmdLauncher, "@echo off\r\nnode \"%~dp0head-agent-launcher.mjs\" %*\r\n");
  atomicWriteJson(markerFile, { product: "head-agent-core", protocolVersion: DISTRIBUTION_PROTOCOL, installRoot });
  return { launcher, commands: [shellLauncher, cmdLauncher] };
}

export function installDistribution({ sourceRoot, installRoot, binDirectory, nativeOverlayRoot = null, platform = process.platform, arch = process.arch } = {}) {
  const locations = resolveLocations({ installRoot, binDirectory });
  const source = path.resolve(sourceRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const sourceManifest = buildManifest(source);
  claimInstallRoot(locations.installRoot);
  verifyLauncherOwnership(locations.installRoot, locations.binDirectory);
  ensureDirectory(path.join(locations.installRoot, "releases"));
  ensureDirectory(path.join(locations.installRoot, "staging"));
  const stage = path.join(locations.installRoot, "staging", `preparing-${crypto.randomUUID()}`);
  let manifest;
  let native = null;
  ensureDirectory(stage);
  try {
    copyManifestFiles(source, stage, sourceManifest);
    if (nativeOverlayRoot) native = copyVerifiedNativeOverlay(nativeOverlayRoot, stage, platform, arch, sourceManifest.version);
    manifest = buildManifest(stage, { includeNativeDist: Boolean(native) });
    atomicWriteJson(path.join(stage, "distribution-manifest.json"), manifest);
    verifyRelease(stage, manifest.releaseId);
    const destination = releaseRoot(locations.installRoot, manifest.releaseId);
    if (!fs.existsSync(destination)) fs.renameSync(stage, destination);
    else {
      verifyRelease(destination, manifest.releaseId);
      fs.rmSync(stage, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  const previous = readPointer(locations.installRoot, { required: false });
  const history = previous
    ? [previous.activeReleaseId, ...previous.history].filter((id, index, all) => id !== manifest.releaseId && all.indexOf(id) === index)
    : [];
  atomicWriteJson(pointerFile(locations.installRoot), {
    protocolVersion: DISTRIBUTION_PROTOCOL,
    activeReleaseId: manifest.releaseId,
    history,
  });
  try {
    writeLaunchers(locations.installRoot, locations.binDirectory);
  } catch (error) {
    if (previous) atomicWriteJson(pointerFile(locations.installRoot), previous);
    else fs.rmSync(pointerFile(locations.installRoot), { force: true });
    throw error;
  }
  const launchers = { commands: [path.join(locations.binDirectory, "head-agent"), path.join(locations.binDirectory, "head-agent.cmd")] };
  return {
    status: previous?.activeReleaseId === manifest.releaseId ? "already-current" : previous ? "upgraded" : "installed",
    version: manifest.version,
    releaseId: manifest.releaseId,
    previousReleaseId: previous?.activeReleaseId || null,
    installRoot: locations.installRoot,
    binDirectory: locations.binDirectory,
    commands: launchers.commands,
    native: native ? { status: "verified", ...native } : { status: "javascript-fallback" },
    pathConfigured: (process.env.PATH || "").split(path.delimiter).some((item) => path.resolve(item || ".") === locations.binDirectory),
  };
}

export function inspectDistribution({ installRoot, binDirectory } = {}) {
  const locations = resolveLocations({ installRoot, binDirectory });
  verifyInstallRootOwnership(locations.installRoot);
  const pointer = readPointer(locations.installRoot);
  const manifest = verifyRelease(releaseRoot(locations.installRoot, pointer.activeReleaseId), pointer.activeReleaseId);
  return {
    status: "ready",
    protocolVersion: DISTRIBUTION_PROTOCOL,
    version: manifest.version,
    activeReleaseId: pointer.activeReleaseId,
    rollbackReleaseId: pointer.history[0] || null,
    installRoot: locations.installRoot,
    binDirectory: locations.binDirectory,
    node: process.version,
    native: manifest.files.some((file) => file.path.startsWith("dist/")) ? "verified" : "javascript-fallback",
    pathConfigured: (process.env.PATH || "").split(path.delimiter).some((item) => path.resolve(item || ".") === locations.binDirectory),
  };
}

export function rollbackDistribution({ installRoot, binDirectory } = {}) {
  const locations = resolveLocations({ installRoot, binDirectory });
  verifyInstallRootOwnership(locations.installRoot);
  const pointer = readPointer(locations.installRoot);
  const target = pointer.history[0];
  if (!target) fail("HEAD_DISTRIBUTION_ROLLBACK_UNAVAILABLE", "No prior verified release is available for rollback.");
  const manifest = verifyRelease(releaseRoot(locations.installRoot, target), target);
  atomicWriteJson(pointerFile(locations.installRoot), {
    protocolVersion: DISTRIBUTION_PROTOCOL,
    activeReleaseId: target,
    history: [pointer.activeReleaseId, ...pointer.history.slice(1)].filter((id, index, all) => all.indexOf(id) === index),
  });
  return { status: "rolled-back", version: manifest.version, activeReleaseId: target, previousReleaseId: pointer.activeReleaseId };
}

export function uninstallDistribution({ installRoot, binDirectory, purge = false } = {}) {
  const locations = resolveLocations({ installRoot, binDirectory });
  const pointer = readPointer(locations.installRoot, { required: false });
  verifyInstallRootOwnership(locations.installRoot);
  const commandMarker = path.join(locations.binDirectory, "head-agent-installation.json");
  let commandOwnershipVerified = false;
  if (fs.existsSync(commandMarker)) {
    const marker = readJson(commandMarker, "HEAD_DISTRIBUTION_COMMAND_OWNERSHIP_INVALID");
    commandOwnershipVerified = marker.product === "head-agent-core" && marker.installRoot === locations.installRoot;
  }
  const commands = [
    path.join(locations.binDirectory, "head-agent"),
    path.join(locations.binDirectory, "head-agent.cmd"),
    path.join(locations.binDirectory, "head-agent-launcher.mjs"),
    commandMarker,
  ];
  if (commandOwnershipVerified) {
    for (const command of commands) if (fs.existsSync(command)) fs.rmSync(command, { force: true });
  }
  for (const file of [pointerFile(locations.installRoot)]) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  if (purge && fs.existsSync(locations.installRoot)) {
    verifyInstallRootOwnership(locations.installRoot);
    fs.rmSync(locations.installRoot, { recursive: true, force: true });
  }
  return {
    status: pointer ? "uninstalled" : "not-installed",
    removedActiveReference: Boolean(pointer),
    releasesPreserved: !purge,
    projectStatePreserved: true,
    commandOwnershipVerified,
    installRoot: locations.installRoot,
  };
}

export { DISTRIBUTION_PROTOCOL };
