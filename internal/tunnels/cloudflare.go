package tunnels

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// endpoint is Cloudflare's REST API. A variable rather than a constant so the
// tests can point it at a local server.
var endpoint = "https://api.cloudflare.com/client/v4"

// client talks to the Cloudflare API with one API token.
type client struct {
	token string
	http  *http.Client
}

func newClient(token string) *client {
	return &client{
		token: token,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

// envelope is the shape every Cloudflare response arrives in.
type envelope struct {
	Success bool            `json:"success"`
	Errors  []apiError      `json:"errors"`
	Result  json.RawMessage `json:"result"`
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Error reports what Cloudflare refused.
//
// Three of its codes are translated, because its own wording for them describes
// the HTTP request rather than the mistake. The rest are passed through: they
// are about a hostname or a record, and Cloudflare says it better than a
// paraphrase would.
func (e apiError) Error() string {
	switch e.Code {
	// Returned for a token that is not a token: the wrong string pasted, a
	// Global API Key rather than an API token, or "Bearer " left on the front.
	case 6003, 6111:
		return "That does not look like an API token. Create one under My Profile → " +
			"API Tokens; the Global API Key is a different thing and will not work here."

	// Well-formed, and not a token Cloudflare knows.
	case 1000:
		return "Cloudflare does not recognise that API token. It may have been deleted or expired."

	// Returned for every authentication and permission failure alike, so on its
	// own it tells nobody what to change.
	case 10000:
		return "Cloudflare rejected the API token. Check it has Account: Cloudflare Tunnel (Edit), " +
			"Zone: DNS (Edit) and Zone: Zone (Read)."
	}

	if e.Message == "" {
		return fmt.Sprintf("Cloudflare returned error %d", e.Code)
	}

	return e.Message
}

// do makes one API call and decodes result into out, which may be nil.
func (c *client) do(ctx context.Context, method, path string, body, out any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint+path, payload)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := c.http.Do(req)
	if err != nil {
		// A DNS or dial failure reaches the user as a wall of Go type names
		// otherwise, and the only thing they can act on is the first line.
		return fmt.Errorf("could not reach Cloudflare: %w", err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return err
	}

	var wrapper envelope
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return fmt.Errorf("Cloudflare answered %s with something that is not JSON", res.Status)
	}

	if !wrapper.Success {
		if len(wrapper.Errors) > 0 {
			return wrapper.Errors[0]
		}

		return fmt.Errorf("Cloudflare refused the request (%s)", res.Status)
	}

	if out == nil {
		return nil
	}

	return json.Unmarshal(wrapper.Result, out)
}

// Account is one Cloudflare account the token can act on.
type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Zone is one domain, and the account it belongs to.
//
// The account travels with the zone, which is the whole reason this is the only
// listing Dermaga needs: creating a tunnel takes an account id, and the right
// one is whichever account owns the domain being published on.
type Zone struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Account Account `json:"account"`
}

// verify checks the token is live before anything is stored. Cloudflare has an
// endpoint for exactly this, and it costs one call to turn "saved, and every
// later action fails" into an error on the form that asked for it.
func (c *client) verify(ctx context.Context) error {
	var result struct {
		Status string `json:"status"`
	}

	if err := c.do(ctx, http.MethodGet, "/user/tokens/verify", nil, &result); err != nil {
		return err
	}

	if result.Status != "active" && result.Status != "" {
		return fmt.Errorf("the API token is %s", result.Status)
	}

	return nil
}

// accounts lists the accounts the token can act on.
//
// Only ever a fallback. Listing accounts needs a permission of its own, which a
// token scoped to tunnels and DNS does not have and should not need -- so the
// account normally comes from the zone instead.
func (c *client) accounts(ctx context.Context) ([]Account, error) {
	var accounts []Account
	err := c.do(ctx, http.MethodGet, "/accounts?per_page=50", nil, &accounts)

	return accounts, err
}

// zones lists the domains the token can edit DNS on. These become the dropdown
// the user picks from.
func (c *client) zones(ctx context.Context) ([]Zone, error) {
	var zones []Zone
	err := c.do(ctx, http.MethodGet, "/zones?per_page=50&status=active", nil, &zones)

	return zones, err
}

// remoteTunnel is a tunnel as Cloudflare describes it.
type remoteTunnel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Only returned by the create call, and only for config_src "cloudflare".
	Token string `json:"token,omitempty"`
}

