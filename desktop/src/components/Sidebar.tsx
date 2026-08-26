import { Fragment, type ReactNode } from 'react';
import {
  Boxes,
  ChevronsLeft,
  CircleHelp,
  CloudUpload,
  Scale,
  Cpu,
  Database,
  Layers,
  Network,
  Server,
  Globe,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUnreadChangelog } from '../store/changelogStore';
import { useUIStore } from '../store/uiStore';
import { withoutHidden } from '../utils/builder';
import type { Route } from '../types';

interface NavEntry {
  /** Route this entry opens. */
  target: Route;
  /** Route names that keep this entry highlighted, detail pages included. */
  owns: Route['name'][];
  icon: LucideIcon;
  label: string;
  /** Shown instead of a count, for a page that is still finding its feet. */
  beta?: boolean;
  /** Which store the count beside it comes from, where there is one. */
  count?: 'containers' | 'images' | 'volumes' | 'networks' | 'machines';
}

interface NavGroup {
  /** The mono caps above the group. Absent means no heading. */
  title?: string;
  entries: NavEntry[];
}

// Apple's CLI manages containers, the images/volumes/networks they use, the
// machines they run inside, and the services behind all of it. Grouped so the
// list reads as two questions -- what am I running, and what is it running on
// -- rather than as nine equal destinations.
const NAV: NavGroup[] = [
  {
    title: 'Workspace',
    entries: [
      {
        target: { name: 'containers' },
        // The form that makes one belongs to this section too: a page with
        // nothing lit in the sidebar reads as having left the app.
        owns: ['containers', 'container', 'container-new', 'container-edit', 'templates'],
        icon: Boxes,
        label: 'Containers',
        count: 'containers',
      },
      {
        target: { name: 'images' },
        owns: ['images', 'image', 'image-build'],
        icon: Layers,
        label: 'Images',
        count: 'images',
      },
      {
        target: { name: 'volumes' },
        owns: ['volumes', 'volume'],
        icon: Database,
        label: 'Volumes',
        count: 'volumes',
      },
      {
        target: { name: 'networks' },
        owns: ['networks', 'network'],
        icon: Network,
        label: 'Networks',
        count: 'networks',
      },
      {
        target: { name: 'registries' },
        owns: ['registries'],
        icon: CloudUpload,
        label: 'Registries',
      },
      {
        target: { name: 'tunnels' },
        owns: ['tunnels', 'tunnel-route'],
        icon: Globe,
        label: 'Tunnels',
        beta: true,
      },
      {
        target: { name: 'machines' },
        owns: ['machines', 'machine', 'machine-new'],
        icon: Server,
        label: 'Machines',
        count: 'machines',
      },
    ],
  },
  {
    title: 'Host',
    entries: [
      { target: { name: 'system' }, owns: ['system'], icon: Cpu, label: 'System' },
      { target: { name: 'settings' }, owns: ['settings'], icon: Settings, label: 'Settings' },
    ],
  },
  {
    title: 'About',
    entries: [
      { target: { name: 'changelog' }, owns: ['changelog'], icon: Sparkles, label: "What's new" },
      { target: { name: 'help' }, owns: ['help'], icon: CircleHelp, label: 'Help' },
      { target: { name: 'licences' }, owns: ['licences'], icon: Scale, label: 'Licences' },
    ],
  },
];

