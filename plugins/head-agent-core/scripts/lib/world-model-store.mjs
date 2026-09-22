import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const WORLD_MODEL_STORE_ADAPTER_VERSION = "0.1.0";
export const WORLD_MODEL_STORAGE_CONTRACT = "replaceable-rebuildable-materialized-view";

const REQUIRED_METHODS = [
  "describe",
  "readPointer",
  "readSnapshot",
  "writePointer",
  "writeSnapshot",
  "listSnapshotIds",
];

const fail = (message, code = "WORLD_MODEL_STORE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function snapshotId(value) {
  if (typeof value !== "string" || !/^world-model-[a-f0-9]{24}$/.test(value)) {
    fail("World Model snapshot id is invalid.", "INVALID_WORLD_MODEL_ID");
  }
  return value;
}

function parseDocument(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_WORLD_MODEL_STORE_DOCUMENT"); }
}

export function assertWorldModelStoreAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") fail("A WorldModelStoreAdapter object is required.", "INVALID_WORLD_MODEL_STORE_ADAPTER");
  if (adapter.adapterVersion !== WORLD_MODEL_STORE_ADAPTER_VERSION) {
    fail(`WorldModelStoreAdapter version must be ${WORLD_MODEL_STORE_ADAPTER_VERSION}.`, "INCOMPATIBLE_WORLD_MODEL_STORE_ADAPTER");
  }
  for (const method of REQUIRED_METHODS) if (typeof adapter[method] !== "function") {
    fail(`WorldModelStoreAdapter is missing ${method}().`, "INVALID_WORLD_MODEL_STORE_ADAPTER");
  }
  const descriptor = adapter.describe();
  if (!descriptor || typeof descriptor.adapterKind !== "string" || !descriptor.adapterKind.trim()) {
    fail("WorldModelStoreAdapter descriptor requires adapterKind.", "INVALID_WORLD_MODEL_STORE_ADAPTER");
  }
  if (descriptor.authority !== "derived-evidence-only") {
    fail("WorldModelStoreAdapter must declare derived-evidence-only authority.", "INVALID_WORLD_MODEL_STORE_AUTHORITY");
  }
  if (descriptor.rebuildable !== true || descriptor.uniqueAuthority !== false) {
    fail("WorldModelStoreAdapter must be rebuildable and must not be unique authority.", "INVALID_WORLD_MODEL_STORE_AUTHORITY");
  }
  return adapter;
}

export class LocalJsonWorldModelStoreAdapter {
  constructor({ projectRoot }) {
    if (typeof projectRoot !== "string" || !projectRoot.trim()) fail("Local JSON adapter requires projectRoot.", "WORLD_MODEL_STORE_ROOT_REQUIRED");
    this.projectRoot = path.resolve(projectRoot);
    this.adapterVersion = WORLD_MODEL_STORE_ADAPTER_VERSION;
  }

  describe() {
    return {
      contract: WORLD_MODEL_STORAGE_CONTRACT,
      adapterKind: "local-json",
      adapterVersion: this.adapterVersion,
      authority: "derived-evidence-only",
      rebuildable: true,
      uniqueAuthority: false,
      remote: false,
      durable: true,
    };
  }

  pointerLocation() {
    return path.join(this.projectRoot, ".head", "world-model", "current.json");
  }

  snapshotLocation(worldModelId) {
    return path.join(this.projectRoot, ".head", "world-model", "snapshots", `${snapshotId(worldModelId)}.json`);
  }

  readPointer() {
    const location = this.pointerLocation();
    if (!fs.existsSync(location)) return null;
    return { location, document: parseDocument(location, "World Model pointer") };
  }

  readSnapshot(worldModelId) {
    const location = this.snapshotLocation(worldModelId);
    if (!fs.existsSync(location)) return null;
    return { location, document: parseDocument(location, "World Model snapshot") };
  }

  writeSnapshot(worldModelId, document) {
    const location = this.snapshotLocation(worldModelId);
    if (fs.existsSync(location)) return { location, created: false, document: parseDocument(location, "World Model snapshot") };
    atomicWrite(location, json(document));
    return { location, created: true, document };
  }

  writePointer(document) {
    const location = this.pointerLocation();
    atomicWrite(location, json(document));
    return { location, document };
  }

  listSnapshotIds() {
    const directory = path.join(this.projectRoot, ".head", "world-model", "snapshots");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^world-model-[a-f0-9]{24}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
  }
}

export function createWorldModelStoreAdapter({ projectRoot, adapter = null } = {}) {
  return assertWorldModelStoreAdapter(adapter || new LocalJsonWorldModelStoreAdapter({ projectRoot }));
}
