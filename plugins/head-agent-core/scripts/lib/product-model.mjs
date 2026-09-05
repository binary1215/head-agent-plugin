import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRODUCT_MODEL_VERSION = "0.1.0";
export const PRODUCT_MODEL_RELATIVE_PATH = ".head/context/product-model.json";
export const PRODUCT_ENTITY_KINDS = Object.freeze([
  "FeatureGroup",
  "Capability",
  "Feature",
  "Requirement",
  "Constraint",
  "Decision",
]);

const fail = (message, code = "PRODUCT_MODEL_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_PRODUCT_MODEL");
  return value.trim();
}

function optionalText(value, label) {
  if (value == null) return "";
  if (typeof value !== "string") fail(`${label} must be a string.`, "INVALID_PRODUCT_MODEL");
  return value.trim();
}

function key(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    fail(`${label} must be a stable key using letters, digits, dot, underscore, colon, or hyphen.`, "INVALID_PRODUCT_KEY");
  }
  return normalized;
}

function stringKeys(value, label) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source)) fail(`${label} must be an array.`, "INVALID_PRODUCT_MODEL");
  const normalized = source.map((item, index) => key(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate keys.`, "DUPLICATE_PRODUCT_REFERENCE");
  return normalized.sort();
}

function assertFields(record, allowed, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`${label} must be an object.`, "INVALID_PRODUCT_MODEL");
  const unexpected = Object.keys(record).filter((field) => !allowed.includes(field));
  if (unexpected.length) fail(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}`, "UNSUPPORTED_PRODUCT_FIELD");
}

function namedEntities(value, label, extraFields = [], normalizeExtra = () => ({})) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source)) fail(`${label} must be an array.`, "INVALID_PRODUCT_MODEL");
  const seen = new Set();
  const records = source.map((record, index) => {
    const itemLabel = `${label}[${index}]`;
    assertFields(record, ["key", "name", "description", ...extraFields], itemLabel);
    const stableKey = key(record.key, `${itemLabel}.key`);
    if (seen.has(stableKey)) fail(`${label} contains duplicate key: ${stableKey}`, "DUPLICATE_PRODUCT_KEY");
    seen.add(stableKey);
    return {
      key: stableKey,
      name: requiredText(record.name, `${itemLabel}.name`),
      description: optionalText(record.description, `${itemLabel}.description`),
      ...normalizeExtra(record, itemLabel),
    };
  });
  return records.sort((left, right) => left.key.localeCompare(right.key));
}

function statementEntities(value, label, { decision = false } = {}) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source)) fail(`${label} must be an array.`, "INVALID_PRODUCT_MODEL");
  const seen = new Set();
  const allowedStatuses = new Set(["active", "superseded"]);
  const records = source.map((record, index) => {
    const itemLabel = `${label}[${index}]`;
    assertFields(record, decision ? ["key", "statement", "description", "status"] : ["key", "statement", "description"], itemLabel);
    const stableKey = key(record.key, `${itemLabel}.key`);
    if (seen.has(stableKey)) fail(`${label} contains duplicate key: ${stableKey}`, "DUPLICATE_PRODUCT_KEY");
    seen.add(stableKey);
    const normalized = {
      key: stableKey,
      statement: requiredText(record.statement, `${itemLabel}.statement`),
      description: optionalText(record.description, `${itemLabel}.description`),
    };
    if (decision) {
      normalized.status = optionalText(record.status, `${itemLabel}.status`).toLowerCase() || "active";
      if (!allowedStatuses.has(normalized.status)) fail(`${itemLabel}.status is invalid.`, "INVALID_PRODUCT_STATUS");
    }
    return normalized;
  });
  return records.sort((left, right) => left.key.localeCompare(right.key));
}

function governedBy(value, label) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source)) fail(`${label} must be an array.`, "INVALID_PRODUCT_MODEL");
  const allowedKinds = new Set(["Requirement", "Constraint", "Decision"]);
  const seen = new Set();
  const records = source.map((record, index) => {
    const itemLabel = `${label}[${index}]`;
    assertFields(record, ["kind", "key"], itemLabel);
    const kind = requiredText(record.kind, `${itemLabel}.kind`);
    if (!allowedKinds.has(kind)) fail(`${itemLabel}.kind is invalid.`, "INVALID_PRODUCT_RELATION");
    const stableKey = key(record.key, `${itemLabel}.key`);
    const identity = `${kind}:${stableKey}`;
    if (seen.has(identity)) fail(`${label} contains duplicate reference: ${identity}`, "DUPLICATE_PRODUCT_REFERENCE");
    seen.add(identity);
    return { kind, key: stableKey };
  });
  return records.sort((left, right) => left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key));
}

function referenceSet(records) {
  return new Set(records.map((record) => record.key));
}

