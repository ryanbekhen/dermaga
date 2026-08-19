'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, writeFile, rm, readFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = promisify(execFile);

const LABEL = 'dev.ryanbekhen.dermaga.agent';
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

/**
 * The Dermaga agent as a launchd service.
 *
 * Without it the agent is the app's child and containers are watched only
 * while a window is open; with it the agent starts at login and keeps
 * watching -- which is what makes a restart policy mean anything. It stays
 * opt-in: a background process nobody asked for is not a feature.
 *
 * Everything here is per-user. It lives in ~/Library/LaunchAgents, runs as the
 * user, and needs no administrator anywhere.
 */

/**
 * launchd starts services with almost no PATH, and the agent is useless
 * without Apple's CLI on it.
 */
const SERVICE_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

function plist(binary, socket) {
  const logFile = path.join(os.homedir(), '.dermaga', 'agent.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${binary}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<!-- Restart it when it fails, but not when it exits cleanly: standing down
	     because another agent already holds the socket is a clean exit, and
	     relaunching it in a loop would be a fight nobody wins. -->
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Background</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${SERVICE_PATH.join(':')}</string>
		<!-- The service belongs to the build that installed it, and listens
		     where that build looks. A development build has its own socket. -->
		<key>DERMAGA_SOCKET</key>
		<string>${socket}</string>
	</dict>
	<key>StandardErrorPath</key>
	<string>${logFile}</string>
</dict>
</plist>
`;
}

const target = () => `gui/${process.getuid()}`;

/** Whether the service is installed, and the binary it points at. */
async function status() {
  try {
    const contents = await readFile(plistPath(), 'utf8');
    const binary = contents.match(/<string>([^<]*dermaga-agent)<\/string>/)?.[1] ?? null;

    return { installed: true, binary };
  } catch {
    return { installed: false, binary: null };
  }
}

/** Polls, because launchd and a process on its way out answer to no promise. */
async function waitFor(condition, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

/**
 * Writes the plist and hands the socket over.
 *
 * The order is the whole of this function. An agent is holding the socket, and
 * a service booted while it is still there dials it, finds it answered and
 * stands down -- cleanly, so launchd leaves it down, and the user is left with
 * a service that is installed and doing nothing. So: ask the holder to let go,
 * wait until it genuinely has, and only then boot the service.
 */
async function install(binary, { socket, releaseSocket }) {
  await mkdir(path.dirname(plistPath()), { recursive: true });
  await mkdir(path.join(os.homedir(), '.dermaga'), { recursive: true });
  await mkdir(path.dirname(socket), { recursive: true });
  await writeFile(plistPath(), plist(binary, socket), 'utf8');

  await releaseSocket?.();
  await waitFor(() => !existsSync(socket));

  // Already loaded from an earlier install: replace it rather than fail.
  await run('launchctl', ['bootout', `${target()}/${LABEL}`]).catch(() => {});
  await run('launchctl', ['bootstrap', target(), plistPath()]);

  // The socket coming back is the proof that the service is really up. A job
  // that stood down once stays down until asked plainly.
  if (!(await waitFor(() => existsSync(socket), 30))) {
    await run('launchctl', ['kickstart', '-k', `${target()}/${LABEL}`]).catch(() => {});
    await waitFor(() => existsSync(socket), 30);
  }

  return status();
}

/** Removes the service. Whatever it started goes with it. */
async function uninstall(socket) {
  await run('launchctl', ['bootout', `${target()}/${LABEL}`]).catch(() => {});
  await rm(plistPath(), { force: true });
  if (socket) await waitFor(() => !existsSync(socket));

  return status();
}

module.exports = { LABEL, install, uninstall, status, plistPath };
