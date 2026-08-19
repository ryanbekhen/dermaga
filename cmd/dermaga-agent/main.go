// Command dermaga-agent is the process behind the Dermaga desktop app. It
// speaks JSON-RPC 2.0 as newline-delimited JSON and wraps Apple's `container`
// CLI.
//
// Two ways to run it:
//
//	dermaga-agent            a Unix socket in ~/.dermaga, for an agent that
//	                         outlives any one window -- the app connects, and
//	                         watching and supervising carry on when it closes
//	dermaga-agent --stdio    stdin and stdout, for an agent owned by whoever
//	                         spawned it and gone the moment they are
//
// It opens no ports either way. The socket is in the user's own directory and
// readable only by them.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/ryanbekhen/dermaga/internal/agent"
	"github.com/ryanbekhen/dermaga/internal/rpc"
)

// Stamped at build time by the Makefile:
//
//	-ldflags "-X main.Version=1.2.3 -X main.Commit=abc1234 -X main.BuildDate=..."
//
// A release build reports the tag it was cut from and the commit it contains,
// which is what the status bar shows.
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildDate = ""
)

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v") {
		fmt.Printf("%s (%s)\n", Version, Commit)
		return
	}

	// Logs go to stderr because stdout carries the protocol.
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	logger.Info("Starting Dermaga agent", "version", Version, "commit", Commit)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	server := rpc.NewServer(logger)

	dermaga := agent.New(server, logger)
	dermaga.SetBuild(agent.Build{Version: Version, Commit: Commit, Date: BuildDate})

	stdio := len(os.Args) > 1 && os.Args[1] == "--stdio"

	var err error
	if stdio {
		err = dermaga.Run(ctx, os.Stdin, os.Stdout)
	} else {
		socket, socketErr := agent.SocketPath()
		if socketErr != nil {
			logger.Error("Could not work out where to put the socket", "error", socketErr)
			os.Exit(1)
		}

		logger.Info("Listening", "socket", socket)
		err = dermaga.Listen(ctx, socket)
	}

	// Someone else got there first, which is the answer rather than a problem:
	// there is an agent, and it is not this one.
	if errors.Is(err, rpc.ErrAlreadyServing) {
		logger.Info("An agent is already listening; leaving it to it")
		return
	}

	if err != nil {
		logger.Error("Agent stopped", "error", err)
		os.Exit(1)
	}

	logger.Info("Agent stopped")
}