export function Sidebar({ version }: { version?: string }) {
  const route = useUIStore((s) => s.route);
  const navigate = useUIStore((s) => s.navigate);
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const hasUnread = useUnreadChangelog(version);
  const cli = useToolchainMark();
  const counts = useCounts();

  const item = ({ target, owns, icon: Icon, label, count, beta }: NavEntry) => {
    const active = owns.includes(route.name);
    // A menu entry says the notes exist; the dot says there are some the user
    // has not read. It clears the moment the page is opened.
    const unread = target.name === 'changelog' && hasUnread;
    // The same dot on System, in the colour of how much it matters: amber for
    // a newer CLI waiting, the flag red for one too old for Dermaga to be
    // relied on. This one does not clear when the page is opened -- it is not
    // about having read something, it is about the state of the machine, and
    // it goes when that changes.
    const mark = target.name === 'system' ? cli : null;
    const total = count ? counts[count] : undefined;

    return (
      <button
        key={label}
        onClick={() => navigate(target)}
        aria-current={active ? 'page' : undefined}
        // The label doubles as the tooltip once collapsed.
        title={collapsed ? label : undefined}
        // The active entry is filled, not tinted. A tint on a near-black ground
        // is a few percent of light and reads as a smudge; the flag red against
        // it is unmistakable from across the desk.
        className={`no-drag flex h-9.5 w-full items-center overflow-hidden rounded-lg text-item transition-colors ${
          collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-3'
        } ${
          active
            ? 'bg-brand-600 font-medium text-white'
            : 'text-chrome-muted hover:bg-chrome-raised hover:text-chrome-text'
        }`}
      >
        <span className="relative shrink-0">
          <Icon size={16} strokeWidth={active ? 2.1 : 1.7} aria-hidden />
          {(unread || mark) && (
            <span
              className={`absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-chrome-bg ${
                mark?.tone === 'update' ? 'bg-amber-500' : 'bg-brand-500'
              }`}
              aria-hidden
            />
          )}
        </span>
        <span
          className={`flex-1 overflow-hidden whitespace-nowrap text-left transition-all duration-200 ease-out ${
            collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100'
          }`}
        >
          {label}
          {unread && <span className="sr-only"> (unread)</span>}
          {mark && <span className="sr-only"> ({mark.label})</span>}
        </span>
        {/* Counted, not just labelled: the number is what tells you whether a
            page is worth opening, and it is the one thing the sidebar can say
            about a page without being on it. The word "beta" takes the same
            slot, because it answers the same question -- what is this page,
            before you open it. */}
        {!collapsed && total !== undefined && <Meta active={active}>{total}</Meta>}
        {!collapsed && beta && <Meta active={active}>beta</Meta>}
      </button>
    );
  };

  return (
    <nav
      className={`flex shrink-0 flex-col gap-0.5 border-r border-chrome-edge bg-chrome-bg px-2.5 pb-2.5 pt-3.5 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-17' : 'w-58'
      }`}
    >
      {NAV.map((group, index) => (
        <Fragment key={group.title ?? index}>
          {group.title && !collapsed && (
            <div
              className={`label-mono px-2.5 pb-2 text-chrome-faint ${index > 0 ? 'pt-4' : 'pt-1'}`}
            >
              {group.title}
            </div>
          )}
          {/* Collapsed there is no heading to separate the groups, so a rule
              does it instead -- otherwise nine icons run together as one list. */}
          {group.title && collapsed && index > 0 && (
            <div className="mx-2 my-2 border-t border-chrome-line" aria-hidden />
          )}
          {group.entries.map(item)}
          {/* Everything below About is pinned to the bottom. */}
          {index === NAV.length - 2 && <div className="flex-1" />}
        </Fragment>
      ))}

      <button
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={`no-drag mt-1.5 flex h-7 w-full items-center overflow-hidden rounded-lg text-chrome-faint transition-colors hover:bg-chrome-raised hover:text-chrome-text ${
          collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-3'
        }`}
      >
        <ChevronsLeft
          size={15}
          className={`shrink-0 transition-transform duration-200 ease-out ${
            collapsed ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
    </nav>
  );
}

/**
 * What an entry says about its page before it is opened: how many things are
 * on it, or that it is still finding its feet.
 *
 * A badge rather than a figure set in grey. Bare, it was the faintest tone on
 * the frame -- the tone for things the eye is meant to slide past, a
 * placeholder, a caption it has already read -- and a number is not that: it
 * is the whole of what this row says beyond its name, and somebody looks
 * straight at it. The pill gives it an edge to sit against, so it can be quiet
 * without being faint.
 *
 * Tinted with black or white rather than with a colour from the frame's own
 * scale: the row lights up under the pointer, and anything painted in a frame
 * colour would have vanished into that hover. A translucent tint stacks on top
 * of whatever it lands on instead, so the badge keeps its shape on a plain
 * row, a hovered one, and the flag red of the active one -- where it goes
 * white on white rather than taking a colour of its own, because a second
 * colour inside a filled row reads as a second thing in it.
 */
function Meta({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      // Round rather than boxed, and a fixed height rather than padding around
      // a line: a count is a token, not a cell. Boxed, at four different widths
      // down a column, they read as five little buttons; round and all the same
      // height, they read as one kind of thing said five times.
      //
      // The floor on the width is what keeps that true -- single digits are
      // most of what is counted here, and a pill that shrinks to fit one leaves
      // the sidebar's right edge ragged down its whole length.
      className={`inline-flex h-4.5 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-tiny font-medium ${
        active ? 'bg-white/20 text-white' : 'bg-black/5 text-chrome-dim dark:bg-white/10'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The numbers beside the entries. Counted the way each page counts itself, so
 * the sidebar and the page it opens never disagree -- the builder is
 * infrastructure rather than somebody's container, and it is either in both
 * totals or in neither.
 */
/**
 * What the System entry has to say about Apple's CLI before it is opened.
 *
 * Only the two things worth a dot. Everything else the System page knows --
 * which version, how it was installed, whether the check itself failed -- is a
 * reading, and a reading belongs on the page rather than in the frame.
 */
function useToolchainMark(): { tone: 'update' | 'unsupported'; label: string } | null {
  const toolchain = useResourceStore((s) => s.toolchain);

  if (!toolchain) return null;

  if (toolchain.belowMinimum) {
    return { tone: 'unsupported', label: 'the container CLI is too old' };
  }

  if (toolchain.updateAvailable) {
    return { tone: 'update', label: 'a container CLI update is available' };
  }

  return null;
}

function useCounts() {
  const showBuilder = useSettingsStore((s) => s.showBuilder);
  const containers = useResourceStore((s) => s.containers);
  const images = useResourceStore((s) => s.images);
  const volumes = useResourceStore((s) => s.volumes);
  const networks = useResourceStore((s) => s.networks);
  const machines = useResourceStore((s) => s.machines);

  return {
    containers: withoutHidden(containers, showBuilder).length,
    images: images.length,
    volumes: volumes.length,
    networks: networks.length,
    machines: machines.length,
  };
}
