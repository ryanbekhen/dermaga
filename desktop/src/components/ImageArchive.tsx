import { useState } from 'react';
import { Field, Modal } from './form';
import { runTask } from './TaskRows';
import { pickFile, pickSaveFile } from '../services/ipc';

/**
 * Writes an image out as an OCI archive.
 *
 * A platform has to be named: Apple's CLI walks every variant in the index, and
 * an image pulled here holds the layers for this Mac only -- asking for the
 * rest fails with a bare content digest and no explanation.
 */
export async function saveImage(
  reference: string,
  platform: string,
  onSaved?: (path: string) => void
) {
  const [name, tag] = splitReference(reference);
  const output = await pickSaveFile({
    title: `Save ${reference}`,
    defaultName: `${name}-${tag}.tar`,
    extension: 'tar',
  });
  if (!output) return;

  void runTask({
    id: `save:${reference}`,
    kind: 'image',
    label: `Saving ${reference}`,
    method: 'images.save',
    params: { reference, platform, output },
    onDone: (failed) => {
      if (!failed) onSaved?.(output);
    },
  });
}

/**
 * Reads an archive back in, under whatever references it was saved with. The
 * images it contains name themselves; nothing here chooses them.
 */
export async function loadImage() {
  const input = await pickFile({ title: 'Load an image archive', extension: 'tar' });
  if (!input) return;

  void runTask({
    id: `load:${input}`,
    kind: 'image',
    label: `Loading ${input.split('/').pop() ?? input}`,
    method: 'images.load',
    params: { input },
  });
}

/** `ghcr.io/owner/api:dev` names a file `api-dev.tar`, not the whole path. */
function splitReference(reference: string): [string, string] {
  const slash = reference.split('/').pop() ?? reference;
  const colon = slash.lastIndexOf(':');

  return colon === -1 ? [slash, 'latest'] : [slash.slice(0, colon), slash.slice(colon + 1)];
}

/**
 * Which variant to write out, for an image that describes more than one. Only
 * the platforms actually pulled to this Mac have layers on disk, so the choice
 * belongs to the user rather than to a default.
 */
export function SaveImageDialog({
  reference,
  platforms,
  onClose,
  onSaved,
}: {
  reference: string;
  platforms: string[];
  onClose: () => void;
  onSaved?: (path: string) => void;
}) {
  const [platform, setPlatform] = useState(
    platforms.find((p) => p.endsWith('arm64')) ?? platforms[0]
  );

  return (
    <Modal
      title={`Save ${reference}`}
      subtitle="An archive holds one platform."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={() => {
              onClose();
              void saveImage(reference, platform, onSaved);
            }}
            className="btn-primary"
          >
            Choose file…
          </button>
        </>
      }
    >
      <Field label="Platform" hint="Only the variants pulled to this Mac can be written out.">
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input">
          {platforms.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
