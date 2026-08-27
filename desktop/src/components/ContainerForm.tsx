import { useMemo, useState } from 'react';
import { Check, Network as NetworkIcon } from 'lucide-react';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { askBeforeLeaving } from '../store/uiStore';
import { useToastStore } from '../store/toastStore';
import type { PendingEdit, ContainerSpec } from '../types';
import { Checkbox, Field, Fieldset, FormPage, Row } from './form';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Autocomplete } from './Autocomplete';
import { formatBytes, formatMemory, list } from '../utils/format';
import { DEFAULT_PROJECT, EVERYTHING, prefixed, SEPARATOR } from '../utils/projects';
import { useValidation } from '../hooks/useValidation';
import {
  absolutePath,
  containerName,
  count,
  envText as envTextOf,
  imageReference,
  port as portOf,
  required,
  size as sizeOf,
  user as userOf,
} from '../utils/validate';

/** A sentence made to follow a colon: "Port 2: host port must be a number." */
function lower(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}
import { EnvEditor, formatEnv, parseEnv } from './EnvEditor';
import { SegmentedControl } from './SegmentedControl';
import { runTask } from '../services/tasks';
import { useTaskStore } from '../store/taskStore';

interface ContainerFormProps {
  /** Present when editing; absent when creating. */
  editing?: string;
  /** Where the back link goes, named — "Containers", or a container's name. */
  backTo?: string;
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
  /**
   * Called once the run is under way, with the name it was filed under.
   *
   * Where the form goes next is the page's to decide, not this component's --
   * creating lands on what the run is printing, and the only thing needed to
   * find that is the id, which is the one thing only this side knows.
   */
  onStarted?: (taskId: string) => void;
  /**
   * Whether the container starts with Dermaga, which is not part of the spec:
   * it is a record Dermaga keeps rather than anything the runtime knows.
   */
  startsWithDermaga?: boolean;
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

/**
 * How starting with Dermaga was marked up to 1.11.0, and how a template can
 * still ask for it.
 *
 * NOTE: TEMPORARY — remove with the label fallback in the agent, in 1.15.0.
 * It is only read here now: the setting is a record Dermaga keeps, because a
 * label can only be written by `container run` and turning this on used to
 * cost the container its filesystem.
 */
const AUTO_BOOT_LABEL = 'dermaga.autoboot';

/**
 * The least time the Create button spins for.
 *
 * The agent answers as soon as it has the command, which on an image already
 * on the Mac is quick enough that the spinner would appear and be gone inside
 * the same frame -- and a control that flickers reads as a glitch rather than
 * as work done. Long enough to be seen, short enough that nobody waits on it.
 */
const HELD_FOR = 550;

const held = () => new Promise((resolve) => setTimeout(resolve, HELD_FOR));

export function ContainerForm({
  editing,
  backTo,
  initial,
  resumed,
  onDiscardResumed,
  onStarted,
  startsWithDermaga,
  onClose,
}: ContainerFormProps) {
  const images = useResourceStore((s) => s.images);
  // What a new container is filed under: the project the window is looking
  // through. Nothing to choose here -- the switcher is what chooses it, and a
  // second place to answer the same question is a second place to get it wrong.
  const activeProject = useActiveProject();
  // What the name will be filed as, shown in front of the field. Absent while
  // editing: a rename on this runtime is a recreate, so an existing container
  // keeps the name it was born with whatever project it is filed under now.
  const namePrefix =
    !editing && activeProject !== EVERYTHING && activeProject !== DEFAULT_PROJECT
      ? `${activeProject}${SEPARATOR}`
      : '';
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
  const [shmSize, setShmSize] = useState(base.shmSize ?? '');
  // One per row, the same shape the ports and mounts rows have. Empty rows are
  // dropped on the way out; a row filled in wrongly is refused with a reason.
  const [ulimits, setUlimits] = useState<string[]>(base.ulimits ?? []);
  const [attached, setAttached] = useState<string[]>(base.networks ?? []);
  const [workdir, setWorkdir] = useState(base.workdir ?? '');
  const [user, setUser] = useState(base.user ?? '');
  const [readOnly, setReadOnly] = useState(base.readOnly ?? false);
  const [init, setInit] = useState(base.init ?? false);
  const [removeOnExit, setRemoveOnExit] = useState(base.removeOnExit ?? false);
  // What the container is set to now, handed in by whoever opened the form; a
  // template may ask for it with the old label instead.
  const wasAutoBoot = startsWithDermaga ?? base.labels?.[AUTO_BOOT_LABEL] === 'true';
  const [autoBoot, setAutoBoot] = useState(wasAutoBoot);

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

  // What the Create button has been pressed on, held while the question about
  // it is up. The spec is taken at the moment of asking rather than read again
  // on the answer: what the dialog describes and what gets made are then the
  // same thing, whatever the form does underneath.
  const [confirming, setConfirming] = useState<{ spec: ContainerSpec; autoBoot: boolean } | null>(
    null
  );
  // Whether the run has been asked for and not yet acknowledged. The button
  // spins on it, which is the whole of what this state is for: the work itself
  // belongs to the task strip and outlives this form.
  const [creating, setCreating] = useState(false);

  const startTask = useTaskStore((s) => s.start);
  const failTask = useTaskStore((s) => s.fail);
  const finishTask = useTaskStore((s) => s.finish);

  // Spread first: the spec carries settings this form does not show -- a
  // read-only root, capabilities, DNS, the runtime handler -- and a recreate
  // that rebuilt it from the fields alone would drop every one of them.
  const buildSpec = (): ContainerSpec => ({
    ...base,
    // Prefixed on the way in. The agent does it too -- it is the seam every
    // way in passes through -- and both agreeing beats either guessing.
    name: editing ? name.trim() : prefixed(activeProject, name),
    image: image.trim(),
    entrypoint: entrypoint.trim() || undefined,
    // Quoting is deliberately not supported here: anything that needs a shell
    // belongs in an entrypoint, not in a text box.
    command: command.trim() ? command.trim().split(/\s+/) : undefined,
    env: parseEnv(envText),
    ports: ports.filter((p) => p.host && p.container),
    mounts: mounts.filter((m) => (m.type === 'tmpfs' ? m.target : m.source && m.target)),
    cpus: Number(cpus) || undefined,
    memory: memory.trim() || undefined,
    shmSize: shmSize.trim() || undefined,
    ulimits: ulimits.map((l) => l.trim()).filter(Boolean),
    networks: attached.length > 0 ? attached : undefined,
    workdir: workdir.trim() || undefined,
    user: user.trim() || undefined,
    readOnly,
    init,
    removeOnExit,
    labels: base.labels,
    // Only on the way in. Editing recreates the container under the same name,
    // and membership is keyed by that name, so it survives on its own -- while
    // sending the project in force here would quietly re-file a container
    // somebody opened from a different point of view.
    project: editing ? undefined : activeProject || undefined,
  });

  // A row nobody filled in is not a mistake -- it is a row that was added and
  // left, and the spec drops those. A row filled in halfway is a mistake, and
  // one that used to be dropped just as quietly: a port with no container side
  // simply never appeared, and nothing said why.
  const portProblem = () => {
    for (const [index, entry] of ports.entries()) {
      if (!entry.host && !entry.container) continue;

      const problem = portOf(entry.host, 'Host port') ?? portOf(entry.container, 'Container port');
      if (problem) return `Port ${index + 1}: ${lower(problem)}`;
    }

    return null;
  };

  const mountProblem = () => {
    for (const [index, entry] of mounts.entries()) {
      // A tmpfs is only a path inside the container -- asking for a source
      // would be asking for something that does not exist.
      if (entry.type === 'tmpfs') {
        if (!entry.target) continue;

        const problem = absolutePath(entry.target, 'A path inside the container');
        if (problem) return `Mount ${index + 1}: ${lower(problem)}`;
        continue;
      }

      if (!entry.source && !entry.target) continue;

      const problem =
        required(entry.source, entry.type === 'bind' ? 'A path on this Mac' : 'A volume name') ??
        absolutePath(entry.target, 'A path inside the container');
      if (problem) return `Mount ${index + 1}: ${lower(problem)}`;
    }

    return null;
  };

  // The same shape the agent checks, said here first: the runtime reports a
  // malformed limit only after the image is down, in its own words, about a
  // flag the person never typed.
  const ulimitProblem = () => {
    for (const [index, entry] of ulimits.entries()) {
      const limit = entry.trim();
      if (!limit) continue;

      const [name, values] = limit.split('=', 2);
      const halves = (values ?? '').split(':');
      const numbers = halves.every((half) => /^\s*\d+\s*$/.test(half));

      if (!name?.trim() || !values?.trim() || halves.length > 2 || !numbers) {
        return `Limit ${index + 1}: needs the shape type=soft or type=soft:hard`;
      }

      if (halves.length === 2 && Number(halves[1]) < Number(halves[0])) {
        return `Limit ${index + 1}: the hard limit is below the soft one`;
      }
    }

    return null;
  };

  const form = useValidation({
    name: containerName(name),
    image: required(image, 'An image') ?? imageReference(image),
    cpus: count(String(cpus), 'CPUs'),
    // The runtime refuses anything under 200 MiB -- but only after pulling the
    // image, which is minutes spent to be told something knowable now.
    memory: sizeOf(memory, 'Memory', 200),
    workdir: workdir.trim() ? absolutePath(workdir, 'A working directory') : null,
    user: userOf(user),
    ports: portProblem(),
    mounts: mountProblem(),
    shmSize: shmSize.trim() ? sizeOf(shmSize, 'Shared memory', 0) : null,
    ulimits: ulimitProblem(),
    env: envTextOf(envText),
    // The record is kept against the container's name, so there has to be one.
    // Left blank, the CLI invents a name this side never learns.
    autoBoot:
      autoBoot && !name.trim()
        ? 'Starting with Dermaga needs a name — the record is kept against it.'
        : null,
  });

  const submit = async (spec: ContainerSpec = buildSpec()) => {
    const label = spec.name || spec.image;
    const id = `container:${label}`;

    // Kept against the name rather than sent with the spec, because the
    // runtime has nowhere to put it. Written before the container exists on
    // purpose: it is only a name in a table, the container is a second away,
    // and a create that fails leaves a record the next startup sweeps up.
    if (autoBoot !== wasAutoBoot && spec.name) {
      void api.setAutoBoot(spec.name, autoBoot).catch(() => {
        pushToast(`Could not record whether ${spec.name} starts with Dermaga`, 'error');
      });
    }

    if (!editing) {
      setCreating(true);

      // Held until the agent has the command, and no longer. `container run`
      // reports its own steps after that -- fetching, unpacking, starting --
      // and it reports them to the task strip, which outlives this form.
      await Promise.all([
        runTask({
          id,
          kind: 'container',
          label,
          method: 'containers.create',
          params: spec,
          // Nothing to say here: finishing is announced once, from the side
          // that knows whether this window is in front of the user or behind
          // them.
        }),
        held(),
      ]);

      setCreating(false);
      // Onto what it is printing, where a pull that is going to take a while
      // says so line by line -- rather than back to a list where the only sign
      // of it is a bar in the title bar. Nothing is lost by leaving that page:
      // the run belongs to the task strip either way.
      // Started, so there is nothing in this form left to lose, and the page
      // it is about to be replaced by must not be asked about.
      askBeforeLeaving(null);
      if (onStarted) onStarted(id);
      else onClose();
      return;
    }

    // Recreating closes at once and reports itself in the strip: it is started
    // from a container that is already on screen somewhere behind this.
    //
    // The question about leaving is dropped first. FormPage arms it the moment
    // anything is typed into the page, and closing here *is* the save -- so
    // without this the recreate that was just asked for, confirmed, and started
    // is answered with "Leave without saving?", about work that is already on
    // its way. The create branch above does the same thing for the same reason;
    // this one was missed.
    askBeforeLeaving(null);
    onClose();
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

  /**
   * What the button does: ask, and only then do it.
   *
   * Not the confirmation a delete gets -- creating is not destructive. It is
   * the last place these settings can be read back as a sentence rather than
   * as thirty fields, which is where a port typed into the wrong box or a
   * gigabyte that was meant to be a megabyte is actually noticed. Recreating
   * is destructive as well as long, and gets the same question with the price
   * of it said out loud.
   */
  const primary = () => {
    if (creating) return;

    setConfirming({ spec: buildSpec(), autoBoot });
  };

  return (
    <FormPage
      backTo={backTo}
      title={editing ? `Edit ${editing}` : 'New container'}
      subtitle={
        editing
          ? 'Apple’s CLI has no update command, so saving stops and recreates this container. Named volumes survive; anything written to the container filesystem does not.'
          : 'Runs `container run --detach` with these settings.'
      }
      onClose={onClose}
      onSubmit={() => form.attempt(primary)}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={creating}>
            Cancel
          </button>
          {/* It spins rather than only greying out: a button that has gone
              quiet leaves somebody wondering whether the press landed, and
              this one is pressed once and answered a second later. */}
          <Button
            variant="primary"
            busy={creating}
            busyLabel="Creating…"
            disabled={!form.valid}
            onClick={() => form.attempt(primary)}
          >
            {editing ? 'Recreate' : 'Create'}
          </Button>
        </>
      }
    >
      {/* Rounded and padded like the cards below it rather than like a
          notice pasted on top of them: it is the first thing on the page, and
          a box in a different shape reads as something the form has gone wrong
          about rather than as where the form has come from. */}
      {resumed && (
        <div className="flex flex-col items-start gap-1.5 rounded-xl border border-orange-600/40 bg-orange-600/5 p-3.5">
          <p className="text-small font-semibold text-orange-700 dark:text-orange-500">
            Picked up where you left off
          </p>
          <p className="selectable text-small text-ink-700 dark:text-ink-300">
            These are the changes from an edit that did not finish
            {resumed.reason ? `: ${resumed.reason}` : '.'}
          </p>
          {/* Throwing the unfinished edit away is an answer to the question
              about leaving, not a reason to be asked it again on the way out. */}
          <button
            onClick={() => {
              askBeforeLeaving(null);
              onDiscardResumed?.();
            }}
            className="btn-ghost"
          >
            Discard them and start from the container
          </button>
        </div>
      )}

      {/* What the container is. Four fields nobody gets to skip -- the two
          that name it and the two that bound it -- kept together at the top so
          the common case is a card and a button. */}
      <Fieldset legend="Container" columns={2}>
        <Field
          label="Name"
          hint={
            namePrefix
              ? `Named for ${activeProject}, and reached at that name from other containers.`
              : 'Left blank, the CLI generates one.'
          }
          {...form.field('name')}
        >
          {/* The prefix is shown, never applied quietly. It is not decoration:
              a container's name is its address on every network it joins, so
              somebody typing `db` here needs to see that the thing they are
              about to write into a connection string is `bengkel-db`. */}
          <div className="input flex items-center gap-0 p-0 focus-within:border-brand-600">
            {namePrefix && (
              <span className="shrink-0 select-none py-1.5 pl-2.5 font-mono text-code text-ink-500 dark:text-ink-400">
                {namePrefix}
              </span>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-service"
              autoFocus
              className={`min-w-0 flex-1 bg-transparent py-1.5 pr-2.5 outline-hidden ${
                namePrefix ? 'pl-0' : 'pl-2.5'
              }`}
            />
          </div>
        </Field>

        <Field
          label="Image"
          hint="Pick a local image or type any reference."
          {...form.field('image')}
        >
          <Autocomplete
            value={image}
            onChange={setImage}
            // What is on this Mac, with what it costs to keep -- the same two
            // things the Images page is read for. Anything else can still be
            // typed: a reference that is not here yet is pulled by the run.
            options={images.map((img) => ({
              value: img.reference,
              hint: formatBytes(img.sizeInBytes),
            }))}
            placeholder="docker.io/library/redis:8.10"
            mono
          />
        </Field>

        <Field label="CPUs" {...form.field('cpus')}>
          <input
            type="number"
            min={1}
            max={64}
            value={cpus}
            onChange={(e) => setCpus(Number(e.target.value))}
            className="input"
          />
        </Field>

        <Field label="Memory" hint="Accepts K, M, G suffixes." {...form.field('memory')}>
          <input
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            placeholder="512m"
            className="input"
          />
        </Field>

        {/* Beside memory, because it is memory: /dev/shm is a slice of it, and
            the default is small. Postgres asks for shared buffers it cannot
            get and reports a failure about the database; headless Chrome
            crashes the tab. Neither says anything about shared memory, so this
            is the field that is looked for only once somebody has already lost
            an afternoon. */}
        <Field label="Shared memory" hint="/dev/shm. Left empty, the runtime decides." {...form.field('shmSize')}>
          <input
            value={shmSize}
            onChange={(e) => setShmSize(e.target.value)}
            placeholder="64m"
            className="input"
          />
        </Field>
      </Fieldset>

      {/* What runs inside it, and as whom. All four override something the
          image already sets, which is what makes them a group and what makes
          them safe to leave alone. */}
      <Fieldset legend="Process" hint="Left empty, the image decides." columns={2}>
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

        <Field label="Working directory" {...form.field('workdir')}>
          <input
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="/app"
            className="input"
          />
        </Field>

        <Field label="User" hint="name, uid, or uid:gid." {...form.field('user')}>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="1000:1000"
            className="input"
          />
        </Field>
      </Fieldset>

      {/* The switches, in a group of their own. They used to be stacked in the
          last cell of the field grid, where they were a column of sentences
          wedged beside a column of boxes -- four decisions with no heading,
          taking their alignment from whichever field happened to sit above. */}
      <Fieldset legend="Behaviour" columns={2}>
        <div className="flex flex-col gap-1" data-field="autoBoot">
          <Checkbox
            checked={autoBoot}
            onChange={setAutoBoot}
            label="Start this container when Dermaga starts"
          />
          {form.problem('autoBoot') && (
            <p className="text-tiny font-medium text-orange-700 dark:text-orange-500">
              {form.problem('autoBoot')}
            </p>
          )}
        </div>
        <Checkbox checked={init} onChange={setInit} label="Run an init process" />
        <Checkbox checked={readOnly} onChange={setReadOnly} label="Read-only root filesystem" />
        <Checkbox checked={removeOnExit} onChange={setRemoveOnExit} label="Remove when it stops" />
      </Fieldset>

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
        {...form.field('ports')}
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
              className="input min-w-24 flex-1"
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
              className="input min-w-24 flex-1"
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
        {...form.field('mounts')}
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
              <option value="tmpfs">tmpfs</option>
            </select>
            {/* A tmpfs has no host side. There is nothing to name and nothing
                to pick from -- it is memory, thrown away with the container --
                so the row says so where the source would be rather than
                offering a box that does nothing. */}
            {mount.type === 'tmpfs' ? (
              <span className="min-w-36 flex-1 self-center text-small text-ink-500 dark:text-ink-400">
                in memory, gone with the container
              </span>
            ) : (
              <Autocomplete
                value={mount.source}
                onChange={(next) =>
                  setMounts(mounts.map((m, i) => (i === index ? { ...m, source: next } : m)))
                }
                // Volumes are a list to pick from; a path on this Mac is not,
                // and a field that suggests nothing simply does not suggest.
                options={
                  mount.type === 'volume'
                    ? volumes.map((v) => ({ value: v.name, hint: formatBytes(v.usedBytes) }))
                    : []
                }
                placeholder={mount.type === 'volume' ? 'volume name' : '/host/path'}
                aria-label={mount.type === 'volume' ? 'Volume name' : 'Path on this Mac'}
                className="min-w-36 flex-1"
                mono
              />
            )}
            <span className="text-xs text-ink-500">→</span>
            <input
              value={mount.target}
              onChange={(e) =>
                setMounts(
                  mounts.map((m, i) => (i === index ? { ...m, target: e.target.value } : m))
                )
              }
              placeholder="/container/path"
              className="input min-w-36 flex-1"
            />
            {mount.type !== 'tmpfs' && (
              <Checkbox
                checked={mount.readOnly}
                onChange={(value) =>
                  setMounts(mounts.map((m, i) => (i === index ? { ...m, readOnly: value } : m)))
                }
                label="ro"
              />
            )}
          </Row>
        ))}
      </Fieldset>

      {/* Rarely set, and when it is set it is `nofile` on something that opens
          a great many sockets. Its own group rather than a field beside CPUs:
          it repeats, and a repeating row wedged between two single fields
          makes the group above it look like it repeats too. */}
      <Fieldset
        legend="Limits"
        hint="Resource limits, as type=soft or type=soft:hard."
        addLabel="Add limit"
        {...form.field('ulimits')}
        onAdd={() => setUlimits([...ulimits, ''])}
      >
        {ulimits.map((limit, index) => (
          <Row key={index} onRemove={() => setUlimits(ulimits.filter((_, i) => i !== index))}>
            <input
              value={limit}
              onChange={(e) =>
                setUlimits(ulimits.map((l, i) => (i === index ? e.target.value : l)))
              }
              placeholder="nofile=4096:8192"
              aria-label={`Limit ${index + 1}`}
              className="input min-w-36 flex-1 font-mono text-code"
            />
          </Row>
        ))}
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
        {...form.field('env')}
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
                className="input min-w-28 flex-1 font-mono text-xs"
              />
              <input
                value={entry.value}
                onChange={(e) =>
                  setEnvPairs(
                    envPairs.map((v, i) => (i === index ? { ...v, value: e.target.value } : v))
                  )
                }
                placeholder="value"
                className="input min-w-40 flex-[2] font-mono text-xs"
              />
            </Row>
          ))
        )}
      </Fieldset>

      {confirming && (
        <ConfirmDialog
          {...asked(confirming.spec, confirming.autoBoot, editing)}
          onConfirm={() => {
            const { spec } = confirming;
            setConfirming(null);
            void submit(spec);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </FormPage>
  );
}

/**
 * The question the button asks before it does anything.
 *
 * The same shape for both, and the difference between them is the first line:
 * creating costs nothing but a container, and recreating costs the one that is
 * there now. What it will be afterwards is said either way -- that is the part
 * worth checking, and it is the same paragraph in both cases.
 */
export function asked(
  spec: ContainerSpec,
  autoBoot: boolean,
  editing?: string
): { title: string; body: string; confirmLabel: string } {
  const becomes = summarise(spec, autoBoot);

  if (editing) {
    return {
      title: `Recreate ${editing}?`,
      // The cost first. Apple's CLI has no update, so saving is a delete and a
      // run -- and somebody who reads no further than the first line should
      // still have read the part that cannot be undone.
      body: `It is stopped, deleted and run again with these settings. Named volumes survive; anything written to the container filesystem does not. ${becomes}`,
      confirmLabel: 'Recreate',
    };
  }

  return {
    title: spec.name ? `Create ${spec.name}?` : 'Create this container?',
    body: becomes,
    confirmLabel: 'Create',
  };
}

/**
 * What is about to be made, read back as a sentence.
 *
 * Only what somebody would want checked, and only what they set: the image and
 * what it is allowed to spend, where it will answer, what it will be able to
 * write to, and the two settings that outlive the run. Everything left at its
 * default is left out -- a paragraph that lists eight defaults is a paragraph
 * nobody finishes, and the mistake being looked for is hiding in it.
 */
export function summarise(spec: ContainerSpec, autoBoot: boolean): string {
  // Both are allowed to be empty, and empty means the CLI decides -- so an
  // unset limit is said as that rather than as the number this form happens to
  // show, which would be the one thing here that was not true.
  const limits = [
    spec.cpus ? `${spec.cpus} CPU${spec.cpus === 1 ? '' : 's'}` : null,
    spec.memory ? `${formatMemory(spec.memory)} of memory` : null,
    spec.shmSize ? `${formatMemory(spec.shmSize)} of that shared` : null,
  ].filter(Boolean);

  const sentences = [
    limits.length > 0
      ? `${spec.image} runs with ${limits.join(' and ')}, and starts straight away.`
      : `${spec.image} runs on the CLI's own defaults, and starts straight away.`,
  ];

  if (!spec.name) sentences.push('The CLI will give it a name, since none was set.');

  const ports = spec.ports ?? [];
  if (ports.length > 0) {
    sentences.push(
      `${list(ports.map((p) => `${p.host} → ${p.container}`))} ${ports.length === 1 ? 'is' : 'are'} published on this Mac.`
    );
  }

  // Said apart from the rest, because a tmpfs is the one mount that keeps
  // nothing: reading it back beside a volume as "source → target" would put a
  // word where there is no source and imply the data survives.
  const mounts = (spec.mounts ?? []).filter((m) => m.type !== 'tmpfs');
  if (mounts.length > 0) {
    sentences.push(
      `${list(mounts.map((m) => `${m.source} → ${m.target}`))} ${mounts.length === 1 ? 'is' : 'are'} mounted into it.`
    );
  }

  const scratch = (spec.mounts ?? []).filter((m) => m.type === 'tmpfs');
  if (scratch.length > 0) {
    sentences.push(
      `${list(scratch.map((m) => m.target))} ${scratch.length === 1 ? 'is' : 'are'} in memory, and ${scratch.length === 1 ? 'goes' : 'go'} when the container does.`
    );
  }

  const ulimits = (spec.ulimits ?? []).filter(Boolean);
  if (ulimits.length > 0) {
    sentences.push(`Its limits are set: ${list(ulimits)}.`);
  }

  if (spec.networks && spec.networks.length > 0) {
    sentences.push(`It sits on ${list(spec.networks)}.`);
  }

  if (spec.removeOnExit) sentences.push('It is deleted as soon as it stops.');
  if (autoBoot) sentences.push('It will start again whenever Dermaga does.');

  return sentences.join(' ');
}
