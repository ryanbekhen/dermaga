import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Play, Plus, Square, Unplug } from 'lucide-react';
import { Button } from '../components/Button';
import { CloudflareMark } from '../components/CloudflareMark';
import { CommandProgress, useCommandProgress } from '../components/CommandProgress';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field, Modal } from '../components/form';
import { PageHeader } from '../components/PageHeader';
import { RouteDialog } from '../components/RouteDialog';
import { TunnelTopology } from '../components/TunnelTopology';
import { api } from '../services/api';
import { openExternal } from '../services/ipc';
import { useToastStore } from '../store/toastStore';
import { useResourceStore } from '../store/resourceStore';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import type { TunnelRoute, TunnelsStatus } from '../types';

/** Where somebody makes the token this asks for. */
const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens';

/**
 * The hostnames this Mac answers on, and the containers behind them.
 *
 * Routes are what somebody adds here. Tunnels are not, and they are not shown
 * either: a Cloudflare tunnel belongs to exactly one account, so Dermaga keeps
 * one per account and makes it when a route first needs it — but everything
 * leaves this Mac the same way, so one picture covers all of it rather than one
 * card per account. What is on screen is the path, because that is the thing
 * that breaks, and a list of hostnames would not show where.
 */
export function TunnelsPage() {
  const [status, setStatus] = useState<TunnelsStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const adding = useDialog('tunnel.route');
  const [editing, setEditing] = useState<TunnelRoute | null>(null);
  const [removing, setRemoving] = useState<TunnelRoute | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useUIStore((s) => s.navigate);
  const pushToast = useToastStore((s) => s.push);
  const install = useCommandProgress('tunnels.install');

  // Whether Cloudflare is connected and the connector installed. Its own call
  // because it is about this Mac's setup rather than about what is published,
  // and it only changes when somebody changes it.
  const load = useCallback(() => {
    void api
      .getTunnelsStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(load, [load]);

  // The routes themselves arrive with every other change, pushed by the agent.
  // A container stopping darkens its route the moment it happens -- there is
  // nothing here on a timer, and nothing to refresh.
  const all = useResourceStore((s) => s.tunnels);

  // One list, hostname order. Which tunnel carries a route is Dermaga's
  // bookkeeping and not something to sort somebody's hostnames by.
  const routes = useMemo(
    () =>
      all.flatMap((tunnel) => tunnel.routes).sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [all]
  );

  const connected = status?.connected ?? false;
  const ready = connected && (status?.installed ?? false);
  const up = all.filter((tunnel) => tunnel.status === 'running').length;

  const act = async (key: string, run: () => Promise<void>, done: string) => {
    setBusy(key);

    try {
      await run();
      pushToast(done);
      load();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'That did not work', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Every connector at once. There is one per Cloudflare account and nothing on
  // this page names the accounts, so stopping one of them would be stopping
  // something the reader cannot see.
  const setAllRunning = (running: boolean) =>
    act(
      'connectors',
      async () => {
        for (const tunnel of all) {
          if (running) await api.startTunnel(tunnel.id);
          else await api.stopTunnel(tunnel.id);
        }
      },
      running ? 'Everything is published again' : 'Nothing is being served'
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Tunnels"
        // Said out loud rather than left to be discovered. This is the one
        // feature that reaches outside this Mac and makes changes in somebody
        // else's account, and it is new -- so it says so, on the page and in
        // the sidebar, until it has been used enough to stop.
        badges={
          <span className="rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-tiny font-medium text-brand-700 dark:border-brand-600/40 dark:bg-brand-600/15 dark:text-brand-400">
            Beta
          </span>
        }
        subtitle={
          !connected
            ? 'Publish a container on a hostname of your own'
            : routes.length === 0
              ? `${reachLabel(status)} · nothing published yet`
              : `${plural(routes.length, 'route')} · ${up > 0 ? 'serving' : 'stopped'}`
        }
        actions={
          connected ? (
            <>
              <button
                onClick={() => adding.show()}
                disabled={!ready}
                className="btn-plain-primary"
                title="Add a route"
                aria-label="Add a route"
              >
                <Plus size={18} aria-hidden />
              </button>

              {routes.length > 0 && (
                <button
                  onClick={() => void setAllRunning(up === 0)}
                  disabled={busy === 'connectors'}
                  className="btn-plain"
                  title={up === 0 ? 'Start serving' : 'Stop serving'}
                  aria-label={up === 0 ? 'Start serving' : 'Stop serving'}
                >
                  {up === 0 ? <Play size={18} aria-hidden /> : <Square size={18} aria-hidden />}
                </button>
              )}

              <button
                onClick={() => setDisconnecting(true)}
                className="btn-plain"
                title="Disconnect from Cloudflare"
                aria-label="Disconnect from Cloudflare"
              >
                <Unplug size={18} aria-hidden />
              </button>
            </>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
        {status && !connected && (
          <ConnectPanel
            busy={connecting}
            status={status}
            install={install}
            onInstalled={load}
            onConnect={async (token) => {
              setConnecting(true);

              try {
                const next = await api.connectCloudflare(token);
                setStatus(next);
                pushToast(`Connected to ${next.accountName ?? 'Cloudflare'}`);
                load();
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Could not connect', 'error');
                throw err;
              } finally {
                setConnecting(false);
              }
            }}
          />
        )}

        {/* The connector's absence is the one failure that cannot be explained
            after the fact: the route is made, the DNS is right, and nothing
            answers. So it is said here, before anybody adds one. */}
        {connected && status && !status.installed && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ink-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">cloudflared is not installed</p>
              <p className="pt-0.5 text-tiny text-ink-600 dark:text-ink-400">
                Cloudflare&apos;s connector is what carries the traffic to your containers. Nothing
                can be published without it.
              </p>
            </div>

            <CommandProgress {...install} />

            <Button
              variant="primary"
              disabled={!status.brewAvailable || install.state === 'running'}
              busy={install.state === 'running'}
              busyLabel="Installing…"
              onClick={() => void install.run((failed) => !failed && load())}
            >
              {status.brewAvailable ? 'Install with Homebrew' : 'Homebrew is not installed'}
            </Button>
          </div>
        )}

        {ready && routes.length === 0 && (
          <div className="flex items-center justify-center pt-16">
            <div className="max-w-md rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
              Nothing is published yet. Add a route to give one of your containers a hostname — a
              container listening on several ports gets a route for each.
            </div>
          </div>
        )}

        {routes.length > 0 && (
          <>
            {/* Anything a connector is complaining about, above the canvas.
                There is no list of tunnels on this page for it to sit beside,
                and a failure that only shows as a grey line is a failure
                somebody has to guess at. */}
            {all
              .filter((tunnel) => tunnel.error)
              .map((tunnel) => (
                <p
                  key={tunnel.id}
                  className="mb-3 wrap-break-word rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-tiny text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-400"
                >
                  {tunnel.error}
                </p>
              ))}

            <TunnelTopology
              tunnels={all}
              onOpenContainer={(container) =>
                navigate({ name: 'container', id: container, tab: 'overview' })
              }
              onOpenRoute={(route) =>
                void openExternal(route.url ?? `https://${route.hostname}`)
              }
              onMoveRoute={(route) => setEditing(route)}
              onRemoveRoute={(route) => setRemoving(route)}
            />
          </>
        )}
      </div>

      {((adding.open && ready) || editing) && (
        <RouteDialog
          editing={editing}
          onClose={() => {
            adding.close();
            setEditing(null);
          }}
          onDone={() => {
            adding.close();
            setEditing(null);
            load();
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.hostname}?`}
          body={`The hostname stops answering and its DNS record goes. ${describe(removing)} itself is untouched.`}
          confirmLabel="Remove"
          onConfirm={() => {
            const route = removing;
            setRemoving(null);
            void act(
              route.hostname,
              () => api.removeRoute(route.hostname),
              `${route.hostname} is no longer published`
            );
          }}
          onCancel={() => setRemoving(null)}
        />
      )}

      {disconnecting && (
        <ConfirmDialog
          title={
            routes.length === 0
              ? 'Disconnect from Cloudflare?'
              : `Disconnect and take down ${plural(routes.length, 'route')}?`
          }
          body={
            routes.length === 0
              ? "The API token is removed from this Mac's keychain. Nothing is published, so nothing comes down with it."
              : 'Every hostname stops answering, its DNS record is removed, and the tunnels are deleted from your Cloudflare account — then the token is removed from this Mac. That order is deliberate: the token is the only thing that can reach Cloudflare, so forgetting it first would leave all of that behind with nothing able to clear it. The containers themselves are untouched.' 
          }
          confirmLabel={routes.length === 0 ? 'Disconnect' : 'Take down and disconnect'}
          onConfirm={() => {
            setDisconnecting(false);

            void api
              .disconnectCloudflare()
              .then(() => {
                pushToast('Disconnected from Cloudflare');
                load();
              })
              .catch((err: unknown) =>
                pushToast(err instanceof Error ? err.message : 'Could not disconnect', 'error')
              );
          }}
          onCancel={() => setDisconnecting(false)}
        />
      )}
    </div>
  );
}

/**
 * Who Dermaga is connected as, before anything is published.
 *
 * A token that reaches one account is named by it. One that reaches several has
 * no single account to name, so what it reaches is said instead.
 */
function reachLabel(status: TunnelsStatus | null): string {
  if (!status) return 'Connected';

  if (status.accountName) return `Connected to ${status.accountName}`;

  if (status.accounts > 1) {
    return `Connected · ${plural(status.domains, 'domain')} across ${plural(status.accounts, 'account')}`;
  }

  return `Connected · ${plural(status.domains, 'domain')}`;
}

function plural(count: number, what: string): string {
  return `${count} ${what}${count === 1 ? '' : 's'}`;
}

/** What a route points at, the way a person would say it. */
function describe(route: TunnelRoute): string {
  return route.kind === 'host' ? 'This Mac' : route.target;
}

/**
 * The one-time connection to Cloudflare.
 *
 * A token rather than a browser sign-in because the browser flow authorises one
 * domain, chosen there — and the point of this is to choose the domain here.
 */
function ConnectPanel({
  busy,
  status,
  install,
  onInstalled,
  onConnect,
}: {
  busy: boolean;
  status: TunnelsStatus | null;
  install: ReturnType<typeof useCommandProgress>;
  onInstalled: () => void;
  onConnect: (token: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');

  const installed = status?.installed ?? false;

  const submitToken = async () => {
    if (!token.trim()) return;

    try {
      await onConnect(token.trim());
      setOpen(false);
      setToken('');
    } catch {
      // Reported as a toast by the caller; the dialog stays open with the
      // token still in it, which is what somebody correcting one needs.
    }
  };

  return (
    <div className="flex items-center justify-center pt-10">
      <div className="max-w-lg rounded-xl border border-ink-200 bg-white px-6 py-7 dark:border-ink-800 dark:bg-ink-900">
        {/* The mark on its own, at a size worth looking at. It sat on a dark
            tile, which is how the other icons on this page are drawn -- but
            those are Dermaga's own glyphs, and a tile behind somebody else's
            logo is a badge Dermaga made for them. This is the one screen where
            the mark is the subject rather than a label. */}
        <CloudflareMark size={44} aria-hidden />

        <h2 className="pt-4 text-base font-semibold">Give a container a hostname</h2>

        <p className="pt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          Apple&apos;s runtime gives a container an address on this Mac and nothing beyond it.
          Connect a Cloudflare account and Dermaga can put one on a domain you own — pick the
          domain, name the subdomain, choose the port, and it is reachable.
        </p>

        {/* Two things are needed, and both are said here.
            cloudflared used to be mentioned only after connecting, which is the
            wrong moment: somebody who has not connected yet has no way to know
            a second thing is coming, and a program they have never heard of
            appearing after they hand over a token reads as a bait. */}
        <div className="flex flex-col divide-y divide-ink-150 border-t border-ink-150 pt-4 dark:divide-ink-800 dark:border-ink-800">
          <Requirement
            title="cloudflared"
            detail={
              installed
                ? 'Installed. This is the program that carries the traffic; Dermaga runs it for you.'
                : "Cloudflare's own connector, and the program that carries the traffic. Dermaga runs it for you, but it has to be on this Mac first."
            }
            done={installed}
            action={
              installed ? undefined : (
                <Button
                  variant="secondary"
                  disabled={!status?.brewAvailable || install.state === 'running'}
                  busy={install.state === 'running'}
                  busyLabel="Installing…"
                  onClick={() => void install.run((failed) => !failed && onInstalled())}
                >
                  {status?.brewAvailable ? 'Install with Homebrew' : 'Needs Homebrew'}
                </Button>
              )
            }
            note={<CommandProgress {...install} />}
          />

          <Requirement
            title="A Cloudflare API token"
            detail="It needs Account: Cloudflare Tunnel (Edit), Zone: DNS (Edit) and Zone: Zone (Read). Kept in this Mac's login keychain, not in a file."
            done={false}
            action={
              <button onClick={() => void openExternal(TOKEN_PAGE)} className="btn-ghost">
                Make a token
              </button>
            }
          />
        </div>

        <p className="pt-4 text-tiny text-ink-500">
          Your domain&apos;s nameservers must already be Cloudflare&apos;s.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-4">
          <button onClick={() => setOpen(true)} className="btn-cloudflare">
            Connect Cloudflare
          </button>
        </div>
      </div>

      {open && (
        <Modal
          title="Connect Cloudflare"
          subtitle="Checked against Cloudflare before it is stored."
          onClose={() => setOpen(false)}
          onSubmit={() => void submitToken()}
          footer={
            <>
              <button onClick={() => setOpen(false)} className="btn-ghost">
                Cancel
              </button>
              <Button
                className="btn-cloudflare"
                busy={busy}
                busyLabel="Checking…"
                disabled={!token.trim()}
                onClick={() => void submitToken()}
              >
                Connect
              </Button>
            </>
          }
        >
          <Field
            label="API token"
            hint="From dash.cloudflare.com → My Profile → API Tokens → Create Token."
          >
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="input font-mono"
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/**
 * One of the things this needs before anything can be published.
 *
 * Said before connecting rather than after: somebody handing over an API token
 * should already know what else is coming, and what each of the two is for.
 */
function Requirement({
  title,
  detail,
  done,
  action,
  note,
}: {
  title: string;
  detail: string;
  done: boolean;
  action?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {done && (
            <Check size={13} className="text-emerald-600 dark:text-emerald-500" aria-label="ready" />
          )}
        </p>
        <p className="pt-0.5 text-tiny leading-relaxed text-ink-600 dark:text-ink-400">{detail}</p>
        {note}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
