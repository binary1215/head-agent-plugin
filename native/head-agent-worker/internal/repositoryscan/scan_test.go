package repositoryscan

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestTrackedCorpusMatchesReviewedIdentity(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve repository scan test source")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", "..", "benchmarks", "repository-scan-v1", "basic"))
	result, operationFailure := Scan(FixtureInput(root, []string{}), Limits{
		MaxFiles: 20000, MaxFileBytes: 512 * 1024, MaxTotalBytes: 256 * 1024 * 1024,
	})
	if operationFailure != nil {
		t.Fatal(operationFailure)
	}
	document := result.(map[string]any)
	if document["scanId"] != "repository-scan-1d4ac0c3da5c82dc795bf638" {
		t.Fatalf("unexpected scan identity: %v", document["scanId"])
	}
	summary := document["summary"].(map[string]any)
	if summary["fileCount"] != 10 || summary["symbolCount"].(int) < 1 || summary["bindingCount"].(int) < 1 {
		t.Fatalf("unexpected scan summary: %#v", summary)
	}
	skipped := document["skipped"].(map[string]any)
	if skipped["excludedDirectory"] != 1 || skipped["unsupportedType"] != 1 {
		t.Fatalf("unexpected skipped counts: %#v", skipped)
	}
}
