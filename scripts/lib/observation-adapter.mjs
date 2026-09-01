import {
  OBSERVATION_PROTOCOL_VERSION,
  createObservationTypeDescriptor,
  observationDigest,
  stableKey,
  verifyObservationTypeDescriptor,
} from "./observation-contract.mjs";
import { recordCollectedObservation } from "./observation-store.mjs";

const fail = (message, code = "OBSERVATION_ADAPTER_ERROR") => { const error = new Error(message); error.code = code; throw error; };

function digestValue(value, label) {
  const normalized = String(value || "").toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail(`${label} must be a SHA-256 digest.`, "INVALID_OBSERVATION_SOURCE_BINDING");
  return normalized;
}
export function normalizeObservationSourceBinding(binding = {}) {
  const allowed = new Set(["adapterKey", "adapterVersion", "sourceScopeDigest", "credentialReferenceNames"]);
  if (!binding || typeof binding !== "object" || Array.isArray(binding) || Object.keys(binding).some((key) => !allowed.has(key))) fail("ObservationSourceBinding fields are invalid.", "INVALID_OBSERVATION_SOURCE_BINDING");
  const credentialReferenceNames = Array.isArray(binding.credentialReferenceNames) ? [...new Set(binding.credentialReferenceNames.map((item) => String(item).trim()))].sort() : [];
  if (credentialReferenceNames.length > 16 || credentialReferenceNames.some((item) => !/^[A-Z][A-Z0-9_]{2,127}$/u.test(item))) fail("ObservationSourceBinding credential references are invalid.", "INVALID_OBSERVATION_SOURCE_BINDING");
  return {
    adapterKey: stableKey(binding.adapterKey, "ObservationSourceBinding adapterKey", 192),
    adapterVersion: stableKey(binding.adapterVersion, "ObservationSourceBinding adapterVersion", 64),
    sourceScopeDigest: digestValue(binding.sourceScopeDigest, "ObservationSourceBinding sourceScopeDigest"),
    credentialReferenceNames,
  };
}

export class StructuredObservationAdapter {
  constructor({ descriptor, input } = {}) {
    this.adapterVersion = OBSERVATION_PROTOCOL_VERSION;
    this.descriptor = descriptor?.kind === "ObservationTypeDescriptor" ? verifyObservationTypeDescriptor(descriptor) : createObservationTypeDescriptor(descriptor);
    this.input = input;
  }

  describe() {
    return {
      adapterKey: "head.structured-host-observation",
      adapterVersion: this.adapterVersion,
      descriptorId: this.descriptor.descriptorId,
      descriptorHash: this.descriptor.descriptorHash,
      authority: "observed-evidence-only",
      providerNeutral: true,
      persistsCredentials: false,
      persistsProviderIdentity: false,
      executesProjectCode: false,
    };
  }

  collect() { return this.input; }
}

export function assertObservationAdapter(adapter, binding, descriptor) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.describe !== "function" || typeof adapter.collect !== "function") fail("ObservationAdapter is invalid.", "INVALID_OBSERVATION_ADAPTER");
  const selectedBinding = normalizeObservationSourceBinding(binding);
  const selectedDescriptor = descriptor?.kind === "ObservationTypeDescriptor" ? verifyObservationTypeDescriptor(descriptor) : createObservationTypeDescriptor(descriptor);
  const described = adapter.describe();
  if (described.adapterKey !== selectedBinding.adapterKey || described.adapterVersion !== selectedBinding.adapterVersion
    || described.descriptorId !== selectedDescriptor.descriptorId || described.descriptorHash !== selectedDescriptor.descriptorHash
    || described.authority !== "observed-evidence-only" || described.providerNeutral !== true
    || described.persistsCredentials !== false || described.persistsProviderIdentity !== false || described.executesProjectCode !== false) fail("ObservationAdapter crosses its source, descriptor, or authority boundary.", "INVALID_OBSERVATION_ADAPTER_AUTHORITY");
  return { adapter, binding: selectedBinding, descriptor: selectedDescriptor, descriptorDigest: observationDigest(described), described };
}

export async function collectObservation({ root = ".", binding, descriptor, adapter } = {}) {
  const asserted = assertObservationAdapter(adapter, binding, descriptor);
  const input = await asserted.adapter.collect({ root, sourceScopeDigest: asserted.binding.sourceScopeDigest, credentialReferenceNames: [...asserted.binding.credentialReferenceNames] });
  const recorded = recordCollectedObservation({ root, descriptor: asserted.descriptor, input, adapterDescriptor: asserted.described, sourceScopeDigest: asserted.binding.sourceScopeDigest });
  return {
    status: recorded.status,
    descriptor: recorded.descriptor,
    observation: recorded.observation,
    receipt: recorded.receipt,
    adapter: asserted.described,
    sourceBinding: {
      adapterKey: asserted.binding.adapterKey,
      adapterVersion: asserted.binding.adapterVersion,
      sourceScopeDigest: asserted.binding.sourceScopeDigest,
      credentialReferenceCount: asserted.binding.credentialReferenceNames.length,
      credentialsPersisted: false,
    },
    authority: { observation: "P3-evidence-only", productCanonMutated: false, reviewDecisionCreated: false, recoveryDirectionMutated: false },
  };
}

export async function ingestStructuredObservation({ root = ".", binding, descriptor, input } = {}) {
  return collectObservation({ root, binding, descriptor, adapter: new StructuredObservationAdapter({ descriptor, input }) });
}

export function inspectObservationSources() {
  return {
    status: "available",
    protocol: { name: "head-agent-core-observation", version: OBSERVATION_PROTOCOL_VERSION },
    adapters: [{
      adapterKey: "head.structured-host-observation",
      adapterVersion: OBSERVATION_PROTOCOL_VERSION,
      mode: "host-supplied-bounded-input",
      requiresExactSourceBinding: true,
      remoteCollectionWithoutBinding: false,
      authority: "observed-evidence-only",
      providerNeutral: true,
    }],
    dynamicProjectCodeLoading: false,
    missingOptionalAdaptersBlockCore: false,
  };
}
