# Worth knowing

Behaviour that surprises people, and why it works the way it does. None of it is a bug; all of it is
easier to meet here than in the middle of something.

## Starting with Dermaga means with Dermaga

A marked container comes up when the agent starts — when you open the app, or at login if the
background service is on. It is not a restart policy: nothing watches a container that dies later,
because without the service there is nothing running to watch it, and a promise that only half holds
is worse than none.

## Browsing a container needs a shell in it

Apple's CLI cannot read a container's filesystem, so Dermaga runs `ls` inside the container and reads
what it prints. An image built `FROM scratch` has no `ls`, and says so rather than pretending to be
empty.

## A volume opens without a network

Reading a volume that no container has mounted means starting a small helper container, and
`container run` fetches its image when it is missing — which would put a registry between you and
your own data. Dermaga keeps its own copy as an OCI archive in `~/.dermaga/helper-image.tar` and
loads that back when the image is gone. The copy is refreshed once a week, and left exactly as it is
whenever the registry cannot be reached.

## Local registries speak plain HTTP

A registry on this machine has no TLS, and the CLI told to use HTTPS anyway fails with
`-9836: bad protocol version` — sometimes after a push has reached 100%. Pull, push and login default
to plain HTTP for `localhost` and friends; the checkbox is there to disagree with.

## Scanning is ambient, and cached

Images are scanned when they appear, not when you ask, so the answer is usually waiting by the time
you open one. Results live in `~/.dermaga/dermaga.db` and are rescanned when the vulnerability
database turns over, when Trivy is upgraded, when a tag moves to a different digest, or after twelve
hours — whichever comes first. Tags sharing a digest share one scan. Results for images you have
deleted are cleared automatically; nothing else is.

See [scanning.md](scanning.md) for the whole of it.

## A pull is not finished when the image appears

The runtime registers an image while its layers are still unpacking, and scanning it then finds an
image that is not all there — which reads as "no vulnerabilities". Sweeps wait for changes to settle,
and any result that found nothing is checked again before it is believed.

## Editing a container recreates it

Apple's CLI has no `update` verb, so saving the edit form stops, deletes and re-runs the container
with the new spec. Named volumes survive; the container filesystem does not, and the form says so
before you commit. If the new spec fails to start, the previous container is restored — and what you
typed is kept, so a failed edit can be picked up where it left off rather than typed again.

## Deleting an image removes every tag pointing at it

References that share a digest are one image, and removing a single tag would leave the bytes on disk
under another name.

## Machines and containers are separate

Containers run inside a Linux VM ("machine"). If nothing starts, check **System** — without the
background services running, nothing else can work, and Dermaga replaces its whole window with a
button to start them.

## The CLI updates from inside the app

System shows the installed `container` version and offers an update when Homebrew has a newer one.
The check reads Homebrew's local index rather than running `brew update`, so it costs nothing and
never mutates your Homebrew state on its own. A CLI installed from Apple's `.pkg` is left alone —
upgrading that means an installer asking for a password.

## Notifications need a signed build

macOS only delivers notifications from an app signed with a Developer ID. Release builds are; a build
you made yourself is not, so on those they are attempted and rarely arrive. Nothing is lost when they
do not — the window and the sound still say it.
