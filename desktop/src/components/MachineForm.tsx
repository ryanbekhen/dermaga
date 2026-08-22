import { useState } from 'react';
import { api } from '../services/api';
import { useResourceStore } from '../store/resourceStore';
import { useToastStore } from '../store/toastStore';
import type { Machine } from '../types';
import { Button } from './Button';
import { Checkbox, Field, Modal } from './form';
import { runTask } from '../services/tasks';

const HOME_MOUNTS = ['rw', 'ro', 'none'];

/** Creating a machine pulls an image and boots a VM, which runs as a task. */
export function CreateMachineDialog({ onClose }: { onClose: () => void }) {
  const images = useResourceStore((s) => s.images);

  const [name, setName] = useState('');
  // Alpine boots in seconds and is a fraction of the download; it is also what
  // the CLI's own help suggests.
  const [image, setImage] = useState('alpine:3.22');
  const [cpus, setCpus] = useState(2);
  const [memory, setMemory] = useState('2G');
  const [homeMount, setHomeMount] = useState('rw');
  const [setDefault, setSetDefault] = useState(false);
  const [noBoot, setNoBoot] = useState(false);
  const [virtualization, setVirtualization] = useState(false);

  const create = () => {
    const spec = {
      name: name.trim() || undefined,
      image: image.trim(),
      cpus,
      memory: memory.trim() || undefined,
      homeMount,
      setDefault,
      noBoot,
      virtualization,
    };

    onClose();
    void runTask({
      id: `machine:${spec.name ?? spec.image}`,
      kind: 'machine',
      label: spec.name ?? spec.image,
      method: 'machines.create',
      params: spec,
    });
  };

  return (
    <Modal
      wide
      title="New machine"
      subtitle="Creates a Linux VM for containers to run in. Progress appears in the title bar."
      onClose={onClose}
      onSubmit={create}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={create} className="btn-primary" disabled={!image.trim()}>
            Create
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Image" hint="For example alpine:3.22 or ubuntu:26.04.">
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            list="dermaga-machine-images"
            autoFocus
            className="input"
          />
          <datalist id="dermaga-machine-images">
            {images.map((img) => (
              <option key={img.reference} value={img.reference} />
            ))}
          </datalist>
        </Field>

        <Field label="Name" hint="Left blank, the CLI names it after the image.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="dev"
            className="input"
          />
        </Field>

        <Field label="CPUs">
          <input
            type="number"
            min={1}
            max={64}
            value={cpus}
            onChange={(e) => setCpus(Number(e.target.value))}
            className="input"
          />
        </Field>

        <Field label="Memory" hint="Defaults to half the host's memory.">
          <input
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            placeholder="2G"
            className="input"
          />
        </Field>

        <Field label="Home mount" hint="How your macOS home directory is exposed inside the VM.">
          <select
            value={homeMount}
            onChange={(e) => setHomeMount(e.target.value)}
            className="input appearance-none"
          >
            {HOME_MOUNTS.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox checked={setDefault} onChange={setSetDefault} label="Make it the default" />
          <Checkbox checked={noBoot} onChange={setNoBoot} label="Create without booting" />
          <Checkbox
            checked={virtualization}
            onChange={setVirtualization}
            label="Nested virtualization (M3+)"
          />
        </div>
      </div>
    </Modal>
  );
}

/** Edits the values `container machine set` accepts; they apply on restart. */
export function MachineSettingsDialog({
  machine,
  onClose,
}: {
  machine: Machine;
  onClose: () => void;
}) {
  const [cpus, setCpus] = useState(machine.cpus);
  const [memory, setMemory] = useState(machine.memoryAllocation);
  const [homeMount, setHomeMount] = useState(machine.homeMount ?? 'rw');
  const [saving, setSaving] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const submit = async () => {
    setSaving(true);
    try {
      await api.configureMachine(machine.id, {
        cpus: Number(cpus) || undefined,
        memory: memory.trim() || undefined,
        homeMount,
      });
      pushToast(`Saved — restart ${machine.id} to apply`);
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not save the settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Configure ${machine.id}`}
      subtitle="New values take effect the next time the machine starts."
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost" disabled={saving}>
            Cancel
          </button>
          <Button variant="primary" busy={saving} busyLabel="Saving…" onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="CPUs">
        <input
          type="number"
          min={1}
          max={64}
          value={cpus}
          onChange={(e) => setCpus(Number(e.target.value))}
          className="input"
        />
      </Field>

      <Field label="Memory" hint="For example 4G or 2048M.">
        <input value={memory} onChange={(e) => setMemory(e.target.value)} className="input" />
      </Field>

      <Field label="Home mount">
        <select
          value={homeMount}
          onChange={(e) => setHomeMount(e.target.value)}
          className="input appearance-none"
        >
          {HOME_MOUNTS.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
