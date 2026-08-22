# Vulnerability scanning

Apple's `container` CLI has no scanner of its own, so Dermaga borrows one: [Trivy][trivy], driven as
a command rather than linked in as a library — embedding it would pull a dependency tree larger than
the rest of this app and add hundreds of megabytes to every release.

Scanning an image means handing it to Trivy as something it can read:

```
container image save <ref> --platform linux/arm64 --output image.tar
tar -xf image.tar -C oci/     # Trivy reads an OCI directory; the CLI writes an OCI tar
trivy image --input oci/ --format json --scanners vuln --skip-db-update
```

The platform is pinned because the local store holds only the architecture that was pulled; asking
for the whole multi-arch index fails on blobs that were never fetched.

**Where the knowledge comes from.** Trivy matches the packages it finds against its own vulnerability
database — around 100 MB, built from the distributions' security trackers and the usual CVE feeds.
Dermaga downloads it once (`trivy image --download-db-only`) and keeps it current on its own
schedule, which is why the scans themselves run with `--skip-db-update`. Trivy stamps each database
with a `NextUpdate` about a day out, so Dermaga checks every six hours: that costs nothing when there
is nothing new — it reads a local file — and picks up a new database within hours of it landing.

**Installing itself.** If Trivy is missing and Homebrew is present, Dermaga installs it with
`brew install trivy` and updates it the same way. Without Homebrew it stays quiet, and the feature is
simply absent rather than nagging.

**When scans happen.** Never while you wait, if it can be helped:

| When              | What                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| at startup        | install or update Trivy, refresh a stale database, scan whatever has no result   |
| an image appears  | scan it, 30 seconds after the image list settles                                 |
| every six hours   | the same as startup                                                             |
| you ask for one   | that image jumps the queue                                                      |

The 30-second wait is not politeness: a pull publishes the image as soon as its manifest lands, while
unpacking the layers can take a minute, and an image scanned in between looks empty — which reads as
"no vulnerabilities". Scans run one at a time, so a Mac full of images warms up gradually rather than
exporting several gigabytes at once. By the time you open an image, the answer is usually already
there.

**What is kept, and for how long.** Results live in `~/.dermaga/dermaga.db`, so closing the app does
not mean rescanning everything on the next launch. A result is taken again when the database turns
over, when Trivy itself is upgraded, or when it is more than twelve hours old, so the counts on screen
always reflect the database in hand. Results for images that no longer exist are cleared on every
pass, and the System page drops stale ones on request.

**What leaves your Mac.** The database download, and nothing else. Images are exported to a temporary
directory, scanned there and deleted; no image, digest or finding is sent anywhere.

[trivy]: https://github.com/aquasecurity/trivy
