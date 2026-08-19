# Menu bar icons

The source of the two template images in `desktop/electron/icons`. They ship as
PNG because macOS wants `@1x`/`@2x` template images; these SVGs are what they
were drawn from, kept out of the bundle.

Regenerate after editing:

```bash
rsvg-convert -w 16 -h 16 assets/tray/tray.svg -o desktop/electron/icons/trayTemplate.png
rsvg-convert -w 32 -h 32 assets/tray/tray.svg -o desktop/electron/icons/trayTemplate@2x.png
rsvg-convert -w 16 -h 16 assets/tray/tray-stopped.svg -o desktop/electron/icons/trayStoppedTemplate.png
rsvg-convert -w 32 -h 32 assets/tray/tray-stopped.svg -o desktop/electron/icons/trayStoppedTemplate@2x.png
```

Both are black on transparent: a template image is a mask, so a white shape
inside it is not a gap but part of the mark. The container's ribs are cut out
of the shape rather than drawn over it, which is why it reads at 16pt.
