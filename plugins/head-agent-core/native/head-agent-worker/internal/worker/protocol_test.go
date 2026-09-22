package worker

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func healthRequest(t *testing.T) request {
	t.Helper()
	input := map[string]any{"probe": "head-agent-core"}
	canonicalInput, err := canonicalJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	value := request{
		SchemaVersion:    1,
		Protocol:         protocol{Name: ProtocolName, Version: ProtocolVersion},
		Kind:             "ComputeRequest",
		Operation:        HealthOperation,
		InputDigest:      digest(canonicalInput),
		SemanticProducer: semanticProducer{Name: HealthProducer, Version: HealthVersion},
		Limits: limits{
			TimeoutMS: 30000, MaxInputBytes: 16 * 1024 * 1024, MaxOutputBytes: 32 * 1024 * 1024,
			MaxFiles: 20000, MaxFileBytes: 512 * 1024, MaxTotalBytes: 256 * 1024 * 1024,
		},
		Input:           canonicalInput,
		AuthorityEffect: "none",
	}
	identity := map[string]any{
		"inputDigest": value.InputDigest, "kind": "ComputeRequest", "limits": value.Limits,
		"operation": value.Operation, "protocol": value.Protocol, "schemaVersion": 1,
		"semanticProducer": value.SemanticProducer,
	}
	canonicalIdentity, err := canonicalJSON(identity)
	if err != nil {
		t.Fatal(err)
	}
	value.RequestID = "compute-request-" + digest(canonicalIdentity)[:24]
	return value
}

func TestHealthProducesAuthorityFreeDeterministicResponse(t *testing.T) {
	value := healthRequest(t)
	encoded, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Run(bytes.NewReader(encoded), &output); err != nil {
		t.Fatal(err)
	}
	var answer response
	if err := json.Unmarshal(output.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Status != "ok" || answer.RequestID != value.RequestID || answer.ResultDigest == "" {
		t.Fatalf("unexpected response: %+v", answer)
	}
	result, ok := answer.Result.(map[string]any)
	if !ok || result["status"] != "ready" || result["instructionAuthority"] != false || result["promotionAuthority"] != false {
		t.Fatalf("unexpected health result: %#v", answer.Result)
	}
}

func TestRejectsTamperedInputDigest(t *testing.T) {
	value := healthRequest(t)
	value.InputDigest = strings.Repeat("f", 64)
	encoded, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := Run(bytes.NewReader(encoded), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "input digest") {
		t.Fatalf("expected digest rejection, got %v", err)
	}
}
