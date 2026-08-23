package tunnels

import "context"

// memory is a secrets store that keeps the token in this process, so the tests
// neither read nor write the login keychain.
type memory struct {
	token string
}

func (m *memory) write(_ context.Context, token string) error {
	m.token = token
	return nil
}

func (m *memory) read(_ context.Context) (string, bool) {
	return m.token, m.token != ""
}

func (m *memory) forget(_ context.Context) error {
	m.token = ""
	return nil
}
