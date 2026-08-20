// Package assets holds everything the window ships that is not Go: the built
// frontend and the menu bar icons.
//
// They live here rather than beside the code because `go:embed` cannot reach
// outside its own package directory -- and here rather than in the window
// package itself so that directory stays source, with the blobs and the build
// output kept apart from it.
package assets

import "embed"

// Frontend is the built window: Vite writes into dist, and this is what the
// asset server serves.
//
//go:embed all:dist
var Frontend embed.FS

// TrayRunning is the menu bar icon while the container services are up.
//
//go:embed icons/trayTemplate@2x.png
var TrayRunning []byte

// TrayStopped is the same mark, hollow, for when they are not.
//
//go:embed icons/trayStoppedTemplate@2x.png
var TrayStopped []byte
