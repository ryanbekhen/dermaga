import {
  Boxes,
  CircleHelp,
  CloudUpload,
  Cpu,
  Database,
  Download,
  Globe,
  FileUp,
  Hammer,
  Layers,
  LayoutGrid,
  Network,
  Play,
  RotateCw,
  Plug,
  Plus,
  Scale,
  SearchX,
  Server,
  Settings,
  Sparkles,
  Square,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatusText } from '../components/StatusBadge';
import { loadImage } from '../components/ImageArchive';
import { api } from '../services/api';
import { openExternal } from '../services/ipc';
import { useResourceStore } from '../store/resourceStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { builtInProject, filedInProject, inProject, networkInProject } from '../utils/projects';
import { useToastStore } from '../store/toastStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUIStore } from '../store/uiStore';
import { withoutHidden } from '../utils/builder';
import { formatBytes, formatMemory, shortImage } from '../utils/format';
import type { ReactNode } from 'react';
import type { Route } from '../types';

/** Something the app can be told to do, found by typing its name. */
interface Verb {
  label: string;
  icon: LucideIcon;
  /** Words somebody might type for it that are not in the label. */
  keywords: string;
  run: () => void;
}

/** A page, reachable by name — the palette's "Go to" section. */
const PAGES: { label: string; icon: LucideIcon; route: Route; keywords: string }[] = [
  { label: 'Containers', icon: Boxes, route: { name: 'containers' }, keywords: 'running' },
  { label: 'Images', icon: Layers, route: { name: 'images' }, keywords: 'repository tags' },
  { label: 'Volumes', icon: Database, route: { name: 'volumes' }, keywords: 'disk storage' },
  { label: 'Networks', icon: Network, route: { name: 'networks' }, keywords: 'bridge subnet' },
  {
    label: 'Registries',
    icon: CloudUpload,
    route: { name: 'registries' },
    keywords: 'login credentials',
  },
  {
    label: 'Tunnels',
    icon: Globe,
    route: { name: 'tunnels' },
    keywords: 'cloudflare hostname domain publish public route share',
  },
  { label: 'Machines', icon: Server, route: { name: 'machines' }, keywords: 'vm linux' },
  { label: 'System', icon: Cpu, route: { name: 'system' }, keywords: 'services disk prune' },
  { label: 'Settings', icon: Settings, route: { name: 'settings' }, keywords: 'preferences theme' },
  {
    label: "What's new",
    icon: Sparkles,
    route: { name: 'changelog' },
    keywords: 'changelog release notes',
  },
  { label: 'Help', icon: CircleHelp, route: { name: 'help' }, keywords: 'shortcuts docs' },
  { label: 'Licences', icon: Scale, route: { name: 'licences' }, keywords: 'notices open source' },
];

interface Result {
  key: string;
  /**
   * What kind of thing this is, said in a glyph before it is read. A coloured
   * dot said only "running" or "not", which is nothing at all on an image or a
   * network -- and left four kinds of result looking identical down the page.
   */
  icon: LucideIcon;
  /** A text colour for the icon: green for running, grey for anything idle. */
  tone: string;
  title: string;
  /** The line under the title, in mono: an id, a mount point, a subnet. */
  sub: string;
  meta: string;
  measure: string;
  /** What state the thing is in, as a word in a colour. */
  state: ReactNode;
  open?: () => void;
}

interface Group {
  label: string;
  results: Result[];
}

/**
 * What matched, across everything, on one page.
 *
 * The command palette answers "take me to the thing I can already name". This
 * answers the other question -- "what have I got that looks like this?" -- and
 * the difference is what is on screen afterwards: the palette closes onto one
 * destination, and this stays open with every match and enough of each one to
 * tell them apart. A half-remembered tag is worth a page; a name you know is
 * worth a shortcut.
 *
 * Actions are searched too, not only things. This page replaced a command
 * palette, and a palette that only found nouns would have been half of one:
 * "pull" should reach Pull an image the way "redis" reaches the container. So
 * the verbs a page can be opened to perform are matched by name and listed
 * first, above whatever they would act on.
 *
 * Every kind of resource the app keeps in memory is searched, machines
 * included. Registries are the one exception: their page fetches them itself
 * rather than reading a store, so there is nothing here to match against --
 * and there are rarely more than a handful, on one page, in front of you.
 */
