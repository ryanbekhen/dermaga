import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen } from 'lucide-react';
import { IconButton } from './Button';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import { DEFAULT_PROJECT } from '../utils/projects';
import type { Container } from '../types';

/**
 * Which project a container is filed under, from the row of things a container
 * is opened to do.
 *
 * Filing, and only filing. It decides which lists this container appears in and
 * nothing else: it is not stopped, not recreated, and not renamed.
 *
 * That last one was tried and taken back out. A container's name and its
 * network are settled when it is made -- this runtime renames nothing -- so
 * "moving" one properly meant destroying and rebuilding it, and every awkward
 * state the feature had came from that: half-moved containers, names saying one
 * project while the record said another, volumes left behind under old names.
 * Compose has no move either, and for the same reason: a service belongs to the
 * project it was brought up in.
 *
 * So the prefix means *born here*, not *belongs here*. A container made in
 * `linxpay` is `linxpay-whoami` on `linxpay-default`; an older one filed into
 * `linxpay` keeps the name and the network it has always had. Those two facts
 * differ, and that is not a mismatch to be resolved -- it is true.
 */
export function ProjectMenu({ container, disabled }: { container: Container; disabled?: boolean }) {
  const projects = useResourceStore((s) => s.projects);
  const pushToast = useToastStore((s) => s.push);

  const [open, setOpen] = useState(false);
  const [filing, setFiling] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filed = container.project?.trim() || DEFAULT_PROJECT;

  // No question asked before it. Nothing is destroyed, nothing stops, and the
  // way back is the same two clicks that got here -- a dialog guarding that is
  // a dialog people learn to dismiss without reading, which is how the ones
  // that matter stop working.
  const file = async (project: string) => {
    setOpen(false);
    setFiling(true);

    try {
      await api.setProject(container.id, project);
      pushToast(`${container.name} is filed under ${project}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not file that', 'error');
    } finally {
      setFiling(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <IconButton
        icon={FolderOpen}
        busy={filing}
        disabled={disabled}
        title={`In ${filed} — press to file it elsewhere`}
        aria-label={`In ${filed}. File under another project`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      />

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-60 rounded-xl border border-ink-200 bg-white p-1.5 shadow-panel dark:border-ink-800 dark:bg-ink-900"
        >
          <div className="label-mono px-2.5 pb-1.5 pt-1">File under</div>
          {[DEFAULT_PROJECT, ...projects.map((project) => project.name)].map((name) => (
            <button
              key={name}
              onClick={() => {
                if (name === filed) setOpen(false);
                else void file(name);
              }}
              className={`flex h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-item transition-colors ${
                name === filed
                  ? 'font-medium text-brand-700 dark:text-brand-400'
                  : 'text-ink-700 hover:bg-ink-150 dark:text-ink-300 dark:hover:bg-ink-800'
              }`}
            >
              <FolderOpen size={15} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">{name}</span>
              {name === filed && <Check size={13} className="shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
