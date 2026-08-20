//go:build mcp

package window

import (
	"os"
)

// A build carrying the mcp tag is a test build, and its harness reports
// results to a local server on another port. Only that build says so; the
// policy the shipped app sends is unchanged.
var cspConnectExtra = " http://127.0.0.1:" + mcpPort()

func mcpPort() string {
	if port := os.Getenv("WAILS_MCP_PORT"); port != "" {
		return port
	}

	return "9099"
}
