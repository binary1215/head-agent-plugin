//go:build windows

// Test-only crash injection for one retained native job. Never shipped or
// invoked by Core. Query and terminate use the same generation-bound handle.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func run() error {
	if len(os.Args) != 4 || (os.Args[1] != "inspect" && os.Args[1] != "crash") {
		return fmt.Errorf("expected inspect|crash exact-request-file expected-owner-token")
	}
	requestFile := os.Args[2]
	resolved, err := filepath.EvalSymlinks(requestFile)
	if err != nil || !filepath.IsAbs(requestFile) || resolved != filepath.Clean(requestFile) || filepath.Base(requestFile) != "request.json" {
		return fmt.Errorf("not an exact retained job request")
	}
	data, err := os.ReadFile(requestFile)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(data)
	claimBytes, err := os.ReadFile(filepath.Join(filepath.Dir(requestFile), "claim.json"))
	if err != nil {
		return err
	}
	var claim struct {
		PID           int    `json:"pid"`
		OwnerToken    string `json:"ownerToken"`
		RequestDigest string `json:"requestDigest"`
	}
	if err = json.Unmarshal(claimBytes, &claim); err != nil {
		return err
	}
	if claim.PID <= 0 || uint64(claim.PID) > 0xffffffff || claim.RequestDigest != hex.EncodeToString(digest[:]) {
		return fmt.Errorf("claim does not bind this request")
	}
	result := map[string]any{"pid": claim.PID, "helperPid": os.Getpid(), "parentPid": os.Getppid(), "ports": []int{}, "terminationAttempted": false}
	if claim.OwnerToken == "" || claim.OwnerToken != os.Args[3] {
		result["status"] = "generation-mismatch"
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	access := uint32(0x1000 | 0x00100000)
	if os.Args[1] == "crash" {
		access |= 0x0001
	}
	handle, err := syscall.OpenProcess(access, false, uint32(claim.PID))
	if err == syscall.Errno(87) {
		result["status"] = "gone"
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(handle)
	var created, exited, kernel, user syscall.Filetime
	if err = syscall.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return err
	}
	token := fmt.Sprintf("windows-filetime-%08x%08x", created.HighDateTime, created.LowDateTime)
	result["observedToken"] = token
	if token != claim.OwnerToken {
		result["status"] = "reused"
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	state, err := syscall.WaitForSingleObject(handle, 0)
	if err != nil {
		return err
	}
	if state == 0 {
		result["status"] = "gone"
		return json.NewEncoder(os.Stdout).Encode(result)
	}
	if state != 258 {
		return fmt.Errorf("owner state unavailable: %d", state)
	}
	result["status"] = "present"
	if os.Args[1] == "crash" {
		// Deliberate fault while the owner is running, not a cleanup fallback.
		// Normal cleanup remains the public cancellation path in the JS fixture.
		if err = syscall.TerminateProcess(handle, 99); err != nil {
			return err
		}
		result["terminationAttempted"] = true
		state, err = syscall.WaitForSingleObject(handle, 5000)
		if err != nil || state != 0 {
			return fmt.Errorf("owned crash did not settle: %d %v", state, err)
		}
		result["status"] = "crash-injected"
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
