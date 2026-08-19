import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  CircleHelp,
  CloudUpload,
  Cpu,
  Database,
  Download,
  FileUp,
  Hammer,
  Layers,
  Network,
  Play,
  Plug,
  Plus,
  Scale,
  Search,
  Server,
  Settings,
  Square,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import { loadImage } from './ImageArchive';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import { shortImage } from '../utils/format';

interface Command {
  id: string;
  label: string;
  /** What distinguishes two commands with the same name, e.g. an image tag. */
  detail?: string;
  section: string;
  icon: LucideIcon;
  run: () => void;
}

/**
 * Everything the app can reach, in one list, found by typing.
 *
 * The sidebar is fine for seven pages, but a container is three clicks and a
 * scroll away once there are thirty of them -- and a name is what the user
 * already knows. Matching is a plain substring: fuzzy matching sounds clever
 * and mostly produces results nobody asked for.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const containers = useResourceStore((s) => s.containers);
  const images = useResourceStore((s) => s.images);
  const machines = useResourceStore((s) => s.machines);
  const networks = useResourceStore((s) => s.networks);
  const navigate = useUIStore((s) => s.navigate);
  const navigateWith = useUIStore((s) => s.navigateWith);
  const openContainer = useUIStore((s) => s.openContainer);
  const openImage = useUIStore((s) => s.openImage);
  const openMachine = useUIStore((s) => s.openMachine);
  const openNetwork = useUIStore((s) => s.openNetwork);
  const pushToast = useToastStore((s) => s.push);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (label: string, icon: LucideIcon, route: Parameters<typeof navigate>[0]) => ({
      id: `go:${label}`,
      label,
      section: 'Go to',
      icon,
      run: () => navigate(route),
    });

    return [
      // The point of a palette is doing the thing, not being shown where the
      // button for it lives -- so these land on the page with the form open.
      {
        id: 'new:container',
        label: 'Create container',
        section: 'Create',
        icon: Plus,
        run: () => navigateWith({ name: 'containers' }, 'container.create'),
      },
      {
        id: 'new:pull',
        label: 'Pull image',
        section: 'Create',
        icon: Download,
        run: () => navigateWith({ name: 'images' }, 'image.pull'),
      },
      {
        id: 'new:build',
        label: 'Build image from a Dockerfile',
        section: 'Create',
        icon: Hammer,
        run: () => navigateWith({ name: 'images' }, 'image.build'),
      },
      {
        id: 'new:load',
        label: 'Load image from a file',
        section: 'Create',
        icon: FileUp,
        run: () => {
          // No form to open: the file chooser is the whole interaction, and
          // Images is where its progress will appear.
          navigate({ name: 'images' });
          void loadImage();
        },
      },
      {
        id: 'new:volume',
        label: 'Create volume',
        section: 'Create',
        icon: Database,
        run: () => navigateWith({ name: 'volumes' }, 'volume.create'),
      },
      {
        id: 'new:network',
        label: 'Create network',
        section: 'Create',
        icon: Network,
        run: () => navigateWith({ name: 'networks' }, 'network.create'),
      },
      {
        id: 'new:machine',
        label: 'Create machine',
        section: 'Create',
        icon: Server,
        run: () => navigateWith({ name: 'machines' }, 'machine.create'),
      },
      {
        id: 'new:registry',
        label: 'Sign in to a registry',
        section: 'Create',
        icon: CloudUpload,
        run: () => navigateWith({ name: 'registries' }, 'registry.add'),
      },

      go('Containers', Boxes, { name: 'containers' }),
      go('Images', Layers, { name: 'images' }),
      go('Volumes', Database, { name: 'volumes' }),
      go('Networks', Network, { name: 'networks' }),
      go('Registries', CloudUpload, { name: 'registries' }),
      go('Machines', Server, { name: 'machines' }),
      go('System', Cpu, { name: 'system' }),
      go('Settings', Settings, { name: 'settings' }),
      go('Help', CircleHelp, { name: 'help' }),
      go('Licences', Scale, { name: 'licences' }),

      ...containers.map((container) => ({
        id: `container:${container.id}`,
        label: container.name,
        detail: shortImage(container.image),
        section: 'Containers',
        icon: Boxes,
        run: () => openContainer(container.id),
      })),

      // Start and stop are here as well as on the page: the whole point is not
      // having to find the row first.
      ...containers
        .filter((container) => container.status !== 'running')
        .map((container) => ({
          id: `start:${container.id}`,
          label: `Start ${container.name}`,
          section: 'Actions',
          icon: Play,
          run: () => {
            void api
              .startContainer(container.id)
              .catch((error: Error) => pushToast(error.message, 'error'));
          },
        })),

      ...containers
        .filter((container) => container.status === 'running')
        .map((container) => ({
          id: `stop:${container.id}`,
          label: `Stop ${container.name}`,
          section: 'Actions',
          icon: Square,
          run: () => {
            void api
              .stopContainer(container.id)
              .catch((error: Error) => pushToast(error.message, 'error'));
          },
        })),

      // Attaching means recreating the container, so this stops at the dialog
      // that says so rather than doing it on the spot.
      ...networks.map((network) => ({
        id: `attach:${network.name}`,
        label: `Attach a container to ${network.name}`,
        section: 'Actions',
        icon: Plug,
        run: () => navigateWith({ name: 'network', network: network.name }, 'network.attach'),
      })),

      // One per attachment that exists, rather than every container against
      // every network: the pairs that are real are the only ones worth listing.
      ...containers.flatMap((container) =>
        (container.networks ?? []).map((name) => ({
          id: `detach:${container.id}:${name}`,
          label: `Detach ${container.name} from ${name}`,
          section: 'Actions',
          icon: Unplug,
          run: () =>
            navigateWith({ name: 'network', network: name }, 'network.detach', container.id),
        }))
      ),

      ...images.map((image) => ({
        id: `image:${image.reference}`,
        label: image.name,
        detail: image.tag,
        section: 'Images',
        icon: Layers,
        run: () => openImage(image.reference),
      })),

      ...networks.map((network) => ({
        id: `network:${network.name}`,
        label: network.name,
        // The subnet is what tells two networks apart at a glance; the mode
        // stands in for the host-only ones that have no subnet to show.
        detail: network.ipv4Subnet || network.mode || undefined,
        section: 'Networks',
        icon: Network,
        run: () => openNetwork(network.name),
      })),

      // Running an image is the thing people come to an image for, so it is a
      // command in its own right rather than a page to navigate to.
      ...images.map((image) => ({
        id: `run:${image.reference}`,
        // shortImage, not the full reference: "Run alpine:3.20" is what the
        // user would type, "docker.io/library/..." is not.
        label: `Run ${shortImage(image.reference)}`,
        section: 'Actions',
        icon: Play,
        run: () => navigateWith({ name: 'containers' }, 'container.create', image.reference),
      })),

      ...machines.map((machine) => ({
        id: `machine:${machine.id}`,
        label: machine.id,
        detail: machine.default ? 'default' : undefined,
        section: 'Machines',
        icon: Server,
        run: () => openMachine(machine.id),
      })),
    ];
  }, [
    containers,
    images,
    machines,
    networks,
    navigate,
    navigateWith,
    openContainer,
    openImage,
    openMachine,
    openNetwork,
    pushToast,
  ]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      (needle
        ? commands.filter(
            (command) =>
              command.label.toLowerCase().includes(needle) ||
              command.detail?.toLowerCase().includes(needle)
          )
        : commands
      ).slice(0, 50),
    [commands, needle]
  );

  // A stale index would run whatever happened to be at that position.
  const index = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, matches.length]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(index + 1 >= matches.length ? 0 : index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index - 1 < 0 ? matches.length - 1 : index - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(matches[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 p-6 pt-24 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-100 w-full max-w-xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-panel dark:border-ink-700 dark:bg-ink-900"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-ink-200 px-3 dark:border-ink-700">
          <Search size={14} className="shrink-0 text-ink-500" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search containers, images, networks and pages…"
            autoFocus
            className="w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-ink-500 focus-visible:ring-0"
            aria-label="Command"
          />
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-500">Nothing matches that.</p>
          ) : (
            matches.map((command, position) => {
              const first = position === 0 || matches[position - 1].section !== command.section;

              return (
                <div key={command.id}>
                  {first && (
                    <p className="label-caps px-2 pt-2 pb-1 text-ink-500">{command.section}</p>
                  )}
                  <button
                    data-active={position === index}
                    onClick={() => choose(command)}
                    onMouseMove={() => setActive(position)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-0 ${
                      position === index
                        ? 'bg-brand-600/10 font-medium text-ink-900 dark:bg-brand-600/20 dark:text-ink-50'
                        : 'text-ink-800 dark:text-ink-200'
                    }`}
                  >
                    <command.icon
                      size={14}
                      className={`shrink-0 ${
                        position === index ? 'text-brand-600 dark:text-brand-400' : 'text-ink-500'
                      }`}
                      aria-hidden
                    />
                    <span className="truncate">{command.label}</span>
                    {command.detail && (
                      <span className="ml-auto shrink-0 truncate text-xs text-ink-500">
                        {command.detail}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-ink-200 px-3 py-2 text-tiny text-ink-500 dark:border-ink-700">
          <span>
            <span className="font-mono">↑↓</span> to move
          </span>
          <span>
            <span className="font-mono">↵</span> to open
          </span>
          <span>
            <span className="font-mono">esc</span> to close
          </span>
          {matches.length > 0 && (
            <span className="ml-auto">
              {matches.length} result{matches.length === 1 ? '' : 's'}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
