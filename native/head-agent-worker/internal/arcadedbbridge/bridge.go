package arcadedbbridge

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	ProtocolName     = "head-agent-core-arcadedb-query-batch"
	ProtocolVersion  = "0.1.0"
	maximumWireBytes = 64 * 1024 * 1024
)

type protocol struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type secretReferenceNames struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type query struct {
	Language string                     `json:"language"`
	Command  string                     `json:"command"`
	Params   map[string]json.RawMessage `json:"params"`
}

type request struct {
	Protocol             protocol             `json:"protocol"`
	Endpoint             string               `json:"endpoint"`
	Database             string               `json:"database"`
	SecretReferenceNames secretReferenceNames `json:"secretReferenceNames"`
	Operation            string               `json:"operation"`
	TimeoutMS            int                  `json:"timeoutMs"`
	Queries              []query              `json:"queries"`
}

type queryResponse struct {
	Status int `json:"status"`
	Body   any `json:"body"`
}

type successBody struct {
	Responses []queryResponse `json:"responses"`
}

type response struct {
	OK               bool         `json:"ok"`
	Status           int          `json:"status,omitempty"`
	Body             any          `json:"body,omitempty"`
	FailedQueryIndex *int         `json:"failedQueryIndex,omitempty"`
	Error            *bridgeError `json:"error,omitempty"`
}

type bridgeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func decodeStrict(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("bridge input contains trailing JSON")
	}
	return nil
}

func requiredText(value string) bool {
	return strings.TrimSpace(value) != ""
}

func readOnlySQL(value query) bool {
	command := strings.TrimSpace(value.Command)
	lower := strings.ToLower(command)
	return strings.EqualFold(strings.TrimSpace(value.Language), "sql") &&
		(lower == "select" || strings.HasPrefix(lower, "select ") || strings.HasPrefix(lower, "select\n") || strings.HasPrefix(lower, "select\t")) &&
		!strings.Contains(command, ";") && !strings.Contains(command, "--") &&
		!strings.Contains(command, "/*") && !strings.Contains(command, "*/")
}

func validate(value request) error {
	if value.Protocol.Name != ProtocolName || value.Protocol.Version != ProtocolVersion || value.Operation != "query-batch" {
		return errors.New("bridge protocol or operation is incompatible")
	}
	endpoint, err := url.Parse(strings.TrimRight(value.Endpoint, "/"))
	if err != nil || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.Host == "" || endpoint.User != nil {
		return errors.New("bridge endpoint is invalid")
	}
	if !requiredText(value.Database) || !requiredText(value.SecretReferenceNames.Username) || !requiredText(value.SecretReferenceNames.Password) {
		return errors.New("bridge database or secret reference is missing")
	}
	if value.TimeoutMS < 1000 || value.TimeoutMS > 120000 || len(value.Queries) < 1 || len(value.Queries) > 8 {
		return errors.New("bridge limits are invalid")
	}
	for _, item := range value.Queries {
		if !requiredText(item.Language) || !requiredText(item.Command) || !readOnlySQL(item) {
			return errors.New("bridge query is invalid")
		}
		if item.Params == nil {
			item.Params = map[string]json.RawMessage{}
		}
	}
	return nil
}

func writeResponse(output io.Writer, value response) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func errorResponse(output io.Writer, code string, message string) int {
	_ = writeResponse(output, response{OK: false, Error: &bridgeError{Code: code, Message: message}})
	return 1
}

func Run(input io.Reader, output io.Writer, client *http.Client) int {
	data, err := io.ReadAll(io.LimitReader(input, maximumWireBytes+1))
	if err != nil || len(data) > maximumWireBytes {
		return errorResponse(output, "ARCADEDB_BRIDGE_INVALID_INPUT", "ArcadeDB bridge input exceeds its bounded wire limit.")
	}
	var value request
	if err := decodeStrict(data, &value); err != nil || validate(value) != nil {
		return errorResponse(output, "ARCADEDB_BRIDGE_INVALID_INPUT", "ArcadeDB bridge input is invalid.")
	}
	username, usernamePresent := os.LookupEnv(value.SecretReferenceNames.Username)
	password, passwordPresent := os.LookupEnv(value.SecretReferenceNames.Password)
	if !usernamePresent || username == "" || !passwordPresent || password == "" {
		_ = writeResponse(output, response{OK: false, Error: &bridgeError{
			Code: "ARCADEDB_CREDENTIALS_UNAVAILABLE", Message: "ArcadeDB credential references are unavailable in the process environment.",
		}})
		return 2
	}
	if client == nil {
		client = &http.Client{Timeout: time.Duration(value.TimeoutMS) * time.Millisecond}
	}
	endpoint := strings.TrimRight(value.Endpoint, "/") + "/api/v1/query/" + url.PathEscape(strings.TrimSpace(value.Database))
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
	responses := make([]queryResponse, 0, len(value.Queries))
	for index, item := range value.Queries {
		payload, err := json.Marshal(map[string]any{"language": strings.TrimSpace(item.Language), "command": strings.TrimSpace(item.Command), "params": item.Params})
		if err != nil {
			return errorResponse(output, "ARCADEDB_BRIDGE_INVALID_INPUT", "ArcadeDB query batch could not be encoded.")
		}
		httpRequest, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return errorResponse(output, "ARCADEDB_BRIDGE_INVALID_INPUT", "ArcadeDB request could not be created.")
		}
		httpRequest.Header.Set("Accept", "application/json")
		httpRequest.Header.Set("Content-Type", "application/json")
		httpRequest.Header.Set("Authorization", authorization)
		httpResponse, err := client.Do(httpRequest)
		if err != nil {
			_ = writeResponse(output, response{OK: false, Error: &bridgeError{Code: "ARCADEDB_TRANSPORT_UNAVAILABLE", Message: "ArcadeDB transport is unavailable."}})
			return 2
		}
		bodyBytes, readErr := io.ReadAll(io.LimitReader(httpResponse.Body, maximumWireBytes+1))
		closeErr := httpResponse.Body.Close()
		if readErr != nil || closeErr != nil || len(bodyBytes) > maximumWireBytes {
			_ = writeResponse(output, response{OK: false, Error: &bridgeError{Code: "ARCADEDB_REQUEST_FAILED", Message: "ArcadeDB response could not be read."}})
			return 1
		}
		var body any
		if len(bodyBytes) > 0 && json.Unmarshal(bodyBytes, &body) != nil {
			message := string(bodyBytes)
			if len(message) > 1000 {
				message = message[:1000]
			}
			body = map[string]any{"message": message}
		}
		if httpResponse.StatusCode < 200 || httpResponse.StatusCode > 299 {
			failedIndex := index
			_ = writeResponse(output, response{OK: false, Status: httpResponse.StatusCode, Body: body, FailedQueryIndex: &failedIndex})
			return 3
		}
		responses = append(responses, queryResponse{Status: httpResponse.StatusCode, Body: body})
	}
	if err := writeResponse(output, response{OK: true, Status: http.StatusOK, Body: successBody{Responses: responses}}); err != nil {
		fmt.Fprintln(os.Stderr, "write bridge response failed")
		return 1
	}
	return 0
}
