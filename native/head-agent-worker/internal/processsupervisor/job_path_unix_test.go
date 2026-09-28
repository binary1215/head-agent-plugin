//go:build !windows

package processsupervisor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestJobPathStillRejectsFileSymlink(t *testing.T) {
	directory, file := jobFixture(t, "success", 5000, 1024)
	link := filepath.Join(directory, "linked-request.json")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if _, err := canonicalJobRequestPath(link); err == nil {
		t.Fatal("file symlink accepted")
	}
	if _, _, _, _, err := readJobRequest(link); err == nil {
		t.Fatal("file symlink reached job execution parsing")
	}
	if err := InspectJobOwner(link); err == nil {
		t.Fatal("file symlink reached historical owner inspection")
	}
}
