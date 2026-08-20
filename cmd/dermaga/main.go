// Command dermaga is the desktop app: the window, and the broker between it
// and the agent that wraps Apple's `container` CLI.
//
// The window itself lives in internal/window; this is only the entry point and
// the one thing that has to be known at link time.
package main

import (
	"log"

	"github.com/ryanbekhen/dermaga/internal/window"
)

// Version is stamped at build time by the Makefile.
var Version = "0.0.0"

func main() {
	if err := window.Run(Version); err != nil {
		log.Fatal(err)
	}
}
