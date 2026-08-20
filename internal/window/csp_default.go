//go:build !mcp

package window

// Nothing beyond the app's own origin. The window has no network access of its
// own: everything goes to the agent through the bridge.
const cspConnectExtra = ""
