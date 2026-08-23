import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Boxes, Globe, Laptop, Server } from 'lucide-react';
import { Button } from './Button';
import { SegmentedControl, type Segment } from './SegmentedControl';
import { Field, Modal } from './form';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useValidation } from '../hooks/useValidation';
import { port as validPort, subdomain as validSubdomain } from '../utils/validate';
import type { TunnelKind, TunnelRoute, TunnelTarget, Zone } from '../types';

const KINDS: Segment<TunnelKind>[] = [
  { value: 'container', label: 'Container', icon: Boxes },
  { value: 'machine', label: 'Machine', icon: Server },
  { value: 'host', label: 'This Mac', icon: Laptop },
];

/**
 * One route: a hostname, and what answers behind it.
 *
 * Four decisions, and the form fills in three of them. Every field that picks
 * from a list is one you can type into: there are two dozen domains here on a
 * real account, and a container with an unusual port is not a reason to be
 * unable to publish it.
 */
export function RouteDialog({
  editing,
  onClose,
  onDone,
}: {
  /** The route being moved, if this is a move rather than an addition. */
  editing?: TunnelRoute | null;
  onClose: () => void;
  onDone: (route: TunnelRoute) => void;
}) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [targets, setTargets] = useState<TunnelTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The domain is held as typed, not as an id: the field is something you can
  // search, so what is in it may not name a zone yet.
  const [domain, setDomain] = useState(editing?.zoneName ?? '');
  const [label, setLabel] = useState(editing?.subdomain ?? '');
  const [kind, setKind] = useState<TunnelKind>(editing?.kind ?? 'container');
  const [target, setTarget] = useState(editing?.target ?? '');
  const [port, setPort] = useState(editing?.port ?? '');
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  // The two lists the form is made of, fetched together because neither is
  // useful on its own and a failure in either is the same message.
  //
  // They fill the dropdowns and nothing else. Nothing is chosen in advance: a
  // form that arrives already answered has to be read and undone before the one
  // question somebody came with can be asked, and the answers it picks are
  // guesses -- the first domain of two dozen, the first container of six.
  useEffect(() => {
    let live = true;

    void Promise.all([api.getZones(), api.getTunnelTargets()])
      .then(([fetchedZones, fetchedTargets]) => {
        if (!live) return;

        setZones(fetchedZones);
        setTargets(fetchedTargets);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(err instanceof Error ? err.message : 'Could not reach Cloudflare');
        setZones([]);
        setTargets([]);
      });

    return () => {
      live = false;
    };
  }, []);

  const ofKind = useMemo(
    () => (targets ?? []).filter((t) => t.kind === kind),
    [targets, kind]
  );

  const chosen = ofKind.find((t) => t.name === target) ?? (kind === 'host' ? ofKind[0] : undefined);

  // Matched on the name as typed. A domain that is not one of them is a typo,
  // and saying so is better than sending it and letting Cloudflare say it.
  const zone = zones?.find((z) => z.name === domain.trim().toLowerCase());

  const hostname = zone
    ? [label.trim().replace(/^\.+|\.+$/g, ''), zone.name].filter(Boolean).join('.')
    : '';

  const form = useValidation({
    label: validSubdomain(label),
    domain: domain.trim()
      ? (zone ? null : 'That is not one of the domains this token reaches.')
      : 'A domain is required.',
    target: kind === 'host' || target.trim() ? null : `A ${kind} is required.`,
    port: validPort(port, 'A port'),
  });

  const submit = async () => {
    setBusy(true);

    try {
      const route = await api.addRoute({
        replaces: editing?.hostname,
        zoneId: zone!.id,
        subdomain: label.trim(),
        kind,
        target: kind === 'host' ? '' : target.trim(),
        port: port.trim(),
      });

      pushToast(`${where(route.kind, route.target, route.port)} is on ${route.hostname}`);
      onDone(route);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not add the route', 'error');
    } finally {
      setBusy(false);
    }
  };

  const loading = zones === null || targets === null;
  const noDomains = zones !== null && zones.length === 0;
  const noTargets = kind !== 'host' && targets !== null && ofKind.length === 0;

  return (
    <Modal
      title={editing ? `Move ${editing.hostname}` : 'Add a route'}
      subtitle={
        editing
          ? 'The old hostname stops answering as soon as this one starts.'
          : 'Cloudflare carries the traffic; nothing on this Mac listens for it.'
      }
      onClose={onClose}
      onSubmit={() => form.attempt(() => void submit())}
      hint={
        hostname && !loadError ? (
          <span className="flex items-center gap-1.5">
            <Globe size={12} aria-hidden />
            <span className="font-mono">{hostname}</span>
            <ArrowRight size={12} aria-hidden className="opacity-60" />
            <span className="font-mono">{where(kind, target, port)}</span>
          </span>
        ) : undefined
      }
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel={editing ? 'Moving…' : 'Adding…'}
            disabled={!form.valid || loading || noDomains}
            onClick={() => void submit()}
          >
            {editing ? 'Move' : 'Add route'}
          </Button>
        </>
      }
    >
      {loadError && (
        <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-tiny text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-400">
          {loadError}
        </p>
      )}

      {noDomains && !loadError && (
        <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-tiny text-ink-600 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
          This token reaches no domains. A route needs a domain whose nameservers are
          Cloudflare&apos;s.
        </p>
      )}

      <Field
        label="Domain"
        hint={
          loading
            ? 'Asking Cloudflare…'
            : `Type to search ${zones?.length ?? 0} domains this token reaches.`
        }
        {...form.field('domain')}
      >
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          list="dermaga-zones"
          placeholder="example.com"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          // Not disabled while the list loads. The dialog gives focus to the
          // first field that can take it, and a disabled input cannot -- so
          // the caret landed on Subdomain, one field past the first question.
          // Typing before the list arrives is harmless: it fills in behind.
          disabled={noDomains}
          className="input font-mono"
        />
        {/* The domain and nothing else. The account it belongs to was shown
            beside it, which is bookkeeping: nowhere else on this page names an
            account, and a domain is picked because of what it is called. */}
        <datalist id="dermaga-zones">
          {(zones ?? []).map((z) => (
            <option key={z.id} value={z.name} />
          ))}
        </datalist>
      </Field>

      <Field
        label="Subdomain"
        hint="Leave empty to publish on the domain itself."
        {...form.field('label')}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="api"
          spellCheck={false}
          autoComplete="off"
          className="input font-mono"
        />
      </Field>

      {/* A route is not only ever to a container. The VMs have addresses of
          their own, and so does this Mac — which is where somebody's dev server
          usually is, long before it is in a container at all. */}
      <Field label="Answers from" hint="What is behind that hostname.">
        <SegmentedControl
          segments={KINDS}
          ariaLabel="What answers on that hostname"
          value={kind}
          onChange={(next) => {
            setKind(next);

            // The name and port belong to the kind, so they are cleared with
            // it rather than left pointing at something of the wrong sort.
            setTarget('');
            setPort('');
          }}
        />
      </Field>

      {kind !== 'host' && (
        <Field
          label={kind === 'machine' ? 'Machine' : 'Container'}
          hint={noTargets ? undefined : 'Type to search, or name one that is not running yet.'}
          error={noTargets ? `There are no ${kind}s on this Mac.` : form.field('target').error}
          {...{ name: 'target', onBlur: form.field('target').onBlur }}
        >
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            list="dermaga-route-targets"
            spellCheck={false}
            autoComplete="off"
            className="input font-mono"
          />
          <datalist id="dermaga-route-targets">
            {ofKind.map((t) => (
              <option key={t.name} value={t.name}>
                {t.address ? t.address : 'not running'}
              </option>
            ))}
          </datalist>
        </Field>
      )}

      <Field
        label="Port"
        hint={
          kind === 'host'
            ? 'The port on this Mac, as you would open it in a browser.'
            : chosen?.ports.length
              ? 'One route per port, so a container with several gets several.'
              : 'Whatever it listens on. Nothing here declares it, so type it.'
        }
        {...form.field('port')}
      >
        <input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          list="dermaga-route-ports"
          placeholder={kind === 'host' ? '3000' : '80'}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          className="input font-mono"
        />
        <datalist id="dermaga-route-ports">
          {(chosen?.ports ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
    </Modal>
  );
}

/** What a route points at, the way a person would say it. */
function where(kind: TunnelKind, target: string, port: string): string {
  const name = kind === 'host' ? 'this Mac' : target || '—';

  return `${name}:${port || '—'}`;
}
