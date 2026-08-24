package machines

import "fmt"

// The arguments for the commands built from more than a fixed list, kept apart
// from the calls that run them so what reaches the CLI can be checked without
// the CLI being installed. `machine create` is rendered by Spec.CreateArgs,
// which has always been separate.

// logsCommandArgs is `container machine logs`. boot selects the boot log
// instead of stdio, and tail bounds what arrives first.
func logsCommandArgs(id string, tail int, follow, boot bool) []string {
	args := []string{"machine", "logs"}

	if follow {
		args = append(args, "--follow")
	}
	if boot {
		args = append(args, "--boot")
	}
	if tail > 0 {
		args = append(args, "-n", fmt.Sprintf("%d", tail))
	}

	return append(args, id)
}

// configureArgs is `container machine set`, whose settings are key=value pairs
// rather than flags. It returns nil when the settings carry nothing to change,
// so the caller can skip the command instead of running one that says only
// which machine it is about.
func configureArgs(id string, settings Settings) ([]string, error) {
	args := []string{"machine", "set", "--name", id}
	prefix := len(args)

	if settings.CPUs > 0 {
		args = append(args, fmt.Sprintf("cpus=%d", settings.CPUs))
	}
	if settings.Memory != "" {
		args = append(args, fmt.Sprintf("memory=%s", settings.Memory))
	}
	if settings.HomeMount != "" {
		switch settings.HomeMount {
		case "ro", "rw", "none":
			args = append(args, fmt.Sprintf("home-mount=%s", settings.HomeMount))
		default:
			return nil, fmt.Errorf("home mount must be ro, rw or none")
		}
	}
	if settings.Virtualization != nil {
		args = append(args, fmt.Sprintf("virtualization=%t", *settings.Virtualization))
	}
	if settings.Kernel != "" {
		args = append(args, fmt.Sprintf("kernel=%s", settings.Kernel))
	}

	if len(args) == prefix {
		return nil, nil
	}

	return args, nil
}
