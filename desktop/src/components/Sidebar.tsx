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
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import logo from '@assets/logo.png';
import { useFullScreen } from '../hooks/useFullScreen';
import { useSettingsStore } from '../store/settingsStore';
import { useUIStore } from '../store/uiStore';
import type { Route } from '../types';

interface NavEntry {
  /** Route this entry opens. */
  target: Route;
  /** Route names that keep this entry highlighted, detail pages included. */
  owns: Route['name'][];
  icon: LucideIcon;
  label: string;
}

// Apple's CLI manages containers, the images/volumes/networks they use, the
// machines they run inside, and the services behind all of it.
const PRIMARY_NAV: NavEntry[] = [
  {
    target: { name: 'containers' },
    owns: ['containers', 'container'],
    icon: Boxes,
    label: 'Containers',
  },
  { target: { name: 'images' }, owns: ['images', 'image'], icon: Layers, label: 'Images' },
  { target: { name: 'volumes' }, owns: ['volumes'], icon: Database, label: 'Volumes' },
  { target: { name: 'networks' }, owns: ['networks', 'network'], icon: Network, label: 'Networks' },
  { target: { name: 'registries' }, owns: ['registries'], icon: CloudUpload, label: 'Registries' },
  { target: { name: 'machines' }, owns: ['machines', 'machine'], icon: Server, label: 'Machines' },
  { target: { name: 'system' }, owns: ['system'], icon: Cpu, label: 'System' },
];

const SECONDARY_NAV: NavEntry[] = [
  { target: { name: 'settings' }, owns: ['settings'], icon: Settings, label: 'Settings' },
  { target: { name: 'help' }, owns: ['help'], icon: CircleHelp, label: 'Help' },
  { target: { name: 'licences' }, owns: ['licences'], icon: Scale, label: 'Licences' },
];

export function Sidebar() {
  const route = useUIStore((s) => s.route);
  const navigate = useUIStore((s) => s.navigate);
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const fullScreen = useFullScreen();
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);

  const item = ({ target, owns, icon: Icon, label }: NavEntry) => {
    const active = owns.includes(route.name);

    return (
      <button
        key={label}
        onClick={() => navigate(target)}
        aria-current={active ? 'page' : undefined}
        // The label doubles as the tooltip once collapsed.
        title={collapsed ? label : undefined}
        className={`no-drag flex w-full items-center overflow-hidden rounded-md py-1.5 text-sm transition-all duration-200 ease-out ${
          collapsed ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2.5'
        } ${
          active
            ? 'bg-white/20 font-semibold text-white dark:bg-brand-600'
            : 'text-white/70 hover:bg-white/10 dark:text-ink-400 dark:hover:bg-white/5 dark:hover:text-ink-100'
        }`}
      >
        <Icon size={15} className="shrink-0" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
        <span
          className={`overflow-hidden whitespace-nowrap transition-all duration-200 ease-out ${
            collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100'
          }`}
        >
          {label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className={`drag flex shrink-0 flex-col bg-gradient-to-b from-brand-700 to-brand-900 p-2 text-white transition-[width] duration-200 ease-out dark:from-ink-900 dark:to-ink-950 ${
        collapsed ? 'w-20' : 'w-52'
      }`}
    >
      {/* The traffic lights sit over this strip out of fullscreen, so it
          reserves room for them and stays draggable. */}
      <div
        className={`mb-4 flex items-center transition-all duration-200 ease-out ${
          fullScreen ? 'mt-1' : 'mt-6'
        } ${collapsed ? 'justify-center gap-0' : 'gap-2 px-1.5'}`}
      >
        {/* The mark is red on transparent, so it needs a light tile to sit on --
            the sidebar is brand red in light mode and near-black in dark. */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white p-1">
          <img src={logo} alt="" className="h-full w-full object-contain" />
        </div>
        <span
          className={`overflow-hidden whitespace-nowrap text-sm font-semibold transition-all duration-200 ease-out ${
            collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100'
          }`}
        >
          Dermaga
        </span>
      </div>

      <div className="space-y-0.5">{PRIMARY_NAV.map(item)}</div>

      <div className="mt-auto space-y-0.5 border-t border-white/10 pt-2 dark:border-white/5">
        {SECONDARY_NAV.map(item)}

        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`no-drag flex w-full items-center overflow-hidden rounded-md py-1.5 text-white/50 transition-all duration-200 ease-out hover:bg-white/10 hover:text-white dark:text-ink-500 dark:hover:bg-white/5 dark:hover:text-ink-100 ${
            collapsed ? 'justify-center gap-0 px-0' : 'gap-2.5 px-2.5'
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
      </div>
    </nav>
  );
}
