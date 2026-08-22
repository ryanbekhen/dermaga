import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field, Modal } from '../components/form';
import { PageHeader } from '../components/PageHeader';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useDialog } from '../hooks/useDialog';
import { formatDuration } from '../utils/format';
import type { RegistryLogin } from '../types';

/**
 * The registries this Mac is signed in to.
 *
 * Its own page because the CLI treats it as one of its resources, alongside
 * images and volumes -- and because a private registry is the difference
 * between the app working and not, which is not a Settings detail.
 */
export function RegistriesPage() {
  const [logins, setLogins] = useState<RegistryLogin[] | null>(null);
  const adding = useDialog('registry.add');
  const [removing, setRemoving] = useState<RegistryLogin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  // Null until the first answer: "not asked yet" and "asked, and there are
  // none" are different things, and only one of them is worth telling somebody.
  const load = useCallback(() => {
    void api
      .getRegistries()
      .then(setLogins)
      .catch(() => setLogins([]));
  }, []);

  useEffect(load, [load]);

  const logout = async (login: RegistryLogin) => {
    setRemoving(null);
    setBusy(login.server);

    try {
      await api.registryLogout(login.server);
      pushToast(`Signed out of ${login.server}`);
      load();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not sign out', 'error');
    } finally {
      setBusy(null);
    }
  };

  const visible = logins ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Registries"
        subtitle={
          logins === null
            ? 'Where images are pulled from and pushed to'
            : logins.length === 0
              ? 'Not signed in anywhere · public images work without this'
              : `${logins.length} signed in · where images are pulled from and pushed to`
        }
        actions={
          <button onClick={() => adding.show()} className="btn-primary">
            <LogIn size={13} aria-hidden />
            Log in
          </button>
        }
      />

      {/* Cards in two columns rather than three narrow table rows. A registry
          is an account on a host, which is a thing with a face -- an address,
          who is signed in, when -- and it reads as one when the three are kept
          together rather than spread across a row you have to track with a
          finger. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {logins !== null && visible.length === 0 && (
          <div className="flex items-center justify-center pt-16">
            <div className="max-w-md rounded-xl border border-dashed border-ink-300 bg-white/60 px-6 py-10 text-center text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-400">
              Not signed in anywhere. Public images work without this; a private one needs it.
            </div>
          </div>
        )}

        {visible.length > 0 && (
          // As many columns as fit, rather than a fixed two. A card has a
          // width it reads well at -- a host, a user, a date -- and stretching
          // one across half a wide window only puts more air between the three
          // of them. The floor is what the longest realistic host needs
          // (an ECR address runs to about forty characters); above it the grid
          // adds columns instead of width.
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
            {visible.map((login) => (
              <li
                key={login.server}
                className="flex flex-col gap-3.5 rounded-xl border border-ink-200 bg-white p-4 transition-colors hover:border-ink-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700"
              >
                <div className="flex items-center gap-3">
                  {/* The host's initials on a dark tile. Registries have no
                      logo Dermaga is allowed to ship, and two letters of the
                      hostname are enough to tell ghcr.io from docker.io at a
                      glance across four cards. */}
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chrome-bg font-mono text-body text-chrome-text"
                  >
                    {initials(login.server)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{hostLabel(login.server)}</p>
                    <p className="truncate font-mono text-tiny text-ink-500">{login.server}</p>
                  </div>
                  <span className="pill bg-emerald-600/10 text-emerald-700 dark:text-emerald-500">
                    signed in
                  </span>
                </div>

                <div className="flex items-end justify-between gap-4 border-t border-ink-150 pt-3.5 dark:border-ink-800">
                  <dl className="flex min-w-0 gap-6">
                    <div className="min-w-0">
                      <dt className="label-mono">User</dt>
                      <dd className="truncate pt-0.5 text-sm font-medium">
                        {login.username || '—'}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="label-mono">Signed in</dt>
                      <dd className="truncate pt-0.5 text-sm font-medium">
                        {login.created ? `${formatDuration(login.created)} ago` : '—'}
                      </dd>
                    </div>
                  </dl>

                  <Button
                    icon={LogOut}
                    busy={busy === login.server}
                    busyLabel="Signing out…"
                    onClick={() => setRemoving(login)}
                  >
                    Sign out
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding.open && (
        <LoginDialog
          onClose={() => adding.close()}
          onDone={() => {
            adding.close();
            load();
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Sign out of ${removing.server}?`}
          body="Images already pulled stay where they are. Pulling or pushing private ones will need signing in again."
          confirmLabel="Sign out"
          onConfirm={() => void logout(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** The two letters on the tile: the first of each dotted part of the host. */
function initials(server: string): string {
  const host = server.split(':')[0] ?? server;
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return host.slice(0, 2).toUpperCase();
}

/** The host without its registry-flavoured noise, for the card's heading. */
function hostLabel(server: string): string {
  const host = server.split(':')[0] ?? server;
  if (host === 'registry-1.docker.io' || host === 'docker.io') return 'Docker Hub';
  if (host === 'ghcr.io') return 'GitHub Packages';
  if (host.endsWith('.amazonaws.com')) return 'Amazon ECR';
  return host;
}

// Told to speak HTTPS to a registry that only speaks HTTP, the CLI waits for a
// handshake that never comes. A registry on this machine is almost never behind
// TLS, so the address decides until the user says otherwise.
function isLocal(server: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?$/.test(server.trim());
}

function LoginDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [decided, setDecided] = useState(false);
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const plainHttp = decided ? insecure : isLocal(server);
  const ready = server.trim() && username.trim() && password;

  const submit = async () => {
    setBusy(true);

    try {
      await api.registryLogin(server.trim(), username.trim(), password, plainHttp ? 'http' : '');
      pushToast(`Signed in to ${server.trim()}`);
      onDone();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not sign in', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Log in to a registry"
      subtitle="Apple's CLI stores the credentials; Dermaga does not keep them."
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Signing in…"
            disabled={!ready}
            onClick={() => void submit()}
          >
            Log in
          </Button>
        </>
      }
    >
      <Field label="Registry" hint="For example docker.io, ghcr.io, or localhost:5050.">
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="ghcr.io"
          autoFocus
          className="input font-mono"
        />
      </Field>

      <Field label="Username">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          className="input"
        />
      </Field>

      <Field label="Password or token" hint="Sent to the CLI over stdin, never on a command line.">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ready && void submit()}
          autoComplete="off"
          className="input"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={plainHttp}
          onChange={(e) => {
            setDecided(true);
            setInsecure(e.target.checked);
          }}
          className="h-4 w-4 accent-brand-600"
        />
        Plain HTTP
        {!decided && isLocal(server) && (
          <span className="text-tiny text-ink-500">
            · set for you, this looks like a local registry
          </span>
        )}
      </label>
    </Modal>
  );
}
