#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject } from "./lib/head-core.mjs";
import { startOnboarding } from "./lib/onboarding.mjs";
import {
  initializeArcadeDbDatabase,
  inspectArcadeDbDatabaseCompatibility,
  verifyArcadeDbDatabaseCompatibilityAudit,
  verifyArcadeDbDatabaseLifecycleReceipt,
} from "./lib/arcadedb-database-lifecycle.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(pluginRoot, `.test-tmp-arcadedb-database-lifecycle-${process.pid}`);

class FixtureTransport {
  constructor() {
    this.exists = false;
    this.types = [];
    this.actions = [];
  }

  ready() { return true; }
  databaseExists() { return this.exists; }
  readSchemaTypes() { return structuredClone(this.types); }
  createDatabase() { this.actions.push("create"); this.exists = true; this.types = []; return true; }
  dropDatabase() { this.actions.push("drop"); this.exists = false; this.types = []; return true; }
}

function write(relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

try {
  fs.rmSync(root, { recursive: true, force: true });
  write("src/service.mjs", "export function captureImage() { return true; }\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex", "opencode"] });
  await startOnboarding({
    root,
    mode: "existing",
    storage: {
      mode: "graphdb",
      endpoint: "https://fixture.invalid",
      database: "fixturedb",
      secretReferenceNames: { username: "HEAD_GRAPHDB_USERNAME", password: "HEAD_GRAPHDB_PASSWORD" },
    },
  });

  const transport = new FixtureTransport();
  const missing = verifyArcadeDbDatabaseCompatibilityAudit(inspectArcadeDbDatabaseCompatibility({ root, transport }));
  assert.equal(missing.status, "database-missing");
  assert.equal(missing.canActivateWithoutReset, false);
  assert.equal(JSON.stringify(missing).includes("fixturedb"), false);
  assert.equal(JSON.stringify(missing).includes("fixture.invalid"), false);

  const created = initializeArcadeDbDatabase({ root, transport });
  verifyArcadeDbDatabaseLifecycleReceipt(created.receipt);
  assert.equal(created.action, "created-missing-database");
  assert.deepEqual(transport.actions, ["create"]);
  assert.equal(created.after.status, "compatible-empty-reserved-schema");

  transport.types = [{ name: "UnrelatedProductData", type: "document", properties: [] }];
  const shared = inspectArcadeDbDatabaseCompatibility({ root, transport });
  assert.equal(shared.status, "compatible-empty-reserved-schema");
  assert.equal(shared.unrelatedTypeCount, 1);

  transport.types.push({ name: "HeadAgentGraphNode", type: "vertex", properties: [{ name: "projectId", type: "STRING" }] });
  const partial = inspectArcadeDbDatabaseCompatibility({ root, transport });
  assert.equal(partial.status, "compatible-partial-reserved-schema");
  assert.equal(partial.conflicts.length, 0);

  transport.types[1] = { name: "HeadAgentGraphNode", type: "document", properties: [] };
  const incompatible = inspectArcadeDbDatabaseCompatibility({ root, transport });
  assert.equal(incompatible.status, "incompatible-reserved-schema");
  assert.equal(incompatible.resetEligible, true);
  assert.throws(
    () => initializeArcadeDbDatabase({ root, transport }),
    (error) => error.code === "ARCADEDB_DATABASE_RESET_CONFIRMATION_REQUIRED",
  );
  assert.throws(
    () => initializeArcadeDbDatabase({ root, transport, resetIncompatible: true, confirmDatabase: "wrong" }),
    (error) => error.code === "ARCADEDB_DATABASE_RESET_TARGET_MISMATCH",
  );
  const reset = initializeArcadeDbDatabase({ root, transport, resetIncompatible: true, confirmDatabase: "fixturedb" });
  assert.equal(reset.action, "reset-incompatible-database");
  assert.deepEqual(transport.actions, ["create", "drop", "create"]);
  assert.equal(reset.after.status, "compatible-empty-reserved-schema");
  assert.equal(JSON.stringify(reset).includes("fixturedb"), false);

  process.stdout.write(`${JSON.stringify({
    status: "arcadedb_database_lifecycle_verified",
    scenarios: ["missing-create", "unrelated-data-coexistence", "partial-compatible", "reserved-name-conflict", "exact-target-reset"],
    credentialsPersisted: false,
    targetValuePersisted: false,
    authorityEffect: "none",
  }, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
