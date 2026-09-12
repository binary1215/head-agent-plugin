package processsupervisor

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const ProtocolVersion = "0.1.0"

const (
	maxRequestBytes = 8 * 1024 * 1024
	maxInputBytes   = 4 * 1024 * 1024
)

type Request struct {
	SchemaVersion      int               `json:"schemaVersion"`
	ProtocolVersion    string            `json:"protocolVersion"`
	Executable         string            `json:"executable"`
	Arguments          []string          `json:"arguments"`
	WorkingDirectory   string            `json:"workingDirectory"`
	Environment        map[string]string `json:"environment"`
	InputBase64        string            `json:"inputBase64"`
	ControlFile        string            `json:"controlFile"`
	TerminationGraceMS int               `json:"terminationGraceMs"`
}

type controlEvent struct {
	Type                     string `json:"type"`
	ProtocolVersion          string `json:"protocolVersion"`
	Strategy                 string `json:"strategy,omitempty"`
	TreeOwnershipEstablished bool   `json:"treeOwnershipEstablished"`
	ProviderPID              int    `json:"providerPid,omitempty"`
	ExitCode                 *int   `json:"exitCode,omitempty"`
	CleanupAttempted         bool   `json:"cleanupAttempted"`
	CleanupVerified          bool   `json:"cleanupVerified"`
	ForceUsed                bool   `json:"forceUsed"`
	KernelCleanupOnExit      bool   `json:"kernelCleanupOnExit"`
}

type cleanupResult struct {
	Attempted           bool
	Verified            bool
	ForceUsed           bool
	KernelCleanupOnExit bool
}

type platformController interface {
	Strategy() string
	Configure(*exec.Cmd)
	Terminate(pid int, force bool) error
	CleanupAfterProviderExit(pid int, grace time.Duration) cleanupResult
}

type eventWriter struct {
	mu      sync.Mutex
	encoder *json.Encoder
}

func (writer *eventWriter) emit(event controlEvent) error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	event.ProtocolVersion = ProtocolVersion
	return writer.encoder.Encode(event)
}

func validateRequest(request Request) ([]byte, error) {
	if request.SchemaVersion != 1 || request.ProtocolVersion != ProtocolVersion {
		return nil, errors.New("supervisor request protocol is incompatible")
	}
	if !filepath.IsAbs(request.Executable) || strings.ContainsRune(request.Executable, '\x00') {
		return nil, errors.New("supervisor executable must be an absolute path")
	}
	stat, err := os.Stat(request.Executable)
	if err != nil || stat.IsDir() {
		return nil, errors.New("supervisor executable is not a regular file")
	}
	if !filepath.IsAbs(request.WorkingDirectory) || strings.ContainsRune(request.WorkingDirectory, '\x00') {
		return nil, errors.New("supervisor working directory must be absolute")
	}
	if stat, err := os.Stat(request.WorkingDirectory); err != nil || !stat.IsDir() {
		return nil, errors.New("supervisor working directory is unavailable")
	}
	if len(request.Arguments) > 256 || len(request.Environment) > 256 {
		return nil, errors.New("supervisor argument or environment count exceeds its bound")
	}
	for _, argument := range request.Arguments {
		if strings.ContainsRune(argument, '\x00') || len(argument) > 64*1024 {
			return nil, errors.New("supervisor argument is invalid")
		}
	}
	for key, value := range request.Environment {
		if key == "" || strings.ContainsAny(key, "=\x00") || strings.ContainsRune(value, '\x00') || len(key)+len(value) > 64*1024 {
			return nil, errors.New("supervisor environment is invalid")
		}
	}
	if request.TerminationGraceMS < 100 || request.TerminationGraceMS > 10_000 {
		return nil, errors.New("supervisor termination grace is outside its bound")
	}
	if !filepath.IsAbs(request.ControlFile) || strings.ContainsRune(request.ControlFile, '\x00') {
		return nil, errors.New("supervisor control file must be an absolute path")
	}
	input, err := base64.StdEncoding.DecodeString(request.InputBase64)
	if err != nil || len(input) > maxInputBytes {
		return nil, errors.New("supervisor input is invalid or exceeds its bound")
	}
	return input, nil
}

