package agent

import (
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/rpc"
)

// A server with nobody connected, which is the state this is all about: the
// agent goes on working with no window listening.
func quietStreams(t *testing.T) *streams {
	t.Helper()

	return newStreams(rpc.NewServer(slog.New(slog.NewTextHandler(io.Discard, nil))))
}

type shelved struct {
	streamID string
	filing   *filing
	err      error
	called   int
}

func (s *streams) collect(into *shelved) {
	s.shelve = func(id string, f *filing, err error) {
		into.streamID = id
		into.filing = f
		into.err = err
		into.called++
	}
}

// The whole point. A build is minutes long, the window can be closed for all of
// them, and what it printed has to be readable afterwards -- so the agent keeps
// it rather than the window handing it over when it finishes.
func TestAFiledStreamIsKeptWithoutAWindow(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("build-7", func() {})
	s.file("build-7", "build:api-dev", "build", "api:dev")

	s.data("build-7", "step 1/3")
	s.data("build-7", "step 2/3")
	s.data("build-7", "step 3/3")

	s.end("build-7", nil)

	if got.called != 1 {
		t.Fatalf("shelved %d times, want 1", got.called)
	}
	if got.streamID != "build-7" {
		t.Errorf("streamId = %q", got.streamID)
	}
	if got.filing.taskID != "build:api-dev" {
		t.Errorf("the window's name was lost: %q", got.filing.taskID)
	}
	if got.filing.kind != "build" || got.filing.label != "api:dev" {
		t.Errorf("kind/label = %q/%q", got.filing.kind, got.filing.label)
	}
	if lines := got.filing.output(); len(lines) != 3 || lines[2] != "step 3/3" {
		t.Errorf("output = %q", lines)
	}
	if got.err != nil {
		t.Errorf("err = %v", got.err)
	}
}

// Only the streams somebody is waiting on. Following a container's log is a
// stream too, and nothing files one.
func TestAnUnfiledStreamKeepsNothing(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("logs-2", func() {})
	s.data("logs-2", "listening on :80")
	s.end("logs-2", nil)

	if got.called != 0 {
		t.Errorf("an unfiled stream was shelved")
	}
}

// A filing made after the stream has gone would be written out empty, over the
// record that has the output in it.
func TestAStreamCannotBeFiledOnceItHasEnded(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("pull-1", func() {})
	s.end("pull-1", nil)

	s.file("pull-1", "pull:redis", "pull", "redis")
	s.data("pull-1", "too late")
	s.end("pull-1", nil)

	if got.called != 0 {
		t.Errorf("shelved a stream that had already ended")
	}
}

// Cancelling kills the command; the command ending is what writes the record.
// A build somebody stopped halfway is still a build whose output says why.
func TestAStoppedStreamIsStillWrittenDown(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("build-9", func() {})
	s.file("build-9", "build:api-dev", "build", "api:dev")
	s.data("build-9", "step 1/9")

	s.cancel("build-9")
	s.end("build-9", nil)

	if got.called != 1 {
		t.Fatalf("shelved %d times, want 1", got.called)
	}
	if lines := got.filing.output(); len(lines) != 1 || lines[0] != "step 1/9" {
		t.Errorf("output = %q", lines)
	}
}

// What went wrong travels with what was printed: a banner holds one line, this
// holds the rest.
func TestAFailureIsShelvedAsOne(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("build-3", func() {})
	s.file("build-3", "build:api-dev", "build", "api:dev")
	s.end("build-3", io.ErrUnexpectedEOF)

	if got.err == nil {
		t.Fatal("the failure was not passed on")
	}
}

// The limit is a size, and the tail is what survives it -- a command that
// failed says why at the end.
func TestOutputIsHeldToItsLimitAndSaysSo(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("build-4", func() {})
	s.file("build-4", "build:big", "build", "big")

	line := strings.Repeat("x", 1024)
	for i := 0; i < 600; i++ {
		s.data("build-4", line)
	}
	s.data("build-4", "the last thing it said")

	s.end("build-4", nil)

	held := 0
	for _, l := range got.filing.lines {
		held += len(l) + 1
	}
	if held > keptOutput {
		t.Errorf("held %d bytes, over the %d limit", held, keptOutput)
	}

	lines := got.filing.output()
	if lines[0] != "[earlier output dropped]" {
		t.Errorf("nothing said the output had been cut: %q", lines[0])
	}
	if lines[len(lines)-1] != "the last thing it said" {
		t.Errorf("the tail was not what survived: %q", lines[len(lines)-1])
	}
}

// Nothing was dropped, so nothing says it was.
func TestShortOutputIsLeftAlone(t *testing.T) {
	s := quietStreams(t)
	var got shelved
	s.collect(&got)

	s.register("pull-5", func() {})
	s.file("pull-5", "pull:redis", "pull", "redis")
	s.data("pull-5", "done")
	s.end("pull-5", nil)

	if lines := got.filing.output(); len(lines) != 1 || lines[0] != "done" {
		t.Errorf("output = %q", lines)
	}
}
