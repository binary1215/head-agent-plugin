import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { resolveRuntimeOperationalStateRoot } from "./runtime-execution-lease.mjs";

export const ROLE_COORDINATION_VERSION = "0.1.0";
export const COORDINATION_BINDING_ENV = "HEAD_AGENT_COORDINATION_BINDING_TOKEN";

const ROLE = /^[a-z][a-z0-9-]{0,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const GENERATION_ID = /^coord-generation-[A-Fa-f0-9-]{36}$/u;
const BINDING_ID = /^coord-binding-[A-Fa-f0-9-]{36}$/u;
const MESSAGE_ID = /^coord-message-[a-f0-9]{32}$/u;
const LANES = new Set(["observe", "session", "run", "authority"]);

const fail = (message, code = "ROLE_COORDINATION_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const now = () => new Date().toISOString();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonical(value));

function requiredText(value, label, maximum = 32_768) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_COORDINATION_INPUT");
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") > maximum) fail(`${label} exceeds its byte limit.`, "COORDINATION_INPUT_LIMIT_EXCEEDED");
  return normalized;
}

function identifier(value, label) {
  const normalized = String(value || "").trim();
  if (!SAFE_ID.test(normalized)) fail(`${label} is invalid.`, "INVALID_COORDINATION_INPUT");
  return normalized;
}

function evidenceIds(value = []) {
  if (!Array.isArray(value) || value.length > 64) fail("Coordination evidenceIds are invalid.", "INVALID_COORDINATION_INPUT");
  const normalized = value.map((item) => identifier(item, "Coordination evidence id"));
  return [...new Set(normalized)].sort();
}

function lane(value = "session") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!LANES.has(normalized)) fail("Coordination lane is invalid.", "INVALID_COORDINATION_LANE");
  return normalized;
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready before ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafePath(root, target) {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedTarget = path.resolve(target);
  if (!isWithin(resolvedRoot, resolvedTarget)) fail("Coordination state path escapes its operational root.", "UNSAFE_COORDINATION_STATE_PATH");
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail("Coordination state path contains a symbolic link.", "UNSAFE_COORDINATION_STATE_PATH");
  }
  return resolvedTarget;
}

function ensureDirectory(root, directory) {
  assertSafePath(root, directory);
  fs.mkdirSync(directory, { recursive: true });
  assertSafePath(root, directory);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Coordination state directory is unsafe.", "UNSAFE_COORDINATION_STATE_PATH");
}