// createTunnel makes a remotely-managed tunnel. config_src "cloudflare" keeps
// the ingress rules in the account rather than in a local file, which is what
// lets a hostname be changed later with one call and no restart.
func (c *client) createTunnel(ctx context.Context, account, name string) (remoteTunnel, error) {
	body := map[string]any{"name": name, "config_src": "cloudflare"}

	var tunnel remoteTunnel
	err := c.do(ctx, http.MethodPost, "/accounts/"+account+"/cfd_tunnel", body, &tunnel)

	return tunnel, err
}

func (c *client) deleteTunnel(ctx context.Context, account, id string) error {
	return c.do(ctx, http.MethodDelete, "/accounts/"+account+"/cfd_tunnel/"+id, nil, nil)
}

// runToken is what `cloudflared tunnel run` authenticates with. The create call
// returns it too; this is here for a tunnel Dermaga is adopting rather than
// making.
func (c *client) runToken(ctx context.Context, account, id string) (string, error) {
	var token string
	err := c.do(ctx, http.MethodGet, "/accounts/"+account+"/cfd_tunnel/"+id+"/token", nil, &token)

	return token, err
}

// rule is one hostname and where it goes.
type rule struct {
	hostname string
	service  string
}

// configure replaces a tunnel's whole routing table.
//
// Whole, not incremental: Cloudflare takes the ingress list as one document,
// and there is no call to add a single rule to it. So every change to any route
// on a tunnel sends all of them, which also means the list here is the list
// there rather than the two drifting apart.
//
// The trailing 404 is required. Everything on the tunnel's hostnames arrives
// whether it matches a rule or not, and without a catch-all what does not match
// gets no answer at all.
func (c *client) configure(ctx context.Context, account, id string, rules []rule) error {
	ingress := make([]map[string]any, 0, len(rules)+1)
	for _, r := range rules {
		ingress = append(ingress, map[string]any{
			"hostname":      r.hostname,
			"service":       r.service,
			"originRequest": map[string]any{},
		})
	}

	ingress = append(ingress, map[string]any{"service": "http_status:404"})

	body := map[string]any{"config": map[string]any{"ingress": ingress}}

	return c.do(ctx, http.MethodPut, "/accounts/"+account+"/cfd_tunnel/"+id+"/configurations", body, nil)
}

// dnsRecord is the CNAME that makes a hostname resolve to a tunnel.
type dnsRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

// target is what a tunnel's CNAME points at.
func target(tunnelID string) string {
	return tunnelID + ".cfargotunnel.com"
}

// upsertDNS makes the hostname resolve to the tunnel, reusing the record if one
// is already there.
//
// Reusing rather than always creating matters because Cloudflare refuses a
// duplicate CNAME: a hostname the user had pointed somewhere by hand, or left
// behind by a tunnel removed outside Dermaga, would otherwise make sharing on
// that name impossible from here for ever.
func (c *client) upsertDNS(ctx context.Context, zone, hostname, tunnelID string) (string, error) {
	query := "/zones/" + zone + "/dns_records?type=CNAME&name=" + url.QueryEscape(hostname)

	var existing []dnsRecord
	if err := c.do(ctx, http.MethodGet, query, nil, &existing); err != nil {
		return "", err
	}

	body := map[string]any{
		"type":    "CNAME",
		"name":    hostname,
		"content": target(tunnelID),
		"proxied": true,
		"comment": "Managed by Dermaga",
	}

	var record dnsRecord

	if len(existing) > 0 {
		path := "/zones/" + zone + "/dns_records/" + existing[0].ID
		if err := c.do(ctx, http.MethodPatch, path, body, &record); err != nil {
			return "", err
		}

		return record.ID, nil
	}

	if err := c.do(ctx, http.MethodPost, "/zones/"+zone+"/dns_records", body, &record); err != nil {
		return "", err
	}

	return record.ID, nil
}

// deleteDNS removes a record. A record already gone is not an error: the point
// of the call is that it is not there afterwards.
func (c *client) deleteDNS(ctx context.Context, zone, id string) error {
	if id == "" {
		return nil
	}

	err := c.do(ctx, http.MethodDelete, "/zones/"+zone+"/dns_records/"+id, nil, nil)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "not found") {
		return nil
	}

	return err
}
