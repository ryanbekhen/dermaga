# Security

## Reporting a vulnerability

Please report it privately, through GitHub's
[private vulnerability reporting](https://github.com/ryanbekhen/dermaga/security/advisories/new)
rather than as a public issue. That way it can be fixed and released before it
is described in public.

Say what you found, how to reach it, and which version — **Settings → About**
has it. A first reply should come within a few days.

## What is worth reporting

Dermaga runs Apple's `container` CLI as you, on your machine, and its own agent
listens on a socket in your home directory. So the things worth looking at are
the ones where that boundary could be crossed:

- **The update mechanism.** Dermaga replaces itself with a downloaded build
  after checking its signature, its team identifier and its notarization. A way
  past those checks would mean arbitrary code arriving as an update.
- **The agent socket.** `~/.dermaga/agent.sock` is created for the current user
  only. Anything reachable through it that should not be, or a way for another
  user to reach it, is a finding.
- **Command construction.** Everything eventually becomes an argument to a CLI.
  A container name, an image reference or a volume owner that escapes into a
  shell rather than staying an argument is a finding.
- **Credentials.** Registry passwords go to Apple's CLI on stdin and are never
  written down here. Somewhere they end up anyway is a finding.

## What is not in scope

Apple's `container` runtime, Homebrew and Trivy are separate projects with
their own reporting. A vulnerability in the images you scan is what Dermaga is
for; report those to whoever publishes the image.

## What Dermaga already does

- It opens no ports. The app and its agent speak over a Unix socket in your
  home directory, created with permissions for you alone.
- Releases are signed with an Apple Developer ID and notarized by Apple. The
  app and the disk image are both stapled, so a Mac with no network can still
  verify them.
- An update is only installed in place after its signature verifies, its team
  matches the running copy, and Gatekeeper accepts it. Anything short of that
  falls back to opening the disk image and letting you decide.
- Nothing about your containers, images or scan results is sent anywhere. The
  only things fetched are the app's own updates, and the CLI and scanner it
  installs through Homebrew.

## Supported versions

The latest release. Fixes go into the next one rather than into patches of
older versions.
