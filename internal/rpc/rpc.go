// Package rpc speaks JSON-RPC 2.0 over a pair of streams -- in practice the
// agent's stdin and stdout. There is no socket and no port: the process that
// spawned the agent is the only thing that can talk to it.
package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Error codes follow the JSON-RPC spec, with one application code for the
// failures that are ordinary here (a CLI command refusing to run).
const (
	CodeParse          = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternal       = -32603
	CodeCommandFailed  = -32000
)

type Request struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Result  any              `json:"result,omitempty"`
	Error   *Error           `json:"error,omitempty"`
}

type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	return e.Message
}

// Fail builds an application-level error, the kind worth showing to a user.
func Fail(message string) *Error {
	return &Error{Code: CodeCommandFailed, Message: message}
}

// ErrAlreadyServing means another agent holds the socket. It is not a failure:
// the one already there is the one to talk to.
var ErrAlreadyServing = errors.New("another Dermaga agent is already listening")

// Handler answers one method. Returning an error turns into a JSON-RPC error.
type Handler func(ctx context.Context, params json.RawMessage) (any, error)

type Server struct {
	logger   *slog.Logger
	handlers map[string]Handler

	// Everyone currently connected. One when the desktop app is open, none
	// when the agent is running on its own with nobody watching.
	mu      sync.Mutex
	clients map[*client]struct{}
}

// client is one connection, with its own writer: responses go back the way the
// request came, and a notification goes to everybody.
type client struct {
	out io.Writer
	mu  sync.Mutex
}

func NewServer(logger *slog.Logger) *Server {
	return &Server{
		logger:   logger,
		handlers: map[string]Handler{},
		clients:  map[*client]struct{}{},
	}
}

func (s *Server) Register(method string, handler Handler) {
	s.handlers[method] = handler
}

// Notify pushes a message nobody asked for: stream data, watcher snapshots,
// terminal output. It reaches whoever is connected, and quietly reaches nobody
// when the app is closed and the agent is working on its own.
func (s *Server) Notify(method string, params any) {
	s.broadcast(Notification{JSONRPC: "2.0", Method: method, Params: params})
}

func (s *Server) broadcast(message any) {
	s.mu.Lock()
	targets := make([]*client, 0, len(s.clients))
	for c := range s.clients {
		targets = append(targets, c)
	}
	s.mu.Unlock()

	for _, c := range targets {
		s.writeTo(c, message)
	}
}

func (s *Server) add(c *client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[c] = struct{}{}
}

func (s *Server) remove(c *client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, c)
}

// Clients reports how many are connected, so the agent can tell whether
// anybody is watching.
func (s *Server) Clients() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}

func (s *Server) writeTo(c *client, message any) {
	encoded, err := json.Marshal(message)
	if err != nil {
		s.logger.Error("Could not encode message", "error", err)
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if _, err := fmt.Fprintf(c.out, "%s\n", encoded); err != nil {
		s.logger.Debug("Could not write message", "error", err)
	}
}

// Serve reads one connection until it closes. Each request runs in its own
// goroutine so a slow CLI call cannot block the rest -- a container pull must
// not freeze the list.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	c := &client{out: out}
	s.add(c)
	defer s.remove(c)

	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		payload := make([]byte, len(line))
		copy(payload, line)

		go s.dispatch(ctx, payload, c)
	}

	return scanner.Err()
}

// Listen serves a Unix socket until the context ends, taking one connection at
// a time in its own goroutine.
//
// The socket lives in the user's own directory with permissions to match: it is
// how the desktop app reaches an agent it did not start, and nothing else on
// the machine can reach it at all.
func (s *Server) Listen(ctx context.Context, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	// One agent per machine. A second one binding over the first would leave
	// two of everything -- two watchers polling the CLI, and later two
	// supervisors racing to restart the same container -- with the first
	// holding a socket nobody can reach any more.
	if conn, err := net.DialTimeout("unix", path, time.Second); err == nil {
		conn.Close()
		return ErrAlreadyServing
	}

	// Nothing answered, so whatever is here is the remains of a crash.
	_ = os.Remove(path)

	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}

	if err := os.Chmod(path, 0o600); err != nil {
		s.logger.Warn("Could not tighten the socket permissions", "error", err)
	}

	go func() {
		<-ctx.Done()
		listener.Close()
		os.Remove(path)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}

		go func() {
			defer conn.Close()
			if err := s.Serve(ctx, conn, conn); err != nil {
				s.logger.Debug("Connection ended", "error", err)
			}
		}()
	}
}

func (s *Server) dispatch(ctx context.Context, payload []byte, c *client) {
	var request Request
	if err := json.Unmarshal(payload, &request); err != nil {
		s.writeTo(c, Response{
			JSONRPC: "2.0",
			Error:   &Error{Code: CodeParse, Message: "invalid JSON"},
		})
		return
	}

	handler, ok := s.handlers[request.Method]
	if !ok {
		s.respondError(c, request.ID, CodeMethodNotFound, "unknown method: "+request.Method)
		return
	}

	result, err := handler(ctx, request.Params)
	if err != nil {
		var rpcErr *Error
		if ok := asRPCError(err, &rpcErr); ok {
			s.respondError(c, request.ID, rpcErr.Code, rpcErr.Message)
			return
		}
		s.respondError(c, request.ID, CodeCommandFailed, err.Error())
		return
	}

	// Notifications (no id) expect no reply.
	if request.ID == nil {
		return
	}

	s.writeTo(c, Response{JSONRPC: "2.0", ID: request.ID, Result: result})
}

func (s *Server) respondError(c *client, id *json.RawMessage, code int, message string) {
	if id == nil {
		s.logger.Debug("Dropping error for a notification", "message", message)
		return
	}

	s.writeTo(c, Response{JSONRPC: "2.0", ID: id, Error: &Error{Code: code, Message: message}})
}

func asRPCError(err error, target **Error) bool {
	if rpcErr, ok := err.(*Error); ok {
		*target = rpcErr
		return true
	}
	return false
}
