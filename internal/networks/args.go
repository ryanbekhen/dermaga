package networks

import "fmt"

// createArgs is `container network create`, built apart from the call that runs
// it so what reaches the CLI can be checked without the CLI being installed.
// The name is positional and comes last.
func createArgs(spec Spec) []string {
	args := []string{"network", "create"}

	if spec.Subnet != "" {
		args = append(args, "--subnet", spec.Subnet)
	}
	if spec.SubnetV6 != "" {
		args = append(args, "--subnet-v6", spec.SubnetV6)
	}
	if spec.Internal {
		args = append(args, "--internal")
	}
	for key, value := range spec.Labels {
		args = append(args, "--label", fmt.Sprintf("%s=%s", key, value))
	}

	return append(args, spec.Name)
}
