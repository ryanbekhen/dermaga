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
	// What each stream is about, for the few that are worth telling the user
	// about when they end. Only work with a name somebody would recognise --
	// an image being built, a machine being made -- has one; following a log
	// does not, and neither does anything else nobody is waiting on.
	named map[string]string
	// The streams the window has filed as a task, and what they have printed.
	//
	// Kept here because the window is not always there to keep it. A build is
	// minutes long and the window can be closed for all of them -- that is the
	// case the finish notification exists for -- and until this, the output
	// lived in the window's memory and was written to the shelf by the window,
	// when it finished, if it was still open. Which meant the one run somebody
	// was told about afterwards was the one run there was nothing to read.
	filed    map[string]*filing
	sequence atomic.Uint64

	// Where a finished filing goes. Set by the agent, which owns the shelf.
	shelve func(id string, f *filing, err error)
}

// filing is what the window said a stream is, and what the stream has said
// since.
type filing struct {
	// The window's own name for it -- `build:api-dev` rather than `build-7`.
	// The two are filed together so a notification, which knows only the
	// second, can still find the first.
	taskID string
	kind   string
	label  string

	lines []string
	// How much of `lines` is being held, so the limit below is a size and not
	// a guess at one.
	size int
	// Whether anything was let go of to stay under it.
	trimmed bool
}

// How much of one stream's output is kept.
//
// Bytes rather than lines, because a line has no size: a pull writes progress
// as one very long line per layer, and a thousand of those is not the same
// thing as a thousand lines of a compiler. Quarter of a megabyte is a long
// build's worth of ordinary output, and ten of these on the shelf is still
// smaller than the smallest image layer.
//
// The tail is what is kept. A command that failed says why at the end.
const keptOutput = 256 * 1024

func newStreams(server *rpc.Server) *streams {
	return &streams{
		server:   server,
		cancels:  map[string]context.CancelFunc{},
		sessions: map[string]*terminal.Session{},
		named:    map[string]string{},
		filed:    map[string]*filing{},
	}
}

// file notes that the window has filed a stream as a task, under a name of its
// own. From here on the stream's output is kept.
func (s *streams) file(streamID, taskID, kind, label string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Not if it has already ended: a filing made after the fact would keep
	// nothing and be written out empty over the record that has the output.
	if _, running := s.cancels[streamID]; !running {
		return
	}

	s.filed[streamID] = &filing{taskID: taskID, kind: kind, label: label}
}

// keep adds a line to what is held for a stream, if anything is.
func (s *streams) keep(id, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	f := s.filed[id]
	if f == nil {
		return
	}

	f.lines = append(f.lines, line)
	f.size += len(line) + 1

	for f.size > keptOutput && len(f.lines) > 1 {
		f.size -= len(f.lines[0]) + 1
		f.lines = f.lines[1:]
		f.trimmed = true
	}
}

// takeFiling reads what was held for a stream and forgets it, since a stream
// ends once.
func (s *streams) takeFiling(id string) *filing {
	s.mu.Lock()
	defer s.mu.Unlock()

	f := s.filed[id]
	delete(s.filed, id)

	return f
}

// output is what the shelf should hold: the lines, said to be the tail where
// that is what they are.
func (f *filing) output() []string {
	if !f.trimmed {
		return f.lines
	}

	return append([]string{"[earlier output dropped]"}, f.lines...)
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
	delete(s.named, id)
	// The filing is not dropped here. Cancelling kills the command, the command
	// ending is what calls `end`, and `end` is where what it printed is written
	// down -- a build somebody stopped halfway is still a build whose output
	// says why they stopped it.
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
	// Held as well as sent, for the streams the window has filed. A terminal's
	// chunks are base64 and not lines, and nothing files one, so this only ever
	// keeps text somebody could read back.
	if line, ok := chunk.(string); ok {
		s.keep(id, line)
	}

	s.server.Notify("stream.data", map[string]any{"id": id, "chunk": chunk})
}

func (s *streams) end(id string, err error) {
	params := map[string]any{"id": id}
	if err != nil {
		params["error"] = err.Error()
	}

	// Named work says what it was, so whatever is listening can tell somebody
	// it has finished -- including when there is no window left to tell.
	if label := s.takeName(id); label != "" {
		params["label"] = label
	}

	s.server.Notify("stream.end", params)

	// The shelf, before the stream is forgotten. Whether a window is listening
	// makes no difference here, which is the whole point: the run somebody is
	// told about by a notification is exactly the run they were not watching.
	if f := s.takeFiling(id); f != nil && s.shelve != nil {
		s.shelve(id, f, err)
	}

	s.cancel(id)
}

// runNamed is runCommand for work worth announcing when it ends.
//
// The label is what a person would call it -- `api:dev`, not `build-7` -- and
// its presence is also the signal: a stream with a name raises a notification
// when it finishes, one without goes quietly. Following a log should never
// interrupt anybody, and neither should the dozen small commands the window
// runs on its own account.
func (s *streams) runNamed(
	ctx context.Context,
	prefix, label string,
	build func(context.Context) (*exec.Cmd, error),
) (string, error) {
	return s.runNamedThen(ctx, prefix, label, build, nil)
}

// runNamedThen is runNamed with something to clear up afterwards.
func (s *streams) runNamedThen(
	ctx context.Context,
	prefix, label string,
	build func(context.Context) (*exec.Cmd, error),
	done func(),
) (string, error) {
	id, err := s.runCommandThen(ctx, prefix, build, done)
	if err != nil || label == "" {
		return id, err
	}

	s.mu.Lock()
	s.named[id] = label
	s.mu.Unlock()

	return id, nil
}

// takeName reads a stream's label and forgets it, since a stream ends once.
func (s *streams) takeName(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()

	label := s.named[id]
	delete(s.named, id)

	return label
}

// runCommand streams a command's output line by line. The CLI writes progress
// to stderr as well as stdout, so both are folded together -- a pull's progress
// and its failure arrive on the same channel.
func (s *streams) runCommand(ctx context.Context, prefix string, build func(context.Context) (*exec.Cmd, error)) (string, error) {
	return s.runCommandThen(ctx, prefix, build, nil)
}

// runCommandThen is runCommand with something to do once the command has
// finished, whichever way it went.
//
// The request returns as soon as the command starts -- that is the point of a
// stream -- so anything the command needs on disk cannot be cleaned up by the
// handler that made it. A build from a pasted Dockerfile is exactly that: the
// directory holding it has to outlive the request and die with the build.
//
// Not called when starting fails; there is no command to wait on then, and the
// caller still holds the error to tidy up after itself.
func (s *streams) runCommandThen(
	ctx context.Context,
	prefix string,
	build func(context.Context) (*exec.Cmd, error),
	done func(),
) (string, error) {
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

		if done != nil {
			done()
		}
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
