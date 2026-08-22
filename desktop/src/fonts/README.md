# IBM Plex

The two faces the interface is drawn in, vendored rather than fetched: the app
runs from `file://` with no network, so a webfont has to ship inside it.

Only the Latin subsets are here. Plex covers Cyrillic, Greek and Latin Extended
as well, and carrying them would more than treble the weight for glyphs no part
of this interface renders.

| File | Face | Source |
| --- | --- | --- |
| `ibm-plex-sans-latin-wght-normal.woff2` | IBM Plex Sans, variable 100–700 | `@fontsource-variable/ibm-plex-sans@5.3.0` |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono, regular | `@fontsource/ibm-plex-mono@5.3.0` |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono, medium | `@fontsource/ibm-plex-mono@5.3.0` |

To refresh them, install those packages, copy the files named above out of their
`files/` directories, then uninstall the packages again.

Licensed under the SIL Open Font License 1.1; see `LICENSE`.
