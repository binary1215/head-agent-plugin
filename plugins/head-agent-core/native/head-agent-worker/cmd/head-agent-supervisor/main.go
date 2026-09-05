package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/binary1215/head-agent-plugin/native/head-agent-worker/internal/processsupervisor"
)

var version = "0.0.0-dev"
var commit = "unknown"

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version-json" {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"commit":                    commit,
			"version":                   version,
			"supervisorProtocolVersion": processsupervisor.ProtocolVersion,
		})
		return
	}
	if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: head-agent-supervisor [--version-json]")
		os.Exit(2)
	}
	exitCode, err := processsupervisor.Run(os.Stdin, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
	}
	os.Exit(exitCode)
}
