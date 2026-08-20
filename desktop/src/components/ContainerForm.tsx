import { useMemo, useState } from 'react';
import { Check, Network as NetworkIcon } from 'lucide-react';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import type { PendingEdit, ContainerSpec } from '../types';
import { Checkbox, Field, Fieldset, Modal, Row } from './form';
import { EnvEditor, formatEnv, parseEnv } from './EnvEditor';
import { SegmentedControl } from './SegmentedControl';
import { runTask } from './TaskRows';
import { useTaskStore } from '../store/taskStore';

interface ContainerFormProps {
  /** Present when editing; absent when creating. */
  editing?: string;
  /** What to open with: a whole spec when editing, or just an image to run. */
  initial?: Partial<ContainerSpec>;
  /**
   * An edit that was begun and never finished, which is what the form has been
   * filled from. Shown so the user knows these are their own changes coming
   * back rather than what the container is running now.
   */
  resumed?: PendingEdit;
  /** Throws the unfinished edit away and closes; the container is untouched. */
  onDiscardResumed?: () => void;
  onClose: () => void;
}

const EMPTY: Partial<ContainerSpec> = {
  name: '',
  image: '',
  cpus: 1,
  memory: '512m',
  env: [],
  ports: [],
  mounts: [],
};

/** Marks a container to be started when Dermaga starts; the agent reads it. */
const AUTO_BOOT_LABEL = 'dermaga.autoboot';

/** Labels with the mark set, or without it when it is not wanted. */
function withAutoBoot(labels: Record<string, string> | undefined, wanted: boolean) {
  const next = { ...(labels ?? {}) };

  if (wanted) next[AUTO_BOOT_LABEL] = 'true';
  else delete next[AUTO_BOOT_LABEL];

  return Object.keys(next).length > 0 ? next : undefined;
}

