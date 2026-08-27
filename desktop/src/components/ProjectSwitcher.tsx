import { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, FolderOpen, FolderPlus, List, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useSettingsStore } from '../store/settingsStore';
import { useActiveProject } from '../hooks/useActiveProject';
import { useToastStore } from '../store/toastStore';
import { ConfirmDialog } from './ConfirmDialog';
import { countIn, DEFAULT_PROJECT, EVERYTHING, projectLabel } from '../utils/projects';

/**
 * Which project the window is looking through.
 *
 * It sits at the head of the sidebar rather than in the title bar, and that is
 * a decision rather than a place it happened to fit. The title bar answers
 * "what is wrong with the machine underneath"; a project is not about the
 * machine, it is the point of view on the work -- and the sidebar is already
 * what scopes the work. Keeping the two apart leaves the title bar free for the
 * thing that will need it: which host these containers are on, where picking
 * wrong has consequences a filter never has.
 *
 * What it never does is act. Switching project changes what is listed and what
 * the create form starts from. Nothing starts, nothing stops. One click that
 * kills somebody's work is not a filter, and this is a filter.
 */
export function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const projects = useResourceStore((s) => s.projects);
  const containers = useResourceStore((s) => s.containers);
  const active = useActiveProject();
  const setActive = useSettingsStore((s) => s.setActiveProject);
  const confirmDestructive = useSettingsStore((s) => s.confirmDestructive);
  const pushToast = useToastStore((s) => s.push);

  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // A project made here, held until the pushed list has it.
  const justMade = useRef<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setNaming(false);
    setName('');
  };

  // A menu that outlives the click that dismissed it is a menu in the way.
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (naming) field.current?.focus();
  }, [naming]);

  // A project that has been deleted elsewhere must not stay as the point of
  // view, or the window narrows to a name nothing is filed under and reads as
  // having lost everything.
  //
  // Except one it has only just made. The list here is whatever the last
  // snapshot said, and a project made a moment ago is not in it yet -- so
  // without this the window opens the new project and is thrown straight back
  // to default by the guard, in the gap before the agent's next push. The name
  // is held until the list catches up, and only then does the ordinary rule
  // apply to it.
  useEffect(() => {
    if (active === EVERYTHING || active === DEFAULT_PROJECT) return;

    if (projects.some((project) => project.name === active)) {
      if (justMade.current === active) justMade.current = null;
      return;
    }

    if (justMade.current === active) return;

    setActive(DEFAULT_PROJECT);
  }, [projects, active, setActive]);

  const choose = (next: string) => {
    setActive(next);
    close();
  };

  const create = async () => {
    const wanted = name.trim();
    if (!wanted) return;

    try {
      const made = await api.createProject(wanted);
      justMade.current = made.name;
      setActive(made.name);
      close();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const remove = async (target: string) => {
    setRemoving(null);

    try {
      await api.removeProject(target);
      if (active === target) setActive(DEFAULT_PROJECT);
      const freed = countIn(containers, target);
      pushToast(
        freed === 0
          ? `${target} removed.`
          : `${target} removed. ${freed} ${freed === 1 ? 'container' : 'containers'} went back to default.`
      );
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const askRemove = (target: string) => {
    if (!confirmDestructive) {
      void remove(target);
      return;
    }

    setRemoving(target);
  };

  const label = projectLabel(active);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        className={`no-drag flex h-9.5 w-full items-center overflow-hidden rounded-lg border transition-colors ${
          collapsed ? 'justify-center gap-0 border-transparent px-0' : 'gap-2.5 px-2.5'
        } ${
          open
            ? 'border-chrome-faint bg-chrome-raised'
            : 'border-chrome-line bg-chrome-raised hover:border-chrome-faint'
        }`}
      >
        {collapsed ? (
          // Collapsed, the name is the only thing that says which point of
          // view this is -- so it stays, as its first letters. A folder glyph
          // here would be the one control on the rail that says nothing.
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-chrome-line bg-chrome-bg font-mono text-tiny font-medium tracking-wide text-chrome-muted">
            {monogram(label)}
          </span>
        ) : (
          <>
            <FolderOpen size={16} className="shrink-0 text-chrome-dim" aria-hidden />
            <span className="flex-1 truncate text-left text-item font-medium text-chrome-text">
              {label}
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-chrome-faint" aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          // Wider than the sidebar it hangs from. A project name has a count
          // and a tick after it, and at the rail's own width the longer names
          // were truncating against furniture rather than against anything the
          // window was short of.
          className="absolute left-0 top-11 z-30 w-72 rounded-xl border border-chrome-line bg-chrome-raised p-1.5 shadow-panel"
        >
          <Row
            icon={<List size={15} aria-hidden />}
            label="All"
            count={containers.length}
            active={active === EVERYTHING}
            onClick={() => choose(EVERYTHING)}
          />

          <div className="my-1.5 h-px bg-chrome-line" />

          <Row
            icon={<FolderOpen size={15} aria-hidden />}
            label={DEFAULT_PROJECT}
            // Said out loud, because it is the one entry that is not a group
            // somebody made: default is what a container with no project is in,
            // and it stays visible whichever project is open.
            note="shared"
            count={countIn(containers, DEFAULT_PROJECT)}
            active={active === DEFAULT_PROJECT}
            onClick={() => choose(DEFAULT_PROJECT)}
          />

          {projects.map((project) => (
            <Row
              key={project.name}
              icon={<FolderOpen size={15} aria-hidden />}
              label={project.name}
              count={countIn(containers, project.name)}
              active={active === project.name}
              onClick={() => choose(project.name)}
              onRemove={() => askRemove(project.name)}
            />
          ))}

          <div className="my-1.5 h-px bg-chrome-line" />

          {naming ? (
            <div className="flex h-8.5 items-center gap-2 rounded-lg border border-chrome-faint bg-chrome-well px-2.5">
              <FolderPlus size={15} className="shrink-0 text-chrome-dim" aria-hidden />
              <input
                ref={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create();
                  if (event.key === 'Escape') setNaming(false);
                }}
                placeholder="Project name"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-item text-chrome-text outline-hidden placeholder:text-chrome-faint"
              />
            </div>
          ) : (
            <button
              onClick={() => setNaming(true)}
              className="flex h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-item text-chrome-muted transition-colors hover:bg-chrome-bg hover:text-chrome-text"
            >
              <FolderPlus size={15} className="shrink-0" aria-hidden />
              New project…
            </button>
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing}?`}
          body={`The containers filed under ${removing} go back to default. Nothing is deleted and nothing stops.`}
          confirmLabel="Remove project"
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** The first letters of a name, for when there is only room for letters. */
function monogram(name: string) {
  return name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toLowerCase() || '··';
}

function Row({
  icon,
  label,
  count,
  note,
  active,
  onClick,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  note?: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`group flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-item transition-colors ${
        active
          ? 'bg-brand-600/15 font-medium text-brand-400'
          : 'text-chrome-muted hover:bg-chrome-bg hover:text-chrome-text'
      }`}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {note && <span className="label-mono shrink-0 text-chrome-faint">{note}</span>}
      </button>

      <span className="inline-flex h-4.5 min-w-6 shrink-0 items-center justify-center rounded-full bg-white/10 px-1.5 font-mono text-tiny font-medium text-chrome-dim">
        {count}
      </span>

      {/* Only on a project somebody made, and only under the pointer: the row
          is there to be picked, and a button that deletes it should not be the
          same size as the one that opens it. */}
      {onRemove ? (
        <button
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
          className="shrink-0 text-chrome-faint opacity-0 transition-opacity hover:text-brand-400 group-hover:opacity-100"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      ) : (
        <span className="w-3.25 shrink-0" aria-hidden />
      )}

      {active ? (
        <Check size={13} className="shrink-0" aria-hidden />
      ) : (
        <span className="w-3.25 shrink-0" aria-hidden />
      )}
    </div>
  );
}