function requireReferences(values, available, label) {
  for (const value of values) if (!available.has(value)) fail(`${label} references unknown key: ${value}`, "UNKNOWN_PRODUCT_REFERENCE");
}

export function emptyProductModelDocument() {
  return {
    schemaVersion: 1,
    featureGroups: [],
    capabilities: [],
    features: [],
    requirements: [],
    constraints: [],
    decisions: [],
  };
}

export function normalizeProductModelDocument(document = emptyProductModelDocument()) {
  assertFields(document, ["schemaVersion", "featureGroups", "capabilities", "features", "requirements", "constraints", "decisions"], "Product model");
  if (document.schemaVersion !== 1) fail("Product model schemaVersion must be 1.", "UNSUPPORTED_PRODUCT_MODEL_VERSION");
  const featureGroups = namedEntities(document.featureGroups, "featureGroups", ["parentFeatureGroupKeys"], (record, label) => ({
    parentFeatureGroupKeys: stringKeys(record.parentFeatureGroupKeys, `${label}.parentFeatureGroupKeys`),
  }));
  const capabilities = namedEntities(document.capabilities, "capabilities");
  const requirements = statementEntities(document.requirements, "requirements");
  const constraints = statementEntities(document.constraints, "constraints");
  const decisions = statementEntities(document.decisions, "decisions", { decision: true });
  const features = namedEntities(
    document.features,
    "features",
    ["featureGroupKeys", "capabilityKeys", "governedBy"],
    (record, label) => ({
      featureGroupKeys: stringKeys(record.featureGroupKeys, `${label}.featureGroupKeys`),
      capabilityKeys: stringKeys(record.capabilityKeys, `${label}.capabilityKeys`),
      governedBy: governedBy(record.governedBy, `${label}.governedBy`),
    }),
  );

  const featureGroupKeys = referenceSet(featureGroups);
  const capabilityKeys = referenceSet(capabilities);
  const governedKeys = {
    Requirement: referenceSet(requirements),
    Constraint: referenceSet(constraints),
    Decision: referenceSet(decisions),
  };
  for (const group of featureGroups) {
    requireReferences(group.parentFeatureGroupKeys, featureGroupKeys, `FeatureGroup ${group.key}`);
    if (group.parentFeatureGroupKeys.includes(group.key)) fail(`FeatureGroup ${group.key} cannot contain itself.`, "PRODUCT_SELF_RELATION");
  }
  const groupParents = new Map(featureGroups.map((group) => [group.key, group.parentFeatureGroupKeys]));
  const visiting = new Set();
  const visited = new Set();
  const visitGroup = (groupKey) => {
    if (visiting.has(groupKey)) fail(`FeatureGroup hierarchy contains a cycle at ${groupKey}.`, "PRODUCT_GROUP_CYCLE");
    if (visited.has(groupKey)) return;
    visiting.add(groupKey);
    for (const parentKey of groupParents.get(groupKey) || []) visitGroup(parentKey);
    visiting.delete(groupKey);
    visited.add(groupKey);
  };
  for (const group of featureGroups) visitGroup(group.key);
  for (const feature of features) {
    requireReferences(feature.featureGroupKeys, featureGroupKeys, `Feature ${feature.key}`);
    requireReferences(feature.capabilityKeys, capabilityKeys, `Feature ${feature.key}`);
    for (const reference of feature.governedBy) {
      requireReferences([reference.key], governedKeys[reference.kind], `Feature ${feature.key}`);
    }
  }

  const model = {
    schemaVersion: 1,
    protocol: { name: "head-agent-core-product-model", version: PRODUCT_MODEL_VERSION },
    featureGroups,
    capabilities,
    features,
    requirements,
    constraints,
    decisions,
  };
  const productModelHash = digest(canonicalJson(model));
  return {
    ...model,
    productModelId: `product-model-${productModelHash.slice(0, 24)}`,
    productModelHash,
    authority: "user-owned-project-canon",
  };
}

export function readProductModelCanon({ projectRoot } = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) fail("projectRoot is required.", "PRODUCT_MODEL_ROOT_REQUIRED");
  const file = path.join(projectRoot, ...PRODUCT_MODEL_RELATIVE_PATH.split("/"));
  let document;
  let status = "present";
  if (!fs.existsSync(file)) {
    document = emptyProductModelDocument();
    status = "missing-empty-default";
  } else {
    try { document = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { fail(`Product model canon is invalid JSON: ${error.message}`, "INVALID_PRODUCT_MODEL_JSON"); }
  }
  const model = normalizeProductModelDocument(document);
  const evidenceHash = digest(canonicalJson({ path: PRODUCT_MODEL_RELATIVE_PATH, productModelHash: model.productModelHash }));
  return {
    status,
    file,
    relativePath: PRODUCT_MODEL_RELATIVE_PATH,
    evidenceId: `evidence-${evidenceHash.slice(0, 24)}`,
    model,
  };
}
