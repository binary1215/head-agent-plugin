import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stageDistributionRelease, verifyDistributionRelease } from "./distribution-lifecycle.mjs";

const CODEX_MARKETPLACE_PROTOCOL = "0.1.0";
const DEFAULT_MARKETPLACE_NAME = "head-agent-plugin";
const DEFAULT_MARKETPLACE_DISPLAY_NAME = "HEAD Agent Plugin";
const MARKETPLACE_GIT_ATTRIBUTES = "* -text\n";

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(file, code) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(code, `Cannot read valid JSON from ${file}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function assertExactKeys(value, keys, label, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code, `${label} fields are invalid.`);
  }
}

function treeEntries(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const childRelative = path.join(relative, entry.name);
    const normalized = childRelative.split(path.sep).join("/");
    if (entry.isSymbolicLink()) fail("HEAD_CODEX_MARKETPLACE_SYMLINK", `Marketplace snapshot cannot contain symlinks: ${normalized}`);
    if (entry.isDirectory()) {
      entries.push({ path: normalized, type: "directory" }, ...treeEntries(root, childRelative));
    } else if (entry.isFile()) {
      entries.push({ path: normalized, type: "file" });
    } else {
      fail("HEAD_CODEX_MARKETPLACE_FILE_TYPE", `Marketplace snapshot contains an unsupported file type: ${normalized}`);
    }
  }
  return entries;
}

function expectedTreeEntries(files) {
  const entries = new Map();
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      entries.set(parts.slice(0, index).join("/"), "directory");
    }
    entries.set(file, "file");
  }
  return [...entries].map(([entryPath, type]) => ({ path: entryPath, type }))
    .sort((left, right) => left.path.localeCompare(right.path, "en") || left.type.localeCompare(right.type, "en"));
}

function marketplaceName(value) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    fail("HEAD_CODEX_MARKETPLACE_NAME_INVALID", "Marketplace name must be lower-case hyphen-case and at most 64 characters.");
  }
  return value;
}

function sourceRepository(value) {
  if (value === "local") return value;
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    fail("HEAD_CODEX_MARKETPLACE_REPOSITORY_INVALID", "Source repository must be owner/repository or local.");
  }
  return value;
}

function sourceCommit(value) {
  if (value === "local") return value;
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    fail("HEAD_CODEX_MARKETPLACE_COMMIT_INVALID", "Source commit must be a full lower-case Git commit or local.");
  }
  return value;
}

function markerIdentity({ marketplaceName: name, pluginName, pluginVersion, releaseId, repository, commit }) {
  return {
    protocolVersion: CODEX_MARKETPLACE_PROTOCOL,
    kind: "HeadAgentCodexMarketplaceSnapshot",
    marketplaceName: name,
    pluginName,
    pluginVersion,
    distributionReleaseId: releaseId,
    sourceRepository: repository,
    sourceCommit: commit,
  };
}

function snapshotMarker(identity) {
  return {
    ...identity,
    snapshotId: `codex-marketplace-${sha256(Buffer.from(canonical(identity))).slice(0, 24)}`,
  };
}

function marketplaceDocument({ name, displayName, pluginName }) {
  return {
    name,
    interface: { displayName },
    plugins: [{
      name: pluginName,
      source: { source: "local", path: `./plugins/${pluginName}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  };
}

