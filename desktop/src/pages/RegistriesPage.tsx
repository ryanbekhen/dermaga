import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, Muted, NameCell, type Column } from '../components/DataTable';
import { Field, Modal } from '../components/form';
import { PageHeader } from '../components/PageHeader';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useDialog } from '../hooks/useDialog';
import { useUIStore } from '../store/uiStore';
import { formatDuration } from '../utils/format';
import type { RegistryLogin } from '../types';

const COLUMNS: Column[] = [
  { key: 'server', label: 'Registry', width: 'minmax(180px,1.4fr)' },
  { key: 'username', label: 'Username', width: 'minmax(140px,1fr)' },
  { key: 'created', label: 'Signed in', width: '110px', align: 'right' },
];

/**
 * The registries this Mac is signed in to.
 *
 * Its own page because the CLI treats it as one of its resources, alongside
 * images and volumes -- and because a private registry is the difference
 * between the app working and not, which is not a Settings detail.
 */
export function RegistriesPage() {
  const [logins, setLogins] = useState<RegistryLogin[]>([]);
  const adding = useDialog('registry.add');
  const [removing, setRemoving] = useState<RegistryLogin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const pushToast = useToastStore((s) => s.push);

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

  const needle = searchQuery.trim().toLowerCase();
  const visible = logins.filter(
    (login) =>
      !needle ||
      login.server.toLowerCase().includes(needle) ||
      (login.username ?? '').toLowerCase().includes(needle)
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 -mb-4">
      <PageHeader
        title="Registries"
        subtitle="Where images are pulled from and pushed to"
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search registries…' }}
        actions={
          <button onClick={() => adding.show()} className="btn-primary">
            <LogIn size={13} aria-hidden />
            Log in
          </button>
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={visible}
        rowKey={(login) => login.server}
        empty={
          logins.length === 0
            ? 'Not signed in anywhere. Public images work without this; a private one needs it.'
            : 'No registry matches your search.'
        }
        cells={(login) => [
          <NameCell key="server">
            <span className="truncate font-mono text-sm">{login.server}</span>
          </NameCell>,
          <Muted key="username">{login.username || '—'}</Muted>,
          <Muted key="created">{login.created ? formatDuration(login.created) : '—'}</Muted>,
        ]}
        actions={(login) => (
          <IconButton
            icon={LogOut}
            busy={busy === login.server}
            className="border-transparent"
            aria-label={`Sign out of ${login.server}`}
            onClick={() => setRemoving(login)}
          />
        )}
      />

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