export function SearchResultsPage() {
  const query = useUIStore((s) => s.globalQuery);
  const setGlobalQuery = useUIStore((s) => s.setGlobalQuery);
  const openContainer = useUIStore((s) => s.openContainer);
  const openImage = useUIStore((s) => s.openImage);
  const openVolume = useUIStore((s) => s.openVolume);
  const openNetwork = useUIStore((s) => s.openNetwork);
  const navigate = useUIStore((s) => s.navigate);
  const navigateWith = useUIStore((s) => s.navigateWith);
  const push = useToastStore((s) => s.push);
  const showBuilder = useSettingsStore((s) => s.showBuilder);

  // Which row the keys are on, remembered together with the query it belongs
  // to. Held as a pair rather than reset by an effect: a new query is a new
  // list, and a cursor left on row nine of it would sit somewhere the user
  // never looked -- but resetting it after the fact means a render where it
  // still points at the old row. Paired, the reset is simply what the value is.
  const [pick, setPick] = useState<{ query: string; at: number }>({ query: '', at: 0 });
  const cursor = pick.query === query ? pick.at : 0;
  const currentRow = useRef<HTMLButtonElement>(null);

  // Where the pointer is, and whether it has moved of its own accord.
  //
  // Arrowing down scrolls the list, and a list that scrolls under a pointer
  // that has not moved slides a new row beneath it -- which fires mouseenter,
  // which used to move the selection to whatever happened to be under the
  // mouse. So walking down with the keys jumped back up as soon as the
  // scrolling started, over and over, with nothing on screen to explain it.
  //
  // The coordinates are what makes this reliable rather than a guess: WebKit
  // can raise a mousemove after a scroll at the very same point, so "the mouse
  // moved" has to mean the position changed, not that an event arrived.
  const pointer = useRef({ x: -1, y: -1, live: false });

  const openMachine = useUIStore((s) => s.openMachine);
  // "Create container" is a page now rather than a dialog asked for on the way
  // to one, so the verb navigates to it like any other result does.
  const newContainer = useUIStore((s) => s.newContainer);
  const browseTemplates = useUIStore((s) => s.browseTemplates);
  const buildImage = useUIStore((s) => s.buildImage);
  const addRoute = useUIStore((s) => s.addRoute);
  const newMachine = useUIStore((s) => s.newMachine);
  const containers = useResourceStore((s) => s.containers);
  const activeProject = useActiveProject();
  const images = useResourceStore((s) => s.images);
  const volumes = useResourceStore((s) => s.volumes);
  const networks = useResourceStore((s) => s.networks);
  const machines = useResourceStore((s) => s.machines);
  const tunnels = useResourceStore((s) => s.tunnels);

  const needle = query.trim().toLowerCase();
  const matches = (...fields: (string | undefined)[]) =>
    fields.some((field) => field?.toLowerCase().includes(needle));

  const groups: Group[] = [];

  // The verbs first, because a search that matches one is almost always a
  // search for it: nobody types "pull" hoping to be shown an image.
  //
  // Two kinds of them. The ones that make something new stand on their own and
  // are always offered; the rest are about a particular container, image or
  // network, and only exist because that thing does -- "Stop redis" is only a
  // command on a machine where redis is running.
  const verbs: Verb[] = [
    {
      label: 'Create container',
      icon: Plus,
      keywords: 'new run start',
      run: () => newContainer(),
    },
    {
      label: 'Create container from a template',
      icon: LayoutGrid,
      keywords: 'new gallery catalogue stack',
      run: () => browseTemplates(),
    },
    {
      label: 'Add a route',
      icon: Globe,
      keywords: 'tunnel cloudflare publish hostname domain subdomain share expose public',
      run: () => addRoute(),
    },
    {
      label: 'Pull image',
      icon: Download,
      keywords: 'download fetch registry',
      run: () => navigateWith({ name: 'images' }, 'image.pull'),
    },
    {
      label: 'Build image from a folder',
      icon: Hammer,
      keywords: 'compile context dockerfile project directory',
      run: () => buildImage({ start: 'folder' }),
    },
    {
      // The same dialog, opened on its other half. Two entries because they
      // are two different things to have decided before typing anything: one
      // needs a project on disk, the other needs a Dockerfile on the
      // clipboard, and searching for the one you meant should not land on the
      // one you did not.
      label: 'Build image from a pasted Dockerfile',
      icon: Hammer,
      keywords: 'compile paste clipboard text quick',
      run: () => buildImage({ start: 'paste' }),
    },
    {
      label: 'Load image from a file',
      icon: FileUp,
      keywords: 'import tar archive open',
      // No form to open: the file chooser is the whole interaction, and Images
      // is where its progress will appear.
      run: () => {
        navigate({ name: 'images' });
        void loadImage();
      },
    },
    {
      label: 'Create volume',
      icon: Database,
      keywords: 'new disk storage',
      run: () => navigateWith({ name: 'volumes' }, 'volume.create'),
    },
    {
      label: 'Create network',
      icon: Network,
      keywords: 'new bridge subnet',
      run: () => navigateWith({ name: 'networks' }, 'network.create'),
    },
    {
      label: 'Create machine',
      icon: Server,
      keywords: 'new vm linux',
      run: () => newMachine(),
    },
    {
      label: 'Sign in to a registry',
      icon: CloudUpload,
      keywords: 'add login credentials docker hub ghcr',
      run: () => navigateWith({ name: 'registries' }, 'registry.add'),
    },

    // Run this image. What somebody has in mind typing an image name is often
    // the container they want out of it, not the image's own page.
    ...images.map((image) => ({
      label: `Run ${shortImage(image.reference)}`,
      icon: Play,
      keywords: `${image.reference} new container create`,
      run: () => newContainer({ image: image.reference }),
    })),

    ...withoutHidden(containers, showBuilder)
      .filter((container) => container.status !== 'running')
      .map((container) => ({
        label: `Start ${container.name}`,
        icon: Play,
        keywords: container.image,
        run: () => {
          void api
            .startContainer(container.id)
            .catch((error: Error) => push(error.message, 'error'));
        },
      })),

    ...withoutHidden(containers, showBuilder)
      .filter((container) => container.status === 'running')
      .map((container) => ({
        label: `Stop ${container.name}`,
        icon: Square,
        keywords: container.image,
        run: () => {
          void api
            .stopContainer(container.id)
            .catch((error: Error) => push(error.message, 'error'));
        },
      })),

    // Stop then start, the pair the list and the detail page both run: the
    // runtime has no restart of its own.
    ...withoutHidden(containers, showBuilder)
      .filter((container) => container.status === 'running')
      .map((container) => ({
        label: `Restart ${container.name}`,
        icon: RotateCw,
        keywords: `${container.image} bounce reboot`,
        run: () => {
          void (async () => {
            await api.stopContainer(container.id);
            await api.startContainer(container.id);
          })().catch((error: Error) => push(error.message, 'error'));
        },
      })),

    // The machines the containers run on. Reached by name like everything
    // else: a machine is the one thing here whose being down explains why
    // nothing else works, and hunting for its page to start it is a detour
    // through the very thing that is broken.
    ...machines
      .filter((machine) => machine.status !== 'running')
      .map((machine) => ({
        label: `Start machine ${machine.id}`,
        icon: Play,
        keywords: `vm virtual ${machine.os ?? ''} ${machine.ipAddress ?? ''}`,
        run: () => {
          void api.startMachine(machine.id).catch((error: Error) => push(error.message, 'error'));
        },
      })),

    ...machines
      .filter((machine) => machine.status === 'running')
      .flatMap((machine) => [
        {
          label: `Stop machine ${machine.id}`,
          icon: Square,
          keywords: `vm virtual ${machine.os ?? ''} ${machine.ipAddress ?? ''}`,
          run: () => {
            void api.stopMachine(machine.id).catch((error: Error) => push(error.message, 'error'));
          },
        },
        {
          label: `Restart machine ${machine.id}`,
          icon: RotateCw,
          keywords: `vm virtual bounce reboot ${machine.os ?? ''}`,
          run: () => {
            void (async () => {
              await api.stopMachine(machine.id);
              await api.startMachine(machine.id);
            })().catch((error: Error) => push(error.message, 'error'));
          },
        },
      ]),

    // Attaching means recreating the container, so this stops at the dialog
    // that says so rather than doing it on the spot.
    ...networks.map((network) => ({
      label: `Attach a container to ${network.name}`,
      icon: Plug,
      keywords: 'connect join',
      run: () => navigateWith({ name: 'network', network: network.name }, 'network.attach'),
    })),

    // One per attachment that exists, rather than every container against every
    // network: the pairs that are real are the only ones worth listing.
    ...withoutHidden(containers, showBuilder).flatMap((container) =>
      (container.networks ?? []).map((name) => ({
        label: `Detach ${container.name} from ${name}`,
        icon: Unplug,
        keywords: 'disconnect leave remove',
        run: () => navigateWith({ name: 'network', network: name }, 'network.detach', container.id),
      }))
    ),
  ];

  const verbHits = verbs.filter((verb) => matches(verb.label, verb.keywords));
  if (verbHits.length > 0) {
    groups.push({
      label: 'Actions',
      results: verbHits.map((verb) => ({
        key: verb.label,
        icon: verb.icon,
        tone: 'text-brand-600 dark:text-brand-400',
        title: verb.label,
        sub: '',
        meta: '',
        measure: '',
        state: null,
        open: verb.run,
      })),
    });
  }

  // Hidden means hidden: the builder is left out of the lists when it is
  // switched off, and a search that hands it back has not hidden it.
  //
  // The project in force is the same kind of hiding, and gets the same answer.
  // A search that reaches across every project would be the one place in the
  // window where the point of view does not hold -- and the place it matters
  // most, because a name found here is a name about to be acted on.
  const containerHits = withoutHidden(containers, showBuilder).filter(
    (c) => inProject(c, activeProject) && matches(c.name, c.image, c.id)
  );
  if (containerHits.length > 0) {
    groups.push({
      label: 'Containers',
      results: containerHits.map((container) => ({
        key: container.id,
        icon: Boxes,
        tone:
          container.status === 'running'
            ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-ink-400',
        title: container.name,
        sub: container.id,
        meta: shortImage(container.image),
        measure:
          container.status === 'running' && container.memoryUsage
            ? formatMemory(container.memoryUsage)
            : '—',
        state: <StatusText status={container.status} />,
        open: () => openContainer(container.id),
      })),
    });
  }

  const imageHits = images.filter(
    (i) => builtInProject([i.project], activeProject) && matches(i.reference, i.name, i.tag, i.digest)
  );
  if (imageHits.length > 0) {
    groups.push({
      label: 'Images',
      results: imageHits.map((image) => {
        const inUse = containers.some((container) => container.image === image.reference);

        return {
          key: image.reference,
          icon: Layers,
          tone: 'text-brand-600 dark:text-brand-400',
          title: `${image.name}:${image.tag}`,
          sub: image.digest,
          meta: image.platforms.join(', ') || '—',
          measure: formatBytes(image.sizeInBytes),
          state: (
            <span
              className={`text-tiny font-medium ${
                inUse ? 'text-emerald-700 dark:text-emerald-500' : 'text-ink-500'
              }`}
            >
              {inUse ? 'in use' : 'unused'}
            </span>
          ),
          open: () => openImage(image.reference),
        };
      }),
    });
  }

  const volumeHits = volumes.filter(
    (v) => filedInProject(v.project, activeProject) && matches(v.name, v.source, v.driver)
  );
  if (volumeHits.length > 0) {
    groups.push({
      label: 'Volumes',
      results: volumeHits.map((volume) => ({
        key: volume.name,
        icon: Database,
        tone: 'text-ink-600 dark:text-ink-300',
        title: volume.name,
        sub: volume.source,
        meta: `driver ${volume.driver}`,
        measure: formatBytes(volume.usedBytes),
        state: (
          <span
            className={`text-tiny font-medium ${
              volume.usedBy.length > 0 ? 'text-emerald-700 dark:text-emerald-500' : 'text-ink-500'
            }`}
          >
            {volume.usedBy.length > 0 ? `${volume.usedBy.length} using` : 'unused'}
          </span>
        ),
        open: () => openVolume(volume.name),
      })),
    });
  }

  const networkHits = networks.filter(
    (n) => networkInProject(n, containers, activeProject) && matches(n.name, n.ipv4Subnet, n.mode)
  );
  if (networkHits.length > 0) {
    groups.push({
      label: 'Networks',
      results: networkHits.map((network) => ({
        key: network.name,
        icon: Network,
        tone: 'text-ink-500',
        title: network.name,
        sub: network.ipv4Subnet ?? '—',
        meta: `${network.mode}${network.builtin ? ' · built in' : ''}`,
        measure: `${network.usedBy.length} attached`,
        state: (
          <span
            className={`text-tiny font-medium ${
              network.usedBy.length > 0 ? 'text-emerald-700 dark:text-emerald-500' : 'text-ink-500'
            }`}
          >
            {network.usedBy.length > 0 ? 'active' : 'idle'}
          </span>
        ),
        open: () => openNetwork(network.name),
      })),
    });
  }

  // The hostnames this Mac answers on. Searched by the name, by what is behind
  // it, and by the domain -- half the point of a route is that you remember the
  // hostname and not which container it was.
  const routeHits = tunnels
    .flatMap((tunnel) => tunnel.routes)
    .filter((r) => matches(r.hostname, r.target, r.zoneName, r.port));

  if (routeHits.length > 0) {
    groups.push({
      label: 'Tunnels',
      results: routeHits.map((route) => ({
        key: route.hostname,
        icon: Globe,
        tone:
          route.status === 'running' ? 'text-emerald-600 dark:text-emerald-500' : 'text-ink-400',
        title: route.hostname,
        sub: route.kind === 'host' ? `this Mac:${route.port}` : `${route.target}:${route.port}`,
        meta: route.zoneName,
        measure: route.reachable ? 'reachable' : 'unreachable',
        state: (
          <span
            className={`text-tiny font-medium ${
              route.status === 'running' ? 'text-emerald-700 dark:text-emerald-500' : 'text-ink-500'
            }`}
          >
            {route.status === 'running' ? 'serving' : 'stopped'}
          </span>
        ),
        // Straight to the hostname, which is what somebody who typed it wants.
        open: () => void openExternal(route.url ?? `https://${route.hostname}`),
      })),
    });
  }

  const machineHits = machines.filter((m) => matches(m.id, m.ipAddress, m.os));
  if (machineHits.length > 0) {
    groups.push({
      label: 'Machines',
      results: machineHits.map((machine) => ({
        key: machine.id,
        icon: Server,
        tone:
          machine.status === 'running' ? 'text-emerald-600 dark:text-emerald-500' : 'text-ink-400',
        title: machine.id,
        sub: machine.ipAddress ?? '—',
        meta: `${machine.cpus} vCPU · ${formatMemory(machine.memoryAllocation)}`,
        measure: formatBytes(machine.diskSizeBytes),
        state: <StatusText status={machine.status} />,
        open: () => openMachine(machine.id),
      })),
    });
  }

  const pageHits = PAGES.filter((page) => matches(page.label, page.keywords));
  if (pageHits.length > 0) {
    groups.push({
      label: 'Go to',
      results: pageHits.map((page) => ({
        key: `go:${page.label}`,
        icon: page.icon,
        tone: 'text-ink-500',
        title: page.label,
        sub: '',
        meta: '',
        measure: '',
        state: null,
        open: () => navigate(page.route),
      })),
    });
  }

  const total = groups.reduce((sum, group) => sum + group.results.length, 0);

  // The groups read down the page in one order, so the keys move through them
  // as one list: down from the last container is the first image, not nothing.
  const ordered = groups.flatMap((group) => group.results);
  const active = Math.min(cursor, Math.max(0, ordered.length - 1));

  // Keep the keyed row on screen. "nearest" so it scrolls only when it has to:
  // centring every step would move the whole list under a cursor that has gone
  // down by one.
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Bound to the window, not to the list: the cursor is in the title bar's
  // field the whole time -- that is where the query is being typed -- so the
  // keys have to be caught above whatever has focus. Arrows are taken from the
  // field deliberately; moving the caret through a word nobody is editing is
  // not what pressing down means with a page of results open.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const at = pointer.current;
      if (event.clientX === at.x && event.clientY === at.y) return;

      pointer.current = { x: event.clientX, y: event.clientY, live: true };
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    if (ordered.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        // The keys have it until the mouse is moved again, not merely until
        // the mouse is passed over: the row is about to move under it.
        pointer.current.live = false;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // Wraps, so holding one key walks the whole list either way rather
        // than stopping silently at an end nobody can see.
        setPick({ query, at: (cursor + step + ordered.length) % ordered.length });
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        ordered[active]?.open?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ordered, active, cursor, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={`Results for “${query}”`}
        subtitle={
          total === 0
            ? 'Nothing matched'
            : `${total} result${total === 1 ? '' : 's'} across ${groups.length} resource type${
                groups.length === 1 ? '' : 's'
              }`
        }
        actions={
          <button onClick={() => setGlobalQuery('')} className="btn-ghost">
            Clear search
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {total === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-16 text-center">
            <div className="flex h-13 w-13 items-center justify-center rounded-2xl border border-brand-200 bg-brand-50 dark:border-brand-600/30 dark:bg-brand-600/10">
              <SearchX size={22} className="text-brand-600 dark:text-brand-400" aria-hidden />
            </div>
            <p className="text-base font-semibold">Nothing matches “{query}”</p>
            <p className="max-w-sm text-body text-ink-600 dark:text-ink-400">
              Search looks at what you can do — pull, build, create — and at container names, images
              and IDs, image references and digests, volume names and mount points, network names
              and subnets, and machine names.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.label}>
                {/* The rule runs from the count to the right edge, which is what
                    keeps a heading a heading when the thing under it is a stack
                    of bordered rows rather than a table. */}
                <div className="flex items-center gap-2.5 pb-2.5">
                  <h2 className="label-mono">{group.label}</h2>
                  <span className="label-mono text-ink-400 normal-case">
                    {group.results.length} match{group.results.length === 1 ? '' : 'es'}
                  </span>
                  <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden />
                </div>

                <ul className="flex flex-col gap-1.5">
                  {group.results.map((result) => {
                    const current = ordered[active] === result;

                    return (
                      <li key={result.key}>
                        <button
                          ref={current ? currentRow : undefined}
                          onClick={result.open}
                          onMouseEnter={() => {
                            // Only a mouse that got here by moving. One that
                            // had a row delivered to it by the arrow keys is
                            // not pointing at anything.
                            if (!pointer.current.live) return;
                            setPick({ query, at: ordered.indexOf(result) });
                          }}
                          aria-current={current ? 'true' : undefined}
                          className={`grid w-full grid-cols-[16px_minmax(0,1.7fr)_minmax(0,1.5fr)_110px_auto] items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                            current
                              ? 'border-brand-600/40 bg-brand-50 dark:border-brand-600/40 dark:bg-brand-600/10'
                              : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700'
                          }`}
                        >
                          <result.icon size={15} className={result.tone} aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate text-body font-medium">
                              {result.title}
                            </span>
                            {result.sub && (
                              <span className="block truncate font-mono text-tiny text-ink-500">
                                {result.sub}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 truncate font-mono text-code text-ink-600 dark:text-ink-400">
                            {result.meta}
                          </span>
                          <span className="truncate font-mono text-xs">{result.measure}</span>
                          {result.state}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