export function buildCodexMarketplaceSnapshot({
  sourceRoot,
  outputRoot,
  name = DEFAULT_MARKETPLACE_NAME,
  displayName = DEFAULT_MARKETPLACE_DISPLAY_NAME,
  repository = "local",
  commit = "local",
} = {}) {
  if (!sourceRoot || !outputRoot) fail("HEAD_CODEX_MARKETPLACE_ARGUMENTS", "Source and output roots are required.");
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  marketplaceName(name);
  sourceRepository(repository);
  sourceCommit(commit);
  if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 80) {
    fail("HEAD_CODEX_MARKETPLACE_DISPLAY_NAME_INVALID", "Marketplace display name is invalid.");
  }
  if (fs.existsSync(output)) fail("HEAD_CODEX_MARKETPLACE_OUTPUT_EXISTS", "Marketplace output root already exists.");
  const pluginManifest = readJson(path.join(source, ".codex-plugin", "plugin.json"), "HEAD_CODEX_MARKETPLACE_PLUGIN_INVALID");
  marketplaceName(pluginManifest.name);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = fs.mkdtempSync(`${output}.stage-`);
  try {
    const pluginRoot = path.join(temporary, "plugins", pluginManifest.name);
    const distribution = stageDistributionRelease({ sourceRoot: source, destinationRoot: pluginRoot });
    fs.writeFileSync(path.join(temporary, ".gitattributes"), MARKETPLACE_GIT_ATTRIBUTES, { flag: "wx" });
    writeJson(path.join(temporary, ".agents", "plugins", "marketplace.json"), marketplaceDocument({
      name,
      displayName: displayName.trim(),
      pluginName: pluginManifest.name,
    }));
    const identity = markerIdentity({
      marketplaceName: name,
      pluginName: pluginManifest.name,
      pluginVersion: pluginManifest.version,
      releaseId: distribution.releaseId,
      repository,
      commit,
    });
    writeJson(path.join(temporary, ".head-agent-marketplace-generated.json"), snapshotMarker(identity));
    verifyCodexMarketplaceSnapshot({ root: temporary });
    fs.renameSync(temporary, output);
    return verifyCodexMarketplaceSnapshot({ root: output });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function verifyCodexMarketplaceSnapshot({ root, expectedRepository = null, expectedMarketplaceName = null } = {}) {
  if (!root) fail("HEAD_CODEX_MARKETPLACE_VERIFY_ARGUMENTS", "Marketplace root is required.");
  const marketplaceRoot = path.resolve(root);
  const rootEntries = fs.readdirSync(marketplaceRoot).sort();
  const expectedRootEntries = [".agents", ".gitattributes", ".head-agent-marketplace-generated.json", "plugins"].sort();
  if (rootEntries.length !== expectedRootEntries.length
    || rootEntries.some((entry, index) => entry !== expectedRootEntries[index])) {
    fail("HEAD_CODEX_MARKETPLACE_ROOT_CONTENT", "Marketplace root contains unexpected files or directories.");
  }
  if (fs.readFileSync(path.join(marketplaceRoot, ".gitattributes"), "utf8") !== MARKETPLACE_GIT_ATTRIBUTES) {
    fail("HEAD_CODEX_MARKETPLACE_GIT_ATTRIBUTES", "Marketplace Git attributes must preserve exact cross-platform bytes.");
  }

  const marketplace = readJson(
    path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"),
    "HEAD_CODEX_MARKETPLACE_CATALOG_INVALID",
  );
  assertExactKeys(marketplace, ["name", "interface", "plugins"], "Marketplace catalog", "HEAD_CODEX_MARKETPLACE_CATALOG_INVALID");
  marketplaceName(marketplace.name);
  assertExactKeys(marketplace.interface, ["displayName"], "Marketplace interface", "HEAD_CODEX_MARKETPLACE_CATALOG_INVALID");
  if (typeof marketplace.interface.displayName !== "string" || !marketplace.interface.displayName.trim()) {
    fail("HEAD_CODEX_MARKETPLACE_CATALOG_INVALID", "Marketplace display name is missing.");
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
    fail("HEAD_CODEX_MARKETPLACE_CATALOG_INVALID", "Marketplace must contain exactly one plugin.");
  }
  const entry = marketplace.plugins[0];
  assertExactKeys(entry, ["name", "source", "policy", "category"], "Marketplace plugin entry", "HEAD_CODEX_MARKETPLACE_ENTRY_INVALID");
  marketplaceName(entry.name);
  assertExactKeys(entry.source, ["source", "path"], "Marketplace plugin source", "HEAD_CODEX_MARKETPLACE_ENTRY_INVALID");
  assertExactKeys(entry.policy, ["installation", "authentication"], "Marketplace plugin policy", "HEAD_CODEX_MARKETPLACE_ENTRY_INVALID");
  if (entry.source.source !== "local" || entry.source.path !== `./plugins/${entry.name}`
    || entry.policy.installation !== "AVAILABLE" || entry.policy.authentication !== "ON_INSTALL"
    || entry.category !== "Developer Tools") {
    fail("HEAD_CODEX_MARKETPLACE_ENTRY_INVALID", "Marketplace plugin entry does not match the supported install contract.");
  }

  const pluginRoot = path.resolve(marketplaceRoot, entry.source.path);
  const relativePluginRoot = path.relative(marketplaceRoot, pluginRoot);
  if (!relativePluginRoot || relativePluginRoot.startsWith("..") || path.isAbsolute(relativePluginRoot)) {
    fail("HEAD_CODEX_MARKETPLACE_PATH_ESCAPE", "Marketplace plugin path escapes the snapshot root.");
  }
  const manifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "HEAD_CODEX_MARKETPLACE_PLUGIN_INVALID");
  const pkg = readJson(path.join(pluginRoot, "package.json"), "HEAD_CODEX_MARKETPLACE_PLUGIN_INVALID");
  if (manifest.name !== entry.name || manifest.version !== pkg.version) {
    fail("HEAD_CODEX_MARKETPLACE_PLUGIN_MISMATCH", "Marketplace entry, plugin manifest, and package metadata do not match.");
  }
  const distribution = verifyDistributionRelease({ releaseRoot: pluginRoot });
  if (distribution.name !== manifest.name || distribution.version !== manifest.version) {
    fail("HEAD_CODEX_MARKETPLACE_DISTRIBUTION_MISMATCH", "Marketplace plugin does not match its verified distribution manifest.");
  }

  const marker = readJson(
    path.join(marketplaceRoot, ".head-agent-marketplace-generated.json"),
    "HEAD_CODEX_MARKETPLACE_MARKER_INVALID",
  );
  assertExactKeys(marker, [
    "protocolVersion", "kind", "marketplaceName", "pluginName", "pluginVersion", "distributionReleaseId",
    "sourceRepository", "sourceCommit", "snapshotId",
  ], "Marketplace generation marker", "HEAD_CODEX_MARKETPLACE_MARKER_INVALID");
  marketplaceName(marker.marketplaceName);
  sourceRepository(marker.sourceRepository);
  sourceCommit(marker.sourceCommit);
  const expectedMarker = snapshotMarker(markerIdentity({
    marketplaceName: marketplace.name,
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    releaseId: distribution.releaseId,
    repository: marker.sourceRepository,
    commit: marker.sourceCommit,
  }));
  if (canonical(marker) !== canonical(expectedMarker)) {
    fail("HEAD_CODEX_MARKETPLACE_MARKER_MISMATCH", "Marketplace generation marker does not match the verified snapshot.");
  }
  if (expectedRepository && marker.sourceRepository !== sourceRepository(expectedRepository)) {
    fail("HEAD_CODEX_MARKETPLACE_REPOSITORY_MISMATCH", "Marketplace snapshot belongs to a different source repository.");
  }
  if (expectedMarketplaceName && marketplace.name !== marketplaceName(expectedMarketplaceName)) {
    fail("HEAD_CODEX_MARKETPLACE_NAME_MISMATCH", "Marketplace snapshot has a different marketplace name.");
  }

  const expectedFiles = [
    ".agents/plugins/marketplace.json",
    ".gitattributes",
    ".head-agent-marketplace-generated.json",
    ...distribution.files.map((file) => `plugins/${manifest.name}/${file.path}`),
    `plugins/${manifest.name}/distribution-manifest.json`,
  ].sort((left, right) => left.localeCompare(right, "en"));
  const actualTree = treeEntries(marketplaceRoot)
    .sort((left, right) => left.path.localeCompare(right.path, "en") || left.type.localeCompare(right.type, "en"));
  if (canonical(actualTree) !== canonical(expectedTreeEntries(expectedFiles))) {
    fail("HEAD_CODEX_MARKETPLACE_TREE_MISMATCH", "Marketplace snapshot contains missing or unexpected files or directories.");
  }

  return {
    status: "codex_marketplace_snapshot_verified",
    marketplaceName: marketplace.name,
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    distributionReleaseId: distribution.releaseId,
    snapshotId: marker.snapshotId,
    sourceRepository: marker.sourceRepository,
    sourceCommit: marker.sourceCommit,
    pluginFileCount: distribution.files.length,
    credentialInputsAccepted: false,
    sourceAllowlistOnly: true,
    authorityEffect: "none",
  };
}

export { CODEX_MARKETPLACE_PROTOCOL, DEFAULT_MARKETPLACE_NAME };
