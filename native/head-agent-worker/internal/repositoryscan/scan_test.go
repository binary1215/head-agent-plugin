package repositoryscan

import (
	"os"
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
	if document["scanId"] != "repository-scan-13e0ce69d2a574c1ac81639e" {
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

func TestTrackedCorpusHonorsExplicitSourceScope(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve repository scan test source")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", "..", "benchmarks", "repository-scan-v1", "basic"))
	result, operationFailure := Scan(FixtureInputWithScope(root, []string{}, []any{"src"}, []any{"src/tool.py"}), Limits{
		MaxFiles: 20000, MaxFileBytes: 512 * 1024, MaxTotalBytes: 256 * 1024 * 1024,
	})
	if operationFailure != nil {
		t.Fatal(operationFailure)
	}
	document := result.(map[string]any)
	summary := document["summary"].(map[string]any)
	if summary["fileCount"] != 2 {
		t.Fatalf("unexpected scoped summary: %#v", summary)
	}
	skipped := document["skipped"].(map[string]any)
	if skipped["outsideSourceScope"].(int) < 1 {
		t.Fatalf("source-scope exclusions were not recorded: %#v", skipped)
	}
}

func TestRepositoryScanExcludesPythonRuntimeAndCacheDirectories(t *testing.T) {
	root := t.TempDir()
	for _, relative := range []string{"src", ".uv-python/lib", ".pytest_cache/state"} {
		if err := os.MkdirAll(filepath.Join(root, relative), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, relative := range []string{"src/app.py", ".uv-python/lib/runtime.py", ".pytest_cache/state/cache.py"} {
		if err := os.WriteFile(filepath.Join(root, relative), []byte("value = 1\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	result, operationFailure := Scan(FixtureInput(root, []string{}), Limits{
		MaxFiles: 20000, MaxFileBytes: 512 * 1024, MaxTotalBytes: 256 * 1024 * 1024,
	})
	if operationFailure != nil {
		t.Fatal(operationFailure)
	}
	document := result.(map[string]any)
	summary := document["summary"].(map[string]any)
	skipped := document["skipped"].(map[string]any)
	if summary["fileCount"] != 1 || skipped["excludedDirectory"] != 2 {
		t.Fatalf("technical Python directories entered product evidence: summary=%#v skipped=%#v", summary, skipped)
	}
}
