package agent

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/creack/pty"

	"github.com/ryanbekhen/dermaga/internal/rpc"
	"github.com/ryanbekhen/dermaga/internal/terminal"
)

// streams tracks long-running work -- log follows, image pulls, terminals --
// so the client can cancel it and so everything is torn down when the app
// quits. Each has an id the client uses to match notifications.
type streams struct {
	server *rpc.Server

	mu       sync.Mutex
	cancels  map[string]context.CancelFunc
	sessions map[string]*terminal.Session
	sequence atomic.Uint64
}

func newStreams(server *rpc.Server) *streams {
	return &streams{
		server:   server,
		cancels:  map[string]context.CancelFunc{},
		sessions: map[string]*terminal.Session{},
	}
}

func (s *streams) nextID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, s.sequence.Add(1))
}

func (s *streams) register(id string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancels[id] = cancel
}

func (s *streams) session(id string) *terminal.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

func (s *streams) cancel(id string) {
	s.mu.Lock()
	cancel, hasCancel := s.cancels[id]
	session, hasSession := s.sessions[id]
	delete(s.cancels, id)
	delete(s.sessions, id)
	s.mu.Unlock()

	if hasSession {
		session.Close()
	}
	if hasCancel {
		cancel()
	}
}

func (s *streams) closeAll() {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.cancels))
	for _, cancel := range s.cancels {
		cancels = append(cancels, cancel)
	}
	sessions := make([]*terminal.Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.cancels = map[string]context.CancelFunc{}
	s.sessions = map[string]*terminal.Session{}
	s.mu.Unlock()

	for _, session := range sessions {
		session.Close()
	}
	for _, cancel := range cancels {
		cancel()
	}
}

func (s *streams) data(id string, chunk any) {
	s.server.Notify("stream.data", map[string]any{"id": id, "chunk": chunk})
}

func (s *streams) end(id string, err error) {
	params := map[string]any{"id": id}
	if err != nil {
		params["error"] = err.Error()
	}

	s.server.Notify("stream.end", params)
	s.cancel(id)
}

// runCommand streams a command's output line by line. The CLI writes progress
// to stderr as well as stdout, so both are folded together -- a pull's progress
// and its failure arrive on the same channel.
func (s *streams) runCommand(ctx context.Context, prefix string, build func(context.Context) (*exec.Cmd, error)) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	id := s.nextID(prefix)

	cmd, err := build(ctx)
	if err != nil {
		cancel()
		return "", err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return "", err
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		cancel()
		return "", err
	}

	s.register(id, cancel)

	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		for scanner.Scan() {
			s.data(id, scanner.Text())
		}

		// The loop also ends when reading fails -- a line longer than the
		// buffer, a pipe torn down mid-write -- and the output is then
		// truncated rather than finished. Saying so beats reporting whatever
		// the command happened to exit with, which may well be success.
		err := cmd.Wait()
		if readErr := scanner.Err(); readErr != nil && err == nil {
			err = fmt.Errorf("output ended early: %w", readErr)
		}

		s.end(id, err)
	}()

	return id, nil
}

// openTerminal starts a pty session and relays it as base64 chunks, since JSON
// cannot carry arbitrary bytes.
func (s *streams) openTerminal(
	ctx context.Context,
	open func(context.Context, func([]byte), func(error)) (*terminal.Session, error),
) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	id := s.nextID("term")

	session, err := open(
		ctx,
		func(chunk []byte) { s.data(id, base64.StdEncoding.EncodeToString(chunk)) },
		func(err error) { s.end(id, err) },
	)
	if err != nil {
		cancel()
		return "", err
	}

	s.mu.Lock()
	s.cancels[id] = cancel
	s.sessions[id] = session
	s.mu.Unlock()

	return id, nil
}

func decodeParams[T any](params json.RawMessage) (T, error) {
	var value T
	if len(params) == 0 {
		return value, nil
	}

	if err := json.Unmarshal(params, &value); err != nil {
		return value, &rpc.Error{Code: rpc.CodeInvalidParams, Message: err.Error()}
	}

	return value, nil
}

func decodeBase64(data string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, &rpc.Error{Code: rpc.CodeInvalidParams, Message: "data must be base64"}
	}

	return decoded, nil
}

// runCommandTTY is runCommand for tools that refuse to work without a terminal.
//
// `container system kernel set --recommended` is one: given a plain pipe it
// prints one line and then hangs for ever, with no network activity and no
// exit -- which looks exactly like a broken download. Given a pty it gets on
// with it. The output is a redrawing progress bar, so it is split on carriage
// returns as well as newlines and stripped of the escape codes that move the
// cursor about.
func (s *streams) runCommandTTY(
	ctx context.Context,
	prefix string,
	build func(context.Context) (*exec.Cmd, error),
) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	id := s.nextID(prefix)

	cmd, err := build(ctx)
	if err != nil {
		cancel()
		return "", err
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return "", err
	}

	// Wide enough that the CLI does not truncate its own progress line.
	_ = pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 120})

	s.register(id, func() {
		cancel()
		_ = ptmx.Close()
	})

	go func() {
		scanner := bufio.NewScanner(ptmx)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		scanner.Split(scanLinesOrReturns)

		var last string
		for scanner.Scan() {
			line := strings.TrimSpace(ansiPattern.ReplaceAllString(scanner.Text(), ""))
			// The spinner redraws many times a second; only send what changed.
			if line == "" || line == last {
				continue
			}
			last = line
			s.data(id, line)
		}

		// A pty read that fails ends the session as surely as the command
		// exiting, and the reason belongs in the same place.
		readErr := scanner.Err()

		_ = ptmx.Close()

		err := cmd.Wait()
		if readErr != nil && err == nil {
			err = fmt.Errorf("session ended early: %w", readErr)
		}

		s.end(id, err)
	}()

	return id, nil
}

// ansiPattern matches the escape sequences a progress bar uses to move the
// cursor, clear the line and hide itself.
var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f]`)

// scanLinesOrReturns splits on either, because a redrawing bar never emits a
// newline until it is finished.
func scanLinesOrReturns(data []byte, atEOF bool) (int, []byte, error) {
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}

	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}

	return 0, nil, nil
}