export function ContainerForm({
  editing,
  initial,
  resumed,
  onDiscardResumed,
  onClose,
}: ContainerFormProps) {
  const images = useResourceStore((s) => s.images);
  const volumes = useResourceStore((s) => s.volumes);
  const networks = useResourceStore((s) => s.networks);
  const pushToast = useToastStore((s) => s.push);

  const base = initial ?? EMPTY;
  const [name, setName] = useState(base.name ?? '');
  const [image, setImage] = useState(base.image ?? '');
  const [entrypoint, setEntrypoint] = useState(base.entrypoint ?? '');
  const [command, setCommand] = useState((base.command ?? []).join(' '));
  const [cpus, setCpus] = useState(base.cpus ?? 1);
  const [memory, setMemory] = useState(base.memory ?? '512m');
  const [attached, setAttached] = useState<string[]>(base.networks ?? []);
  const [workdir, setWorkdir] = useState(base.workdir ?? '');
  const [user, setUser] = useState(base.user ?? '');
  const [readOnly, setReadOnly] = useState(base.readOnly ?? false);
  const [init, setInit] = useState(base.init ?? false);
  const [removeOnExit, setRemoveOnExit] = useState(base.removeOnExit ?? false);
  // Kept as a label on the container, so it travels with the thing it
  // describes rather than living in a file of ours.
  const [autoBoot, setAutoBoot] = useState(base.labels?.[AUTO_BOOT_LABEL] === 'true');

  // Held as text: it is what people paste in, and what they read back.
  const [envText, setEnvText] = useState(formatEnv(base.env ?? []));
  const [envMode, setEnvMode] = useState<'fields' | 'text'>('fields');

  /**
   * Switching to text tidies up after the field rows: a row being typed into
   * is a legitimate empty line there, but written out as a bare `=` it is
   * rubbish in a .env file.
   */
  const changeEnvMode = (mode: 'fields' | 'text') => {
    if (mode === 'text') {
      setEnvText(
        envText
          .split('\n')
          .filter((line) => line.trim().startsWith('#') || line.split('=')[0].trim() !== '')
          .join('\n')
      );
    }

    setEnvMode(mode);
  };

  // The text is the one source of truth; the field rows are a view of it, so
  // switching back and forth can never leave the two disagreeing.
  const envPairs = useMemo(
    () =>
      envText.split('\n').map((line) => {
        const at = line.indexOf('=');
        return at === -1
          ? { key: line.trim(), value: '' }
          : { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
      }),
    [envText]
  );

  const setEnvPairs = (pairs: { key: string; value: string }[]) =>
    setEnvText(pairs.map((p) => `${p.key}=${p.value}`).join('\n'));
  const [ports, setPorts] = useState(
    (base.ports ?? []).map((p) => ({ host: p.host, container: p.container, protocol: p.protocol }))
  );
  const [mounts, setMounts] = useState(
    (base.mounts ?? []).map((m) => ({
      type: m.type || 'volume',
      source: m.source,
      target: m.target,
      readOnly: m.readOnly ?? false,
    }))
  );

  const startTask = useTaskStore((s) => s.start);
  const failTask = useTaskStore((s) => s.fail);
  const finishTask = useTaskStore((s) => s.finish);

  // Spread first: the spec carries settings this form does not show -- a
  // read-only root, capabilities, DNS, the runtime handler -- and a recreate
  // that rebuilt it from the fields alone would drop every one of them.
  const buildSpec = (): ContainerSpec => ({
    ...base,
    name: name.trim(),
    image: image.trim(),
    entrypoint: entrypoint.trim() || undefined,
    // Quoting is deliberately not supported here: anything that needs a shell
    // belongs in an entrypoint, not in a text box.
    command: command.trim() ? command.trim().split(/\s+/) : undefined,
    env: parseEnv(envText),
    ports: ports.filter((p) => p.host && p.container),
    mounts: mounts.filter((m) => m.source && m.target),
    cpus: Number(cpus) || undefined,
    memory: memory.trim() || undefined,
    networks: attached.length > 0 ? attached : undefined,
    workdir: workdir.trim() || undefined,
    user: user.trim() || undefined,
    readOnly,
    init,
    removeOnExit,
    labels: withAutoBoot(base.labels, autoBoot),
  });

  // The dialog closes immediately and the work reports itself in the list, so
  // a slow image pull does not hold a modal open.
  const submit = () => {
    const spec = buildSpec();
    const label = spec.name || spec.image;
    const id = `container:${label}`;

    onClose();

    if (!editing) {
      // `container run` reports its own steps -- fetching, unpacking, starting
      // -- so the row shows real progress rather than an endless spinner.
      void runTask({
        id,
        kind: 'container',
        label,
        method: 'containers.create',
        params: spec,
        onDone: (failed) => {
          if (!failed) pushToast(`Created ${label}`);
        },
      });
      return;
    }

    startTask({ id, kind: 'container', label, step: 'Recreating…' });

    void (async () => {
      try {
        await api.updateContainer(editing, spec);
        pushToast(`Recreated ${spec.name || editing}`);
        finishTask(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save the container';
        failTask(id, message);
        pushToast(message, 'error');
      }
    })();
  };

  return (
    <Modal
      wide
      title={editing ? `Edit ${editing}` : 'New container'}
      subtitle={
        editing
          ? 'Apple’s CLI has no update command, so saving stops and recreates this container. Named volumes survive; anything written to the container filesystem does not.'
          : 'Runs `container run --detach` with these settings.'
      }
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={submit} className="btn-primary" disabled={!image.trim()}>
            {editing ? 'Recreate' : 'Create'}
          </button>
        </>
      }
    >
      {resumed && (
        <div className="mb-4 rounded-md border border-orange-600/40 bg-orange-600/5 p-3 text-xs">
          <p className="font-semibold text-orange-700 dark:text-orange-500">
            Picked up where you left off
          </p>
          <p className="mt-1 selectable text-ink-700 dark:text-ink-300">
            These are the changes from an edit that did not finish
            {resumed.reason ? `: ${resumed.reason}` : '.'}
          </p>
          <button onClick={onDiscardResumed} className="btn-ghost mt-2">
            Discard them and start from the container
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" hint="Left blank, the CLI generates one.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-service"
            autoFocus
            className="input"
          />
        </Field>

        <Field label="Image" hint="Pick a local image or type any reference.">
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            list="dermaga-images"
            placeholder="docker.io/library/redis:8.10"
            className="input"
          />
          <datalist id="dermaga-images">
            {images.map((img) => (
              <option key={img.reference} value={img.reference} />
            ))}
          </datalist>
        </Field>

        <Field label="CPUs">
          <input
            type="number"
            min={1}
            max={64}
            value={cpus}
            onChange={(e) => setCpus(Number(e.target.value))}
            className="input"
          />
        </Field>

        <Field label="Memory" hint="Accepts K, M, G suffixes.">
          <input
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            placeholder="512m"
            className="input"
          />
        </Field>

        <Field label="Working directory">
          <input
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="/app"
            className="input"
          />
        </Field>

        <Field label="Entrypoint" hint="Overrides the image entrypoint.">
          <input
            value={entrypoint}
            onChange={(e) => setEntrypoint(e.target.value)}
            placeholder="docker-entrypoint.sh"
            className="input"
          />
        </Field>

        <Field label="Command" hint="Arguments passed to the entrypoint.">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="redis-server --appendonly yes"
            className="input"
          />
        </Field>

        <Field label="User" hint="name, uid, or uid:gid.">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="1000:1000"
            className="input"
          />
        </Field>

        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox
            checked={autoBoot}
            onChange={setAutoBoot}
            label="Start this container when Dermaga starts"
          />
          <Checkbox checked={init} onChange={setInit} label="Run an init process" />
          <Checkbox checked={readOnly} onChange={setReadOnly} label="Read-only root filesystem" />
          <Checkbox
            checked={removeOnExit}
            onChange={setRemoveOnExit}
            label="Remove when it stops"
          />
        </div>
      </div>

      <Fieldset
        legend="Networks"
        hint="A container can sit on several at once. Pick none and the CLI puts it on the built-in default network."
      >
        {networks.length === 0 ? (
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            No networks yet — create one on the Networks page.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {networks.map((n) => {
              const on = attached.includes(n.name);

              return (
                <button
                  key={n.name}
                  type="button"
                  aria-pressed={on}
                  title={n.ipv4Subnet || n.mode}
                  onClick={() =>
                    setAttached(
                      on ? attached.filter((name) => name !== n.name) : [...attached, n.name]
                    )
                  }
                  className={on ? 'btn-primary' : 'btn-ghost'}
                >
                  {on ? <Check size={12} aria-hidden /> : <NetworkIcon size={12} aria-hidden />}
                  {n.name}
                </button>
              );
            })}
          </div>
        )}
      </Fieldset>

      <Fieldset
        legend="Ports"
        addLabel="Add port"
        onAdd={() => setPorts([...ports, { host: '', container: '', protocol: 'tcp' }])}
      >
        {ports.map((port, index) => (
          <Row key={index} onRemove={() => setPorts(ports.filter((_, i) => i !== index))}>
            <input
              value={port.host}
              onChange={(e) =>
                setPorts(ports.map((p, i) => (i === index ? { ...p, host: e.target.value } : p)))
              }
              placeholder="host"
              className="input w-full"
            />
            <span className="text-xs text-ink-500">→</span>
            <input
              value={port.container}
              onChange={(e) =>
                setPorts(
                  ports.map((p, i) => (i === index ? { ...p, container: e.target.value } : p))
                )
              }
              placeholder="container"
              className="input w-full"
            />
            <select
              value={port.protocol}
              onChange={(e) =>
                setPorts(
                  ports.map((p, i) => (i === index ? { ...p, protocol: e.target.value } : p))
                )
              }
              className="input w-24 appearance-none"
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </Row>
        ))}
      </Fieldset>

      <Fieldset
        legend="Mounts"
        addLabel="Add mount"
        onAdd={() =>
          setMounts([...mounts, { type: 'volume', source: '', target: '', readOnly: false }])
        }
      >
        {mounts.map((mount, index) => (
          <Row key={index} onRemove={() => setMounts(mounts.filter((_, i) => i !== index))}>
            <select
              value={mount.type}
              onChange={(e) =>
                setMounts(mounts.map((m, i) => (i === index ? { ...m, type: e.target.value } : m)))
              }
              className="input w-28 appearance-none"
            >
              <option value="volume">volume</option>
              <option value="bind">bind</option>
            </select>
            <input
              value={mount.source}
              onChange={(e) =>
                setMounts(
                  mounts.map((m, i) => (i === index ? { ...m, source: e.target.value } : m))
                )
              }
              list={mount.type === 'volume' ? 'dermaga-volumes' : undefined}
              placeholder={mount.type === 'volume' ? 'volume name' : '/host/path'}
              className="input w-full"
            />
            <span className="text-xs text-ink-500">→</span>
            <input
              value={mount.target}
              onChange={(e) =>
                setMounts(
                  mounts.map((m, i) => (i === index ? { ...m, target: e.target.value } : m))
                )
              }
              placeholder="/container/path"
              className="input w-full"
            />
            <Checkbox
              checked={mount.readOnly}
              onChange={(value) =>
                setMounts(mounts.map((m, i) => (i === index ? { ...m, readOnly: value } : m)))
              }
              label="ro"
            />
          </Row>
        ))}
        <datalist id="dermaga-volumes">
          {volumes.map((v) => (
            <option key={v.name} value={v.name} />
          ))}
        </datalist>
      </Fieldset>

      <Fieldset
        legend="Environment"
        hint={
          editing
            ? 'Values inherited from the image are listed too; they will be set explicitly on recreate.'
            : undefined
        }
        onAdd={envMode === 'fields' ? () => setEnvText(envText ? `${envText}\n=` : '=') : undefined}
        addLabel="Add variable"
      >
        <SegmentedControl
          ariaLabel="How to edit the environment"
          value={envMode}
          onChange={changeEnvMode}
          segments={[
            { value: 'fields', label: 'Fields' },
            { value: 'text', label: '.env text' },
          ]}
        />

        {envMode === 'text' ? (
          <EnvEditor value={envText} onChange={setEnvText} />
        ) : (
          envPairs.map((entry, index) => (
            <Row key={index} onRemove={() => setEnvPairs(envPairs.filter((_, i) => i !== index))}>
              <input
                value={entry.key}
                onChange={(e) =>
                  setEnvPairs(
                    envPairs.map((v, i) => (i === index ? { ...v, key: e.target.value } : v))
                  )
                }
                placeholder="KEY"
                className="input w-1/3 font-mono text-xs"
              />
              <input
                value={entry.value}
                onChange={(e) =>
                  setEnvPairs(
                    envPairs.map((v, i) => (i === index ? { ...v, value: e.target.value } : v))
                  )
                }
                placeholder="value"
                className="input flex-1 font-mono text-xs"
              />
            </Row>
          ))
        )}
      </Fieldset>
    </Modal>
  );
}
