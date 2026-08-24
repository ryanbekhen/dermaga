package volumes

import "fmt"

// createArgs is `container volume create`, built apart from the call that runs
// it so what reaches the CLI can be checked without the CLI being installed.
// The name is positional and comes last.
//
// Size is `-s` rather than `--size`: the CLI takes the short form only.
func createArgs(spec Spec) []string {
	args := []string{"volume", "create"}

	if spec.Size != "" {
		args = append(args, "-s", spec.Size)
	}
	for key, value := range spec.Labels {
		args = append(args, "--label", fmt.Sprintf("%s=%s", key, value))
	}
	for key, value := range spec.Opts {
		args = append(args, "--opt", fmt.Sprintf("%s=%s", key, value))
	}

	return append(args, spec.Name)
}