function writeExclusive(root, file, value) {
  ensureDirectory(root, path.dirname(file));
  assertSafePath(root, file);
  fs.writeFileSync(file, json(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function replace(root, file, value) {
  ensureDirectory(root, path.dirname(file));
  assertSafePath(root, file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, json(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
    assertSafePath(root, temporary);
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function read(root, file, label, { optional = false } = {}) {
  assertSafePath(root, file);
  if (!fs.existsSync(file)) {
    if (optional) return null;
    fail(`${label} was not found.`, "COORDINATION_STATE_NOT_FOUND");
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail(`${label} is unsafe.`, "UNSAFE_COORDINATION_STATE_PATH");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_COORDINATION_STATE"); }
}

function context({ root = ".", environment = process.env, create = true, action }) {
  const inspected = readyProject(root, action);
  const operationalRoot = resolveRuntimeOperationalStateRoot({
    projectRoot: inspected.project.projectRoot,
    environment,
    create,
  });
  const operationalMissing = !fs.existsSync(operationalRoot);
  if (operationalMissing && create) fail("Coordination operational state root is unavailable.", "COORDINATION_OPERATIONAL_STATE_UNAVAILABLE");
  if (create) ensureDirectory(operationalRoot, operationalRoot);
  const stateRoot = path.join(
    operationalRoot,
    "role-coordination",
    "v1",
    inspected.project.projectId,
    inspected.state.sessionId,
  );
  if (create) ensureDirectory(operationalRoot, stateRoot);
  else if (!operationalMissing) assertSafePath(operationalRoot, stateRoot);
  return { inspected, operationalRoot, stateRoot, operationalMissing };
}

const generationFile = (stateRoot, generationId) => path.join(stateRoot, "generations", `${generationId}.json`);
const generationDirectory = (stateRoot) => path.join(stateRoot, "generations");
const currentGenerationFile = (stateRoot) => path.join(stateRoot, "current-generation.json");
const bindingFile = (stateRoot, generationId, bindingId) => path.join(stateRoot, "generation-state", generationId, "bindings", "by-id", `${bindingId}.json`);
const bindingDirectory = (stateRoot, generationId) => path.join(stateRoot, "generation-state", generationId, "bindings", "by-id");
const roleBindingPointerFile = (stateRoot, generationId, role) => path.join(stateRoot, "generation-state", generationId, "bindings", "roles", `${role}.json`);
const messageFile = (stateRoot, generationId, role, messageId) => path.join(stateRoot, "generation-state", generationId, "inboxes", role, `${messageId}.json`);
const requestFile = (stateRoot, generationId, role, key) => path.join(stateRoot, "generation-state", generationId, "requests", role, `${key}.json`);
const readFile = (stateRoot, generationId, role, messageId) => path.join(stateRoot, "generation-state", generationId, "reads", role, `${messageId}.json`);
const replyFile = (stateRoot, generationId, role, messageId) => path.join(stateRoot, "generation-state", generationId, "replies", role, `${messageId}.json`);
const deliveryFile = (stateRoot, generationId, messageId) => path.join(stateRoot, "generation-state", generationId, "deliveries", `${messageId}.json`);

function verifyProjectRole(inspected, value) {
  const role = String(value || "").trim().toLowerCase();
  if (!ROLE.test(role)) fail("An exact project role is required.", "INVALID_AGENT_ROLE");
  const rolesRoot = path.join(inspected.project.projectRoot, ".head", "roles");
  const file = path.join(rolesRoot, `${role}.md`);
  try {
    const rolesReal = fs.realpathSync(rolesRoot);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(path.dirname(file)) !== rolesReal) throw new Error("unsafe role");
  } catch {
    fail("The requested role is not a direct verified project role.", "UNTRUSTED_AGENT_ROLE");
  }
  return role;
}

function readGeneration(ctx, generationId) {
  if (!GENERATION_ID.test(generationId || "")) fail("Coordination authority generation is invalid.", "INVALID_COORDINATION_GENERATION");
  const generation = read(ctx.operationalRoot, generationFile(ctx.stateRoot, generationId), "Coordination authority generation");
  const generationPayload = { ...generation };
  delete generationPayload.generationHash;
  if (generation.kind !== "CoordinationAuthorityGeneration" || generation.authorityGeneration !== generationId
    || generation.projectId !== ctx.inspected.project.projectId || generation.headSessionId !== ctx.inspected.state.sessionId
    || !Number.isSafeInteger(generation.generationSequence) || generation.generationSequence < 1
    || generation.generationHash !== digest(canonicalJson(generationPayload))
    || generation.providerSessionIdentityPersisted !== false) {
    fail("Coordination authority generation does not match the current Project/Session.", "INVALID_COORDINATION_GENERATION");
  }
  return generation;
}

function latestGeneration(ctx) {
  const directory = generationDirectory(ctx.stateRoot);
  let names = [];
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const generations = names.map((name) => readGeneration(ctx, name.slice(0, -5))).sort((left, right) => left.generationSequence - right.generationSequence);
  generations.forEach((generation, index) => {
    const previous = generations[index - 1] || null;
    if (generation.generationSequence !== index + 1
      || generation.previousAuthorityGeneration !== (previous?.authorityGeneration || null)
      || generation.previousGenerationHash !== (previous?.generationHash || null)) {
      fail("Coordination authority generation chain is incomplete or divergent.", "INVALID_COORDINATION_GENERATION_CHAIN");
    }
  });
  return generations.at(-1) || null;
}

function currentGeneration(ctx, { required = true } = {}) {
  if (ctx.operationalMissing) {
    if (!required) return null;
    fail("Role coordination has not been opened for this Project/Session.", "COORDINATION_GENERATION_NOT_OPEN");
  }
  const pointer = read(ctx.operationalRoot, currentGenerationFile(ctx.stateRoot), "Current coordination generation", { optional: !required });
  if (!pointer) return null;
  const generation = readGeneration(ctx, pointer.authorityGeneration);
  if (pointer.projectId !== ctx.inspected.project.projectId || pointer.headSessionId !== ctx.inspected.state.sessionId) {
    fail("Current coordination generation pointer belongs to another Project/Session.", "COORDINATION_PROJECT_SESSION_MISMATCH");
  }
  if (pointer.generationHash !== generation.generationHash || pointer.generationSequence !== generation.generationSequence) {
    fail("Current coordination generation pointer failed digest verification.", "INVALID_COORDINATION_GENERATION_POINTER");
  }
  const latest = latestGeneration(ctx);
  if (!latest || latest.generationSequence !== generation.generationSequence || latest.authorityGeneration !== generation.authorityGeneration) {
    fail("Current coordination generation pointer was rolled back.", "COORDINATION_GENERATION_ROLLBACK");
  }
  return generation;
}

function readBinding(ctx, generation, bindingId, { optional = false } = {}) {
  if (!BINDING_ID.test(bindingId || "")) fail("Coordination binding identity is invalid.", "INVALID_COORDINATION_BINDING");
  const binding = read(ctx.operationalRoot, bindingFile(ctx.stateRoot, generation.authorityGeneration, bindingId), "Coordination role binding", { optional });
  if (!binding) return null;
  const payload = { ...binding };
  delete payload.bindingHash;
  if (binding.kind !== "CoordinationRoleBinding" || binding.bindingId !== bindingId
    || binding.projectId !== generation.projectId || binding.headSessionId !== generation.headSessionId
    || binding.authorityGeneration !== generation.authorityGeneration || !Number.isSafeInteger(binding.bindingSequence)
    || binding.bindingSequence < 1 || binding.bindingHash !== digest(canonicalJson(payload))
    || !ROLE.test(binding.role || "")
    || binding.roleSelfClaimed !== false || binding.providerSessionIdentityPersisted !== false) {
    fail("Coordination role binding failed identity verification.", "INVALID_COORDINATION_BINDING");
  }
  return binding;
}

function latestRoleBinding(ctx, generation, role) {
  const directory = bindingDirectory(ctx.stateRoot, generation.authorityGeneration);
  let names = [];
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const bindings = names.map((name) => readBinding(ctx, generation, name.slice(0, -5))).filter((binding) => binding.role === role)
    .sort((left, right) => left.bindingSequence - right.bindingSequence);
  bindings.forEach((binding, index) => {
    const previous = bindings[index - 1] || null;
    if (binding.bindingSequence !== index + 1 || binding.previousBindingId !== (previous?.bindingId || null)
      || binding.previousBindingHash !== (previous?.bindingHash || null)) {
      fail("Coordination role binding chain is incomplete or divergent.", "INVALID_COORDINATION_BINDING_CHAIN");
    }
  });
  return bindings.at(-1) || null;
}

export function openCoordinationGeneration({ root = ".", environment = process.env, rotate = false } = {}) {
  const ctx = context({ root, environment, create: true, action: "coordination authority is opened" });
  const previous = currentGeneration(ctx, { required: false });
  if (previous && !rotate) return { status: "existing", generation: previous, operationalState: "host-local-not-project-canon" };
  const authorityGeneration = `coord-generation-${crypto.randomUUID()}`;
  const generationPayload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationAuthorityGeneration",
    protocol: { name: "head-agent-core-role-coordination", version: ROLE_COORDINATION_VERSION },
    authorityGeneration,
    previousAuthorityGeneration: previous?.authorityGeneration || null,
    previousGenerationHash: previous?.generationHash || null,
    generationSequence: (previous?.generationSequence || 0) + 1,
    projectId: ctx.inspected.project.projectId,
    headSessionId: ctx.inspected.state.sessionId,
    createdAt: now(),
    authority: "host-local-caller-fence-only",
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
    providerSessionIdentityPersisted: false,
  };
  const generation = { ...generationPayload, generationHash: digest(canonicalJson(generationPayload)) };
  writeExclusive(ctx.operationalRoot, generationFile(ctx.stateRoot, authorityGeneration), generation);
  replace(ctx.operationalRoot, currentGenerationFile(ctx.stateRoot), {
    schemaVersion: SCHEMA_VERSION,
    projectId: generation.projectId,
    headSessionId: generation.headSessionId,
    authorityGeneration,
    generationHash: generation.generationHash,
    generationSequence: generation.generationSequence,
    updatedAt: now(),
  });
  return { status: previous ? "rotated" : "opened", generation, operationalState: "host-local-not-project-canon" };
}

export function issueCoordinationRoleBinding({ root = ".", role, environment = process.env } = {}) {
  const ctx = context({ root, environment, create: true, action: "a trusted coordination role binding is issued" });
  const generation = currentGeneration(ctx);
  const verifiedRole = verifyProjectRole(ctx.inspected, role);
  const previousPointer = read(ctx.operationalRoot, roleBindingPointerFile(ctx.stateRoot, generation.authorityGeneration, verifiedRole), "Current role binding", { optional: true });
  const previousBinding = previousPointer ? readBinding(ctx, generation, previousPointer.bindingId) : null;
  const latestBinding = latestRoleBinding(ctx, generation, verifiedRole);
  if ((latestBinding && (!previousBinding || latestBinding.bindingId !== previousBinding.bindingId))
    || (previousBinding && previousPointer.bindingHash !== previousBinding.bindingHash)) {
    fail("Coordination role binding pointer was rolled back or corrupted.", "COORDINATION_BINDING_ROLLBACK");
  }
  const bindingId = `coord-binding-${crypto.randomUUID()}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  const bindingToken = `${bindingId}.${secret}`;
  const bindingPayload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationRoleBinding",
    protocol: { name: "head-agent-core-role-coordination", version: ROLE_COORDINATION_VERSION },
    bindingId,
    projectId: generation.projectId,
    headSessionId: generation.headSessionId,
    authorityGeneration: generation.authorityGeneration,
    role: verifiedRole,
    bindingSequence: (previousBinding?.bindingSequence || 0) + 1,
    previousBindingId: previousBinding?.bindingId || null,
    previousBindingHash: previousBinding?.bindingHash || null,
    tokenBindingHash: digest(`${bindingId}\0${secret}`),
    issuedAt: now(),
    authority: "host-issued-operational-capability",
    roleSelfClaimed: false,
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
    providerSessionIdentityPersisted: false,
  };
  const binding = { ...bindingPayload, bindingHash: digest(canonicalJson(bindingPayload)) };
  writeExclusive(ctx.operationalRoot, bindingFile(ctx.stateRoot, generation.authorityGeneration, bindingId), binding);
  replace(ctx.operationalRoot, roleBindingPointerFile(ctx.stateRoot, generation.authorityGeneration, verifiedRole), {
    schemaVersion: SCHEMA_VERSION,
    projectId: generation.projectId,
    headSessionId: generation.headSessionId,
    authorityGeneration: generation.authorityGeneration,
    role: verifiedRole,
    bindingId,
    bindingHash: binding.bindingHash,
    bindingSequence: binding.bindingSequence,
    updatedAt: now(),
  });
  return {
    status: "binding_issued",
    binding: { ...binding, tokenBindingHash: "present-not-disclosed" },
    bindingToken,
    warning: "The raw binding token is returned once and must be injected by the trusted host; never persist it in project files or message arguments.",
  };
}

function authenticate({ root, environment, bindingToken, action }) {
  const ctx = context({ root, environment, create: false, action });
  const token = requiredText(bindingToken, "Coordination binding token", 512);
  const separator = token.indexOf(".");
  if (separator <= 0) fail("Coordination binding token is invalid.", "INVALID_COORDINATION_BINDING_TOKEN");
  const bindingId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!BINDING_ID.test(bindingId) || !secret) fail("Coordination binding token is invalid.", "INVALID_COORDINATION_BINDING_TOKEN");
  const generation = currentGeneration(ctx);
  const binding = readBinding(ctx, generation, bindingId, { optional: true });
  if (!binding || binding.bindingId !== bindingId || binding.kind !== "CoordinationRoleBinding") {
    fail("Coordination binding is unavailable in the active authority generation.", "STALE_COORDINATION_BINDING");
  }
  const pointer = read(ctx.operationalRoot, roleBindingPointerFile(ctx.stateRoot, generation.authorityGeneration, binding.role), "Current role binding", { optional: true });
  if (!pointer || pointer.bindingId !== bindingId || pointer.bindingHash !== binding.bindingHash
    || pointer.bindingSequence !== binding.bindingSequence || pointer.authorityGeneration !== generation.authorityGeneration) {
    fail("Coordination binding was replaced or belongs to a stale generation.", "STALE_COORDINATION_BINDING");
  }
  const latest = latestRoleBinding(ctx, generation, binding.role);
  if (!latest || latest.bindingId !== binding.bindingId || latest.bindingSequence !== binding.bindingSequence) {
    fail("Coordination role binding pointer was rolled back.", "COORDINATION_BINDING_ROLLBACK");
  }
  if (binding.projectId !== generation.projectId || binding.headSessionId !== generation.headSessionId
    || binding.authorityGeneration !== generation.authorityGeneration || binding.roleSelfClaimed !== false
    || binding.tokenBindingHash !== digest(`${bindingId}\0${secret}`)) {
    fail("Coordination binding verification failed.", "INVALID_COORDINATION_BINDING_TOKEN");
  }
  verifyProjectRole(ctx.inspected, binding.role);
  return { ...ctx, generation, binding };
}

function verifyMessage(ctx, message, { recipient = "" } = {}) {
  if (!message || message.kind !== "CoordinationMessage" || !MESSAGE_ID.test(message.messageId || "")
    || message.projectId !== ctx.inspected.project.projectId || message.headSessionId !== ctx.inspected.state.sessionId
    || message.authorityGeneration !== ctx.generation.authorityGeneration
    || message.instructionAuthority !== false || message.decisionAuthority !== false
    || message.promotionAuthority !== false || message.canonMutationAuthority !== false
    || message.reviewAuthority !== false || message.executionAuthorizationAuthority !== false
    || message.providerSessionIdentityPersisted !== false || recipient && message.toRole !== recipient) {
    fail("Coordination message failed Project/Session/generation or authority verification.", "INVALID_COORDINATION_MESSAGE");
  }
  return message;
}

function sameMessagePayload(left, right) {
  return canonicalJson({
    projectId: left.projectId,
    headSessionId: left.headSessionId,
    authorityGeneration: left.authorityGeneration,
    messageId: left.messageId,
    fromRole: left.fromRole,
    toRole: left.toRole,
    content: left.content,
    evidenceIds: left.evidenceIds,
    lane: left.lane,
  }) === canonicalJson({
    projectId: right.projectId,
    headSessionId: right.headSessionId,
    authorityGeneration: right.authorityGeneration,
    messageId: right.messageId,
    fromRole: right.fromRole,
    toRole: right.toRole,
    content: right.content,
    evidenceIds: right.evidenceIds,
    lane: right.lane,
  });
}

function replyForSender(ctx, messageId) {
  const reply = read(ctx.operationalRoot, replyFile(ctx.stateRoot, ctx.generation.authorityGeneration, ctx.binding.role, messageId), "Coordination reply", { optional: true });
  if (!reply) return null;
  if (reply.projectId !== ctx.inspected.project.projectId || reply.headSessionId !== ctx.inspected.state.sessionId
    || reply.authorityGeneration !== ctx.generation.authorityGeneration || reply.toRole !== ctx.binding.role
    || reply.inReplyTo !== messageId || reply.instructionAuthority !== false || reply.decisionAuthority !== false
    || reply.promotionAuthority !== false || reply.canonMutationAuthority !== false
    || reply.reviewAuthority !== false || reply.executionAuthorizationAuthority !== false
    || reply.providerSessionIdentityPersisted !== false) {
    fail("Coordination reply failed authority verification.", "INVALID_COORDINATION_REPLY");
  }
  return reply;
}

function deliveryReceipt(ctx, message, deliveryAdapter) {
  const file = deliveryFile(ctx.stateRoot, ctx.generation.authorityGeneration, message.messageId);
  const prior = read(ctx.operationalRoot, file, "Coordination delivery receipt", { optional: true });
  if (prior) return prior;
  let status = "not_configured";
  let targetBindingId = null;
  if (deliveryAdapter) {
    if (typeof deliveryAdapter.deliver !== "function") fail("Coordination delivery adapter is invalid.", "INVALID_COORDINATION_DELIVERY_ADAPTER");
    try {
      const result = deliveryAdapter.deliver({ message });
      if (result && typeof result.then === "function") fail("Coordination delivery adapters must complete synchronously in this slice.", "ASYNC_COORDINATION_DELIVERY_UNSUPPORTED");
      status = result?.status === "delivered" ? "delivered" : result?.status === "unavailable" ? "unavailable" : "ambiguous";
      targetBindingId = typeof result?.targetBindingId === "string" ? result.targetBindingId : null;
    } catch {
      status = "ambiguous";
    }
  }
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationDeliveryReceipt",
    protocol: { name: "head-agent-core-role-coordination", version: ROLE_COORDINATION_VERSION },
    projectId: message.projectId,
    headSessionId: message.headSessionId,
    authorityGeneration: message.authorityGeneration,
    messageId: message.messageId,
    status,
    targetBindingId,
    completedAt: now(),
    retryPolicy: status === "ambiguous" ? "no-automatic-retry" : "explicit-host-retry-only",
    durableInboxAccepted: true,
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
  };
  try { writeExclusive(ctx.operationalRoot, file, receipt); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    return read(ctx.operationalRoot, file, "Coordination delivery receipt");
  }
  return receipt;
}

export function sendCoordinationMessage({
  root = ".", environment = process.env, bindingToken, toRole, content, evidenceIds: inputEvidenceIds = [],
  idempotencyKey, lane: inputLane = "session", deliveryAdapter = null,
} = {}) {
  const ctx = authenticate({ root, environment, bindingToken, action: "a role message is sent" });
  const recipient = verifyProjectRole(ctx.inspected, toRole);
  const normalizedContent = requiredText(content, "Coordination message content");
  const normalizedEvidenceIds = evidenceIds(inputEvidenceIds);
  const normalizedLane = lane(inputLane);
  const key = identifier(idempotencyKey, "Coordination idempotency key");
  const fingerprint = digest(canonicalJson({
    fromRole: ctx.binding.role,
    toRole: recipient,
    content: normalizedContent,
    evidenceIds: normalizedEvidenceIds,
    lane: normalizedLane,
  }));
  const requestPath = requestFile(ctx.stateRoot, ctx.generation.authorityGeneration, ctx.binding.role, key);
  const replay = read(ctx.operationalRoot, requestPath, "Coordination idempotency record", { optional: true });
  if (replay) {
    if (replay.projectId !== ctx.inspected.project.projectId || replay.headSessionId !== ctx.inspected.state.sessionId
      || replay.authorityGeneration !== ctx.generation.authorityGeneration || replay.fromRole !== ctx.binding.role) {
      fail("Coordination idempotency record belongs to another authority boundary.", "STALE_COORDINATION_GENERATION");
    }
    if (replay.fingerprint !== fingerprint) fail("Coordination idempotency key was reused for different content.", "COORDINATION_IDEMPOTENCY_CONFLICT");
    const message = verifyMessage(ctx, read(ctx.operationalRoot, messageFile(ctx.stateRoot, ctx.generation.authorityGeneration, recipient, replay.messageId), "Coordination message"), { recipient });
    return { status: "replayed", message, delivery: deliveryReceipt(ctx, message, null), reply: replyForSender(ctx, message.messageId) };
  }
  const messageId = `coord-message-${digest(`${ctx.inspected.project.projectId}\0${ctx.inspected.state.sessionId}\0${ctx.generation.authorityGeneration}\0${ctx.binding.role}\0${key}`).slice(0, 32)}`;
  const message = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationMessage",
    protocol: { name: "head-agent-core-role-coordination", version: ROLE_COORDINATION_VERSION },
    messageId,
    projectId: ctx.inspected.project.projectId,
    headSessionId: ctx.inspected.state.sessionId,
    authorityGeneration: ctx.generation.authorityGeneration,
    fromRole: ctx.binding.role,
    toRole: recipient,
    content: normalizedContent,
    evidenceIds: normalizedEvidenceIds,
    lane: normalizedLane,
    sentAt: now(),
    authority: "coordination-evidence-only",
    roleDerivedFrom: "host-issued-binding",
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
    reviewAuthority: false,
    executionAuthorizationAuthority: false,
    providerSessionIdentityPersisted: false,
  };
  const messagePath = messageFile(ctx.stateRoot, ctx.generation.authorityGeneration, recipient, messageId);
  let persistedMessage = read(ctx.operationalRoot, messagePath, "Coordination message", { optional: true });
  if (!persistedMessage) {
    try {
      writeExclusive(ctx.operationalRoot, messagePath, message);
      persistedMessage = message;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      persistedMessage = read(ctx.operationalRoot, messagePath, "Coordination message");
    }
  }
  verifyMessage(ctx, persistedMessage, { recipient });
  if (!sameMessagePayload(persistedMessage, message)) fail("Deterministic coordination message identity conflicts with stored content.", "COORDINATION_MESSAGE_CONFLICT");
  const idempotencyRecord = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationIdempotencyRecord",
    projectId: message.projectId,
    headSessionId: message.headSessionId,
    authorityGeneration: message.authorityGeneration,
    fromRole: message.fromRole,
    idempotencyKey: key,
    fingerprint,
    messageId,
    createdAt: now(),
  };
  try { writeExclusive(ctx.operationalRoot, requestPath, idempotencyRecord); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const concurrent = read(ctx.operationalRoot, requestPath, "Coordination idempotency record");
    if (concurrent.fingerprint !== fingerprint || concurrent.messageId !== messageId) {
      fail("Coordination idempotency key was concurrently reused for different content.", "COORDINATION_IDEMPOTENCY_CONFLICT");
    }
  }
  return { status: "accepted", message: persistedMessage, delivery: deliveryReceipt(ctx, persistedMessage, deliveryAdapter), reply: null };
}

export function readCoordinationInbox({ root = ".", environment = process.env, bindingToken, unreadOnly = true } = {}) {
  if (typeof unreadOnly !== "boolean") fail("unreadOnly must be boolean.", "INVALID_COORDINATION_INPUT");
  const ctx = authenticate({ root, environment, bindingToken, action: "a role inbox is read" });
  const inbox = path.join(ctx.stateRoot, "generation-state", ctx.generation.authorityGeneration, "inboxes", ctx.binding.role);
  assertSafePath(ctx.operationalRoot, inbox);
  let names = [];
  try { names = fs.readdirSync(inbox).filter((name) => name.endsWith(".json")).sort(); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const messages = [];
  for (const name of names) {
    const messageId = name.slice(0, -5);
    if (!MESSAGE_ID.test(messageId)) continue;
    const message = verifyMessage(ctx, read(ctx.operationalRoot, messageFile(ctx.stateRoot, ctx.generation.authorityGeneration, ctx.binding.role, messageId), "Coordination message"), { recipient: ctx.binding.role });
    const markerPath = readFile(ctx.stateRoot, ctx.generation.authorityGeneration, ctx.binding.role, messageId);
    const marker = read(ctx.operationalRoot, markerPath, "Coordination read marker", { optional: true });
    const wasRead = !!marker;
    if (unreadOnly && wasRead) continue;
    messages.push({ ...message, read: wasRead });
    if (!wasRead) {
      try {
        writeExclusive(ctx.operationalRoot, markerPath, {
          schemaVersion: SCHEMA_VERSION,
          kind: "CoordinationReadReceipt",
          projectId: message.projectId,
          headSessionId: message.headSessionId,
          authorityGeneration: message.authorityGeneration,
          role: ctx.binding.role,
          messageId,
          readAt: now(),
          authority: "operational-observation-only",
        });
      } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
  }
  return { status: "inbox_read", role: ctx.binding.role, authorityGeneration: ctx.generation.authorityGeneration, messages };
}

export function replyCoordinationMessage({ root = ".", environment = process.env, bindingToken, inReplyTo, content } = {}) {
  const ctx = authenticate({ root, environment, bindingToken, action: "a role message is replied to" });
  const messageId = String(inReplyTo || "").trim();
  if (!MESSAGE_ID.test(messageId)) fail("Reply message identity is invalid.", "INVALID_COORDINATION_MESSAGE_ID");
  const message = verifyMessage(ctx, read(ctx.operationalRoot, messageFile(ctx.stateRoot, ctx.generation.authorityGeneration, ctx.binding.role, messageId), "Coordination message"), { recipient: ctx.binding.role });
  const normalizedContent = requiredText(content, "Coordination reply content");
  const file = replyFile(ctx.stateRoot, ctx.generation.authorityGeneration, message.fromRole, messageId);
  const prior = read(ctx.operationalRoot, file, "Coordination reply", { optional: true });
  if (prior) {
    if (prior.fromRole !== ctx.binding.role || prior.toRole !== message.fromRole || prior.content !== normalizedContent) {
      fail("A conflicting immutable coordination reply already exists.", "COORDINATION_REPLY_IMMUTABLE");
    }
    return { status: "existing", reply: prior };
  }
  const reply = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CoordinationReply",
    protocol: { name: "head-agent-core-role-coordination", version: ROLE_COORDINATION_VERSION },
    inReplyTo: messageId,
    projectId: message.projectId,
    headSessionId: message.headSessionId,
    authorityGeneration: message.authorityGeneration,
    fromRole: ctx.binding.role,
    toRole: message.fromRole,
    content: normalizedContent,
    repliedAt: now(),
    authority: "coordination-evidence-only",
    roleDerivedFrom: "host-issued-binding",
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
    reviewAuthority: false,
    executionAuthorizationAuthority: false,
    providerSessionIdentityPersisted: false,
  };
  try { writeExclusive(ctx.operationalRoot, file, reply); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const concurrent = read(ctx.operationalRoot, file, "Coordination reply");
    if (concurrent.fromRole !== ctx.binding.role || concurrent.toRole !== message.fromRole || concurrent.content !== normalizedContent) {
      fail("A conflicting immutable coordination reply already exists.", "COORDINATION_REPLY_IMMUTABLE");
    }
    return { status: "existing", reply: concurrent };
  }
  return { status: "replied", reply };
}

export function readCoordinationReply({ root = ".", environment = process.env, bindingToken, messageId } = {}) {
  const ctx = authenticate({ root, environment, bindingToken, action: "a role reply is read" });
  if (!MESSAGE_ID.test(String(messageId || ""))) fail("Reply message identity is invalid.", "INVALID_COORDINATION_MESSAGE_ID");
  const reply = replyForSender(ctx, messageId);
  if (!reply) return { status: "pending", messageId };
  return { status: "replied", reply };
}

export function inspectRoleCoordination({ root = ".", environment = process.env } = {}) {
  const ctx = context({ root, environment, create: false, action: "role coordination status is read" });
  const generation = currentGeneration(ctx, { required: false });
  if (!generation) return { status: "not_opened", projectId: ctx.inspected.project.projectId, headSessionId: ctx.inspected.state.sessionId };
  const rolesDirectory = path.join(ctx.stateRoot, "generation-state", generation.authorityGeneration, "bindings", "roles");
  let boundRoles = [];
  try {
    boundRoles = fs.readdirSync(rolesDirectory).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return {
    status: "active",
    projectId: generation.projectId,
    headSessionId: generation.headSessionId,
    authorityGeneration: generation.authorityGeneration,
    previousAuthorityGeneration: generation.previousAuthorityGeneration,
    boundRoles,
    stateLocation: "host-local-operational-root",
    projectCanonMutated: false,
    publicRoleTools: ["send", "read-inbox", "reply"],
    adminOnlyOperations: ["open-generation", "rotate-generation", "issue-role-binding"],
    delivery: "optional-effect-after-durable-inbox-acceptance",
    instructionAuthority: false,
    decisionAuthority: false,
    promotionAuthority: false,
    canonMutationAuthority: false,
    providerSessionIdentityPersisted: false,
  };
}
