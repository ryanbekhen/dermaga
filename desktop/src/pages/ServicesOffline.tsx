import { useEffect, useState } from 'react';
import { Download, HardDriveDownload, Play, PlugZap } from 'lucide-react';
import { Button } from '../components/Button';
import { CommandProgress, useCommandProgress } from '../components/CommandProgress';
import { api } from '../services/api';
import { useToastStore } from '../store/toastStore';
import type { ToolchainStatus } from '../types';

/**
 * Takes over the whole page when the container services are down. Every other
 * screen would be empty or broken without them, so the only thing offered is
 * the way out.
 */
export function ServicesOffline({ cliMissing }: { cliMissing: boolean }) {
  const [starting, setStarting] = useState(false);
  const [kernelNeeded, setKernelNeeded] = useState(false);
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null);
  const install = useCommandProgress('toolchain.install');
  const kernel = useCommandProgress('system.installKernel');
  const pushToast = useToastStore((s) => s.push);

  // Only asked for when the CLI is missing, since that is the only case where
  // the answer changes what this screen offers.
  useEffect(() => {
    if (!cliMissing) return;

    void api
      .getToolchain()
      .then(setToolchain)
      .catch(() => {
        // Leave the manual instructions as the fallback.
      });
  }, [cliMissing]);

  const start = async (withKernel = false) => {
    setStarting(true);
    try {
      await api.startSystem(withKernel);
      pushToast('Container services started');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';

      // A fresh install has no Linux kernel, and the runtime refuses to start
      // until one is configured -- telling the user to go and run a CLI command.
      // Offer the button that does it instead of repeating the error.
      if (/kernel/i.test(message)) setKernelNeeded(true);
      else pushToast(message || 'Could not start the services', 'error');
    } finally {
      setStarting(false);
    }
  };

  const heading = cliMissing
    ? 'Apple Container CLI not found'
    : kernelNeeded
      ? 'A Linux kernel is needed'
      : 'Container services are not running';

  // What Dermaga is about to run on your behalf. Shown because it is somebody
  // else's command and this is somebody else's machine: a button that does
  // something to a Mac should be willing to say what.
  const command = cliMissing
    ? toolchain?.brewAvailable
      ? 'brew install container'
      : null
    : kernelNeeded
      ? 'container system kernel set --recommended'
      : 'container system start';

  return (
    // A panel on the ground, like every other surface in the app -- not text
    // floating in the middle of an empty window. It is the only thing on
    // screen, so it is the one place a button keeps its words.
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-ink-200 bg-white px-8 py-9 text-center dark:border-ink-800 dark:bg-ink-900">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600 dark:text-brand-400">
          <PlugZap size={22} aria-hidden />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-title font-semibold">{heading}</h1>

          <p className="text-body leading-relaxed text-ink-600 dark:text-ink-400">
            {kernelNeeded && !cliMissing ? (
              <>
                Containers run on a Linux kernel, and this Mac does not have one yet. Dermaga can
                install the default kernel and start the services — a one-off download of a few
                hundred megabytes.
              </>
            ) : cliMissing ? (
              toolchain?.brewAvailable ? (
                <>
                  Dermaga drives the <code className="font-mono text-code">container</code> command.
                  It can be installed with Homebrew
                  {toolchain.latestVersion ? ` (${toolchain.latestVersion})` : ''} right here.
                </>
              ) : (
                <>
                  Dermaga drives the <code className="font-mono text-code">container</code> command.
                  Install it with Homebrew, or from Apple&rsquo;s container releases, then reopen
                  Dermaga.
                </>
              )
            ) : (
              <>Nothing can run until the background services are up.</>
            )}
          </p>
        </div>

        {cliMissing && toolchain?.brewAvailable && (
          <div className="flex w-full flex-col items-center gap-3">
            <Button
              variant="primary"
              icon={Download}
              busy={install.state === 'running'}
              busyLabel="Installing…"
              onClick={() =>
                void install.run((failed) => {
                  if (!failed) {
                    pushToast('Apple Container CLI installed');
                  }
                })
              }
            >
              Install with Homebrew
            </Button>

            <CommandProgress {...install} />
          </div>
        )}

        {!cliMissing && (
          <div className="flex w-full flex-col items-center gap-3">
            {kernelNeeded ? (
              <Button
                variant="primary"
                icon={HardDriveDownload}
                busy={kernel.state === 'running' || starting}
                busyLabel={starting ? 'Starting…' : 'Downloading kernel…'}
                onClick={() =>
                  void kernel.run((failed) => {
                    // The kernel was the only thing in the way, so carry
                    // straight on rather than making the user press a second
                    // button.
                    if (!failed) void start();
                  })
                }
              >
                Install kernel and start
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={Play}
                busy={starting}
                busyLabel="Starting…"
                onClick={() => void start()}
              >
                Start services
              </Button>
            )}

            <CommandProgress {...kernel} />
          </div>
        )}

        {command && (
          <p className="w-full truncate rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-tiny text-ink-600 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-400">
            {command}
          </p>
        )}
      </div>
    </div>
  );
}
