package cli

import (
	"errors"
	"testing"
)

func TestIsNotFound(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "the runtime's own words, as they actually arrive",
			err: errors.New(`container delete --force dermaga-peek-testing: Error: ` +
				`internalError: "failed to delete container" ` +
				`(cause: "notFound: "container with ID dermaga-peek-testing not found"")`),
			want: true,
		},
		{
			// The reason this matches a token and not the words: an
			// uninstalled CLI fails with these, and reading them as "already
			// gone" would report every delete as a success.
			name: "a missing binary is not a missing container",
			err:  errors.New(`container delete x: exec: "container": executable file not found in $PATH`),
			want: false,
		},
		{
			name: "a container that is there and refuses to go",
			err:  errors.New(`container delete x: Error: internalError: "container is running"`),
			want: false,
		},
		{name: "no error at all", err: nil, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsNotFound(tc.err); got != tc.want {
				t.Errorf("IsNotFound() = %v, want %v", got, tc.want)
			}
		})
	}
}
