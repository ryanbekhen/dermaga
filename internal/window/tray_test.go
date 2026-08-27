package window

import "testing"

func running(value bool) *bool { return &value }

// The one line the menu bar item says on its own, and the only place the
// tri-state shows: unknown is not stopped, and saying so is the difference
// between an app that is still asking and an app reporting bad news.
func TestTrayLabelAnswersTheQuestionItExistsFor(t *testing.T) {
	cases := []struct {
		state TrayState
		want  string
	}{
		{TrayState{Running: running(true)}, "Services running"},
		{TrayState{Running: running(false)}, "Services stopped"},
		{TrayState{}, "Checking the services…"},
	}

	for _, test := range cases {
		if got := trayLabel(test.state); got != test.want {
			t.Errorf("trayLabel = %q, want %q", got, test.want)
		}
	}
}

// Update keeps what it was not told about, which is what lets the services
// poll say its piece without having to know anything else.
func TestTrayUpdateKeepsWhatItWasNotTold(t *testing.T) {
	tray := &Tray{state: TrayState{Running: running(true)}}

	tray.mu.Lock()
	tray.state.Running = running(true)
	tray.mu.Unlock()

	tray.updateState(nil)

	if tray.state.Running == nil || !*tray.state.Running {
		t.Error("a nil update should have left the state alone")
	}

	tray.updateState(running(false))

	if tray.state.Running == nil || *tray.state.Running {
		t.Error("the state should have followed what it was told")
	}
}
