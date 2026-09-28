package processsupervisor

import (
	"errors"
	"path/filepath"
)

func canonicalJobRequestPath(requestFile string) (string, error) {
	if !filepath.IsAbs(requestFile) {
		return "", errors.New("job request path must be absolute")
	}
	clean := filepath.Clean(requestFile)
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil || !jobPathSpellingMatches(clean, resolved) {
		return "", errors.New("job request path must be canonical")
	}
	// Retain the exact Host spelling for sibling control paths and request
	// digests. A verified Windows 8.3 alias is not a different job or new input.
	return clean, nil
}
