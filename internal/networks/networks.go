// Package networks wraps `container network`.
package networks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
)

// Manager owns every network operation.
type Manager struct {
	runner  *cli.Runner
	logger  *slog.Logger
	changed notify.Notifier
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{runner: runner, logger: logger, changed: changed}
}

type Network struct {
	Name        string            `json:"name"`
	Mode        string            `json:"mode"`
	Plugin      string            `json:"plugin"`
	CreatedAt   string            `json:"createdAt"`
	Labels      map[string]string `json:"labels"`
	IPv4Subnet  string            `json:"ipv4Subnet,omitempty"`
	IPv4Gateway string            `json:"ipv4Gateway,omitempty"`
	IPv6Subnet  string            `json:"ipv6Subnet,omitempty"`
	Builtin     bool              `json:"builtin"`
	UsedBy      []string          `json:"usedBy"`
}

type cliNetwork struct {
	ID            string `json:"id"`
	Configuration struct {
		Name         string            `json:"name"`
		Mode         string            `json:"mode"`
		Plugin       string            `json:"plugin"`
		CreationDate string            `json:"creationDate"`
		Labels       map[string]string `json:"labels"`
	} `json:"configuration"`
	Status struct {
		IPv4Subnet  string `json:"ipv4Subnet"`
		IPv4Gateway string `json:"ipv4Gateway"`
		IPv6Subnet  string `json:"ipv6Subnet"`
	} `json:"status"`
}

func (m *Manager) List(ctx context.Context) ([]Network, error) {
	output, err := m.runner.Run(ctx, "network", "list", "--format", "json")
	if err != nil {
		return nil, err
	}

	return parse(output)
}

func parse(output []byte) ([]Network, error) {
	var raw []cliNetwork
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse network list: %w", err)
	}

	networks := make([]Network, 0, len(raw))
	for _, r := range raw {
		name := r.Configuration.Name
		if name == "" {
			name = r.ID
		}

		labels := r.Configuration.Labels
		if labels == nil {
			labels = map[string]string{}
		}

		networks = append(networks, Network{
			Name:      name,
			Mode:      r.Configuration.Mode,
			Plugin:    r.Configuration.Plugin,
			CreatedAt: r.Configuration.CreationDate,
			Labels:    labels,
			// Built-in networks cannot be deleted; the UI greys the action out.
			Builtin:     labels["com.apple.container.resource.role"] == "builtin",
			IPv4Subnet:  r.Status.IPv4Subnet,
			IPv4Gateway: r.Status.IPv4Gateway,
			IPv6Subnet:  r.Status.IPv6Subnet,
			UsedBy:      []string{},
		})
	}

	return networks, nil
}

type Spec struct {
	Name     string            `json:"name"`
	Subnet   string            `json:"subnet,omitempty"`
	SubnetV6 string            `json:"subnetV6,omitempty"`
	Internal bool              `json:"internal,omitempty"`
	Labels   map[string]string `json:"labels,omitempty"`
}

func (m *Manager) Create(ctx context.Context, spec Spec) error {
	if strings.TrimSpace(spec.Name) == "" {
		return fmt.Errorf("network name is required")
	}

	if _, err := m.runner.Run(ctx, createArgs(spec)...); err != nil {
		m.logger.Error("Failed to create network", "name", spec.Name, "error", err)
		return err
	}
	m.changed.Changed()

	return nil
}

func (m *Manager) Delete(ctx context.Context, name string) error {
	if _, err := m.runner.Run(ctx, "network", "delete", name); err != nil {
		m.logger.Error("Failed to delete network", "name", name, "error", err)
		return err
	}
	m.changed.Changed()

	return nil
}
