import {
  Activity,
  ArrowDownToLine,
  BellRing,
  Boxes,
  CloudUpload,
  Command,
  FileDown,
  FolderTree,
  Hammer,
  Keyboard,
  Pencil,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUIStore } from '../store/uiStore';

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command palette'],
  ['⌘F', 'Focus search'],
  ['Esc', 'Clear search, or close the palette'],
  ['⌘,', 'Open settings'],
];

export function HelpView({ version }: { version: string }) {
  const navigate = useUIStore((s) => s.navigate);

  return (
    <div className="-mr-5 min-h-0 flex-1 overflow-y-auto pr-5">
      {/* Centred so a wide window reads as a document, not a left-aligned strip. */}
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <header>
          <h1 className="text-xl font-semibold">Help</h1>
          <p className="text-tiny text-ink-600 dark:text-ink-400">
            Dermaga v{version} · a UI over Apple&rsquo;s{' '}
            <code className="font-mono">container</code> CLI · MIT licensed
          </p>
        </header>

        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          <Card icon={Boxes} title="What you can manage">
            <p>
              Containers, the images they run, volumes and networks they attach to, the machines
              hosting them, and the background services themselves. Every action shells out to the
              CLI, so anything you do here is visible to{' '}
              <code className="font-mono">container ls</code> and the other way round.
            </p>
          </Card>

          <Card icon={Radio} title="Everything is live">
            <p>
              No refresh button and no polling. The server holds an event stream open and pushes new
              state the instant anything changes — including changes you make in a terminal. Logs
              and pull progress stream the same way.
            </p>
          </Card>

          <Card icon={Terminal} title="Terminal tab">
            <p>
              Each running container gets a real shell: the server attaches{' '}
              <code className="font-mono">container exec</code> to a pty, so you get a prompt, line
              editing, colours and resize. It prefers <code className="font-mono">bash</code> and
              falls back to <code className="font-mono">sh</code>. <strong>Run as</strong> opens it
              as the image&rsquo;s own user, as root, or as anyone else.
            </p>
          </Card>

          <Card icon={Pencil} title="Editing recreates">
            <p>
              Apple&rsquo;s CLI has no update command, so saving the edit form stops, deletes and
              re-runs the container with the new spec. Named volumes survive; the container
              filesystem does not. A failed change rolls back to the previous container. Environment
              variables can be edited as fields or pasted in as{' '}
              <code className="font-mono">.env</code> text.
            </p>
          </Card>

          <Card icon={Server} title="When nothing works">
            <p>
              Check <strong>System</strong>. If the container services are stopped, nothing can
              start until they are back up — you can start them there, watch their logs, and reclaim
              disk space from unused images, containers and volumes.
            </p>
          </Card>

          <Card icon={ShieldCheck} title="Vulnerabilities">
            <p>
              Images are scanned in the background as they appear, so the counts are usually waiting
              by the time you open one. Results are kept between launches and refreshed when the
              vulnerability database changes, when a tag moves to a new digest, or after a week.
              Everything runs on this Mac; nothing about your images leaves it.
            </p>
          </Card>

          <Card icon={Hammer} title="Building images">
            <p>
              <strong>Build</strong> on the Images page takes a context folder, a tag and the usual
              build arguments. Progress appears as a row in the list rather than a log window, and
              the builder container is started for you the first time.
            </p>
          </Card>

          <Card icon={FileDown} title="Images as files">
            <p>
              <strong>Save</strong> — on an image&rsquo;s page, or on its row in the list — writes
              it out as an OCI archive, and <strong>Load</strong> on the Images page reads one back
              in — how to move an image to a Mac with no registry between them. An archive holds a
              single platform, so one is chosen when the image has more than one; only the variants
              actually pulled here can be written out.
            </p>
          </Card>

          <Card icon={Activity} title="What a container is doing">
            <p>
              A container&rsquo;s <strong>Usage</strong> tab draws CPU, memory, network and disk as
              they happen — a reading every five seconds, over the last two minutes. The shape is
              what a live number cannot show: memory that climbs and never falls is a leak, a burst
              of traffic every thirty seconds is a health check rather than a user. Dermaga keeps
              that window in memory while it runs, so the tab opens on a chart that is already drawn
              — and forgets it when it quits.
            </p>
          </Card>

          <Card icon={ArrowDownToLine} title="Staying current">
            <p>
              The bottom-right corner says which version is running, and speaks up when a newer one
              exists: one click downloads it, opens the installer and closes Dermaga so it can be
              replaced. Click the version itself for{' '}
              <button
                onClick={() => navigate({ name: 'changelog' })}
                className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                what changed in each release
              </button>
              . <strong>No Linux kernel</strong> there means containers cannot run at all -- Dermaga
              installs one on first launch, and if that could not finish the warning stays, with the
              command to run by hand.
            </p>
          </Card>

          <Card icon={FolderTree} title="Files in a container">
            <p>
              The <strong>Files</strong> tab browses a running container and moves things both ways:
              drop from Finder to copy in, drag a file out to take it. Browsing runs{' '}
              <code className="font-mono">ls</code> inside the container, so an image built from
              scratch has nothing to browse with and says so.
            </p>
          </Card>

          <Card icon={CloudUpload} title="Registries">
            <p>
              Sign in under <strong>Registries</strong>, then push from an image&rsquo;s page; it is
              tagged for the destination first if the name differs. Credentials go to Apple&rsquo;s
              CLI over stdin and are never held here. A registry on this machine has no TLS, so{' '}
              <strong>Plain HTTP</strong> is set for you when the address is local.
            </p>
          </Card>

          <Card icon={BellRing} title="When a container dies">
            <p>
              A container that stops without being asked to is reported — in the window, and as a
              sound when the window is not what you are looking at. A stop you asked for stays
              quiet. macOS notifications need an app signed with a Developer ID, so on these builds
              they are attempted but rarely arrive; nothing is lost when they do not.
            </p>
          </Card>

          <Card icon={Command} title="Finding anything">
            <p>
              <strong>⌘K</strong> opens the command palette: type a few letters of a container,
              image, machine or page and press Return. It also does things rather than only pointing
              at them — <strong>Create container</strong>, <strong>Pull image</strong>,{' '}
              <strong>Build image</strong> and the rest land on the right page with the form already
              open, and a container can be started or stopped without finding its row.{' '}
              <strong>⌘F</strong> is still the search box on the page you are on.
            </p>
          </Card>

          <Card icon={Keyboard} title="Keyboard">
            <dl className="flex flex-col gap-1">
              {SHORTCUTS.map(([keys, description]) => (
                <div key={keys} className="row">
                  <dt className="row-key font-mono text-xs">{keys}</dt>
                  <dd className="row-value">{description}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Unboxed group, matching the detail pages: a ruled heading and its content. */
function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 [&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-ink-600 dark:[&_p]:text-ink-400">
      <div className="flex items-center gap-2 border-b border-ink-200 pb-1 dark:border-ink-700">
        <Icon size={12} className="text-brand-600" aria-hidden />
        <h2 className="label-caps">{title}</h2>
      </div>
      {children}
    </section>
  );
}