func readRequest(reader io.Reader) (Request, []byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxRequestBytes+1))
	if err != nil || len(data) > maxRequestBytes {
		return Request{}, nil, errors.New("supervisor request exceeds its bound")
	}
	var request Request
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return Request{}, nil, fmt.Errorf("supervisor request is invalid: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Request{}, nil, errors.New("supervisor request contains trailing data")
	}
	input, err := validateRequest(request)
	return request, input, err
}

func environmentList(environment map[string]string) []string {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+environment[key])
	}
	return result
}

func processExitCode(state *os.ProcessState, waitError error) int {
	if state != nil && state.ExitCode() >= 0 {
		return state.ExitCode()
	}
	if waitError == nil {
		return 0
	}
	return 1
}

func Run(reader io.Reader, stdout io.Writer, stderr io.Writer) (int, error) {
	request, input, err := readRequest(reader)
	if err != nil {
		return 2, err
	}
	controlFile, err := os.OpenFile(request.ControlFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return 2, fmt.Errorf("supervisor control file could not be created: %w", err)
	}
	defer controlFile.Close()
	controller, err := newPlatformController()
	if err != nil {
		return 2, fmt.Errorf("process-tree ownership could not be established: %w", err)
	}
	events := &eventWriter{encoder: json.NewEncoder(controlFile)}
	if err := events.emit(controlEvent{
		Type:                     "supervisor.ready",
		Strategy:                 controller.Strategy(),
		TreeOwnershipEstablished: true,
	}); err != nil {
		return 2, errors.New("supervisor control channel rejected readiness evidence")
	}

	command := exec.Command(request.Executable, request.Arguments...)
	command.Dir = request.WorkingDirectory
	command.Env = environmentList(request.Environment)
	command.Stdin = bytes.NewReader(input)
	command.Stdout = stdout
	command.Stderr = stderr
	controller.Configure(command)
	if err := command.Start(); err != nil {
		return 2, fmt.Errorf("provider process could not start: %w", err)
	}
	providerPID := command.Process.Pid
	if err := events.emit(controlEvent{
		Type:                     "provider.started",
		Strategy:                 controller.Strategy(),
		TreeOwnershipEstablished: true,
		ProviderPID:              providerPID,
	}); err != nil {
		_ = controller.Terminate(providerPID, true)
		_ = command.Wait()
		return 2, errors.New("supervisor control channel rejected provider ownership evidence")
	}

	waitChannel := make(chan error, 1)
	go func() { waitChannel <- command.Wait() }()
	signalChannel := make(chan os.Signal, 1)
	signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signalChannel)
	terminationRequested := false
	forceUsed := false
	var waitError error
	select {
	case waitError = <-waitChannel:
	case <-signalChannel:
		terminationRequested = true
		_ = controller.Terminate(providerPID, false)
		select {
		case waitError = <-waitChannel:
		case <-time.After(time.Duration(request.TerminationGraceMS) * time.Millisecond):
			forceUsed = true
			_ = controller.Terminate(providerPID, true)
			waitError = <-waitChannel
		}
	}

	exitCode := processExitCode(command.ProcessState, waitError)
	if terminationRequested && exitCode == 0 {
		exitCode = 143
	}
	_ = events.emit(controlEvent{Type: "provider.exited", ProviderPID: providerPID, ExitCode: &exitCode})
	cleanup := controller.CleanupAfterProviderExit(providerPID, time.Duration(request.TerminationGraceMS)*time.Millisecond)
	cleanup.ForceUsed = cleanup.ForceUsed || forceUsed
	if err := events.emit(controlEvent{
		Type:                "supervisor.cleanup",
		Strategy:            controller.Strategy(),
		CleanupAttempted:    cleanup.Attempted,
		CleanupVerified:     cleanup.Verified,
		ForceUsed:           cleanup.ForceUsed,
		KernelCleanupOnExit: cleanup.KernelCleanupOnExit,
	}); err != nil {
		return 2, errors.New("supervisor control channel rejected cleanup evidence")
	}
	return exitCode, nil
}
