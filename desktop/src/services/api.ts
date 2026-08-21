import { invoke } from './ipc';
import type {
  PendingEdit,
  BuilderStatus,
  BuildInfo,
  BuildSpec,
  Container,
  ContainerSpec,
  DiskUsage,
  FileEntry,
  Image,
  ImageDetail,
  Template,
  Machine,
  MachineSettings,
  MachineSpec,
  Network,
  NetworkSpec,
  Settings,
  SystemStatus,
  ToolchainStatus,
  RegistryLogin,
  ScannerStatus,
  Volume,
  UsagePoint,
  VolumeSpec,
  VolumeState,
  VulnerabilityReport,
} from '../types';

/**
 * Every operation the UI can perform, as JSON-RPC calls on the agent. Streaming
 * work (logs, pulls, terminals) lives in ./ipc, since it needs the stream id.
 */
export const api = {
  // --- system -------------------------------------------------------------

  async getSystem(): Promise<{ status: SystemStatus; cliAvailable: boolean }> {
    return invoke('system.status');
  },

  /** Kernel install is opt-in; without an answer the CLI would prompt. */
  async startSystem(installKernel = false): Promise<void> {
    await invoke('system.start', { installKernel });
  },

  async stopSystem(): Promise<void> {
    await invoke('system.stop');
  },

  async getDiskUsage(): Promise<DiskUsage> {
    return invoke('system.diskUsage');
  },

  /** Reports what was actually freed, which may be nothing. */
  async pruneSystem(): Promise<{ freedBytes: number; failures?: string[] }> {
    return invoke('system.prune');
  },

  /** Containers cannot run without one, and starting the services does not
   *  need one -- so this is asked for separately. */
  async getKernel(): Promise<{ configured: boolean }> {
    return invoke('system.kernelConfigured');
  },

  async getBuild(): Promise<BuildInfo> {
    return invoke('app.info');
  },

  // --- the container CLI itself -------------------------------------------

  async getToolchain(): Promise<ToolchainStatus> {
    return invoke('toolchain.status');
  },

  /** Whether the buildkit container is up; every build needs it running. */
  async getBuilder(): Promise<BuilderStatus> {
    return invoke('images.builderStatus');
  },

  // --- files inside a container --------------------------------------------

  /** Whether the container has a shell; without one, Files and Terminal cannot work. */
  async hasShell(container: string): Promise<boolean> {
    const { hasShell } = await invoke<{ hasShell: boolean }>('containers.hasShell', { container });
    return hasShell;
  },

  async listFiles(container: string, path: string): Promise<FileEntry[]> {
    return (await invoke<FileEntry[]>('files.list', { container, path })) ?? [];
  },

  /** Copies things from the host into a directory in the container. */
  async copyIntoContainer(container: string, sources: string[], path: string): Promise<void> {
    await invoke('files.copyIn', { container, sources, path });
  },

  async copyOutOfContainer(container: string, path: string, target: string): Promise<void> {
    await invoke('files.copyOut', { container, path, target });
  },

  // --- registries ----------------------------------------------------------

  async getRegistries(): Promise<RegistryLogin[]> {
    return (await invoke<RegistryLogin[]>('registry.list')) ?? [];
  },

  /** The password goes straight to the CLI, which owns it; nothing is kept here. */
  async registryLogin(server: string, username: string, password: string, scheme?: string) {
    await invoke('registry.login', { server, username, password, scheme });
  },

  async registryLogout(server: string): Promise<void> {
    await invoke('registry.logout', { server });
  },

  /** Gives an image a second reference, usually the one it will be pushed as. */
  async tagImage(source: string, target: string): Promise<void> {
    await invoke('images.tag', { source, target });
  },

  // --- vulnerability scanning ---------------------------------------------

  async getScannerStatus(): Promise<ScannerStatus> {
    return invoke('scanner.status');
  },

  /**
   * Starting points for the create form.
   *
   * Fetched by the agent rather than here: the window is served under
   * `connect-src 'self'` and has no network of its own. Logos arrive as data
   * URIs for the same reason.
   */
  async listTemplates(): Promise<Template[]> {
    return invoke('templates.list');
  },

  /** Asks for the catalogue now, rather than when it next goes stale. */
  async refreshTemplates(): Promise<Template[]> {
    return invoke('templates.refresh');
  },

  /** Queues a scan; the result arrives as a pushed status, not a return value. */
  async scanImage(reference: string): Promise<void> {
    await invoke('scanner.scan', { reference });
  },

  async getScanReport(reference: string): Promise<VulnerabilityReport | null> {
    return invoke('scanner.report', { reference });
  },

  async getScanReports(): Promise<Record<string, VulnerabilityReport>> {
    return (await invoke<Record<string, VulnerabilityReport>>('scanner.reports')) ?? {};
  },

  /**
   * Drops results for images that no longer exist. Results for images still
   * present are kept: discarding those would only mean scanning them again.
   */
  async clearScans(): Promise<{ removed: number }> {
    return invoke('scanner.clear');
  },

  /** Puts a scan failure away, for the ones nothing here can fix. */
  async dismissScanFailure(): Promise<ScannerStatus> {
    return invoke('scanner.dismiss');
  },

  // --- settings -----------------------------------------------------------

  async getSettings(): Promise<{ settings: Settings; path: string }> {
    return invoke('settings.get');
  },

  async saveSettings(settings: Settings): Promise<{ settings: Settings; path: string }> {
    return invoke('settings.save', settings);
  },

  // --- containers ---------------------------------------------------------

  async getContainers(all = true): Promise<Container[]> {
    return (await invoke<Container[]>('containers.list', { all })) ?? [];
  },

  async getContainer(id: string): Promise<Container> {
    return invoke('containers.get', { id });
  },

  /** Half an hour of samples, oldest first; empty for a container just started. */
  async getContainerHistory(id: string): Promise<UsagePoint[]> {
    return (await invoke<UsagePoint[]>('containers.history', { id })) ?? [];
  },

  async getContainerSpec(id: string): Promise<ContainerSpec> {
    return invoke('containers.spec', { id });
  },

  async startContainer(id: string): Promise<void> {
    await invoke('containers.start', { id });
  },

  async stopContainer(id: string, timeout = 10): Promise<void> {
    await invoke('containers.stop', { id, timeout });
  },

  /**
   * Stops a container the abrupt way, for one that will not stop politely.
   * Answers with an error rather than hanging when the container has stopped
   * answering altogether.
   */
  async killContainer(id: string): Promise<void> {
    await invoke('containers.kill', { id });
  },

  /**
   * An edit that was begun and never finished, if there is one.
   *
   * Editing recreates the container, and a recreate can fail -- the image was
   * built here and has since been deleted, a port is taken now. The changes are
   * written down before anything is taken apart, so they can be offered back
   * rather than typed again.
   */
  async getPendingEdit(id: string): Promise<PendingEdit | null> {
    return invoke('containers.pendingEdit', { id });
  },

  async discardPendingEdit(id: string): Promise<void> {
    await invoke('containers.discardEdit', { id });
  },

  /**
   * Creates a container and waits for it, rather than streaming its progress
   * as a task. For the helper containers Dermaga runs on the user's behalf,
   * where a progress row would be noise about something they did not ask for.
   */
  async runContainer(spec: ContainerSpec): Promise<void> {
    await invoke('containers.run', spec);
  },

  async removeContainer(id: string, force = false): Promise<void> {
    await invoke('containers.remove', { id, force });
  },

  /** Applies a new spec by recreating the container; named volumes survive. */
  async updateContainer(id: string, spec: ContainerSpec): Promise<Container> {
    return invoke('containers.update', { id, spec });
  },

  // --- images -------------------------------------------------------------

  async getImages(): Promise<Image[]> {
    return (await invoke<Image[]>('images.list')) ?? [];
  },

  async inspectImage(reference: string): Promise<ImageDetail> {
    return invoke('images.inspect', { reference });
  },

  async deleteImage(reference: string): Promise<void> {
    await invoke('images.delete', { reference });
  },

  async pruneImages(): Promise<void> {
    await invoke('images.prune');
  },

  // --- volumes and networks -----------------------------------------------

  async getVolumes(): Promise<Volume[]> {
    return (await invoke<Volume[]>('volumes.list')) ?? [];
  },

  async createVolume(spec: VolumeSpec): Promise<void> {
    await invoke('volumes.create', spec);
  },

  /**
   * What a container will find when it mounts this volume: who owns its root
   * directory, and whether the filesystem's own lost+found is still in it.
   *
   * Instant when a running container holds the volume -- the agent asks that
   * container -- and a few seconds otherwise, since it has to start a small
   * one to look.
   */
  async getVolumeState(name: string): Promise<VolumeState> {
    return invoke('volumes.owner', { name });
  },

  /** Each answers with the state as it stands afterwards, not as it was asked for. */
  async setVolumeOwner(name: string, owner: string): Promise<VolumeState> {
    return invoke('volumes.setOwner', { name, owner });
  },

  async tidyVolume(name: string): Promise<VolumeState> {
    return invoke('volumes.tidy', { name });
  },

  async deleteVolume(name: string): Promise<void> {
    await invoke('volumes.delete', { name });
  },

  async getNetworks(): Promise<Network[]> {
    return (await invoke<Network[]>('networks.list')) ?? [];
  },

  async createNetwork(spec: NetworkSpec): Promise<void> {
    await invoke('networks.create', spec);
  },

  async deleteNetwork(name: string): Promise<void> {
    await invoke('networks.delete', { name });
  },

  // --- machines -----------------------------------------------------------

  async getMachines(): Promise<Machine[]> {
    return (await invoke<Machine[]>('machines.list')) ?? [];
  },

  async getMachine(id: string): Promise<Machine> {
    return invoke('machines.get', { id });
  },

  async startMachine(id: string): Promise<void> {
    await invoke('machines.start', { id });
  },

  async stopMachine(id: string): Promise<void> {
    await invoke('machines.stop', { id });
  },

  async deleteMachine(id: string): Promise<void> {
    await invoke('machines.delete', { id });
  },

  async setDefaultMachine(id: string): Promise<void> {
    await invoke('machines.setDefault', { id });
  },

  async configureMachine(id: string, settings: MachineSettings): Promise<void> {
    await invoke('machines.configure', { id, settings });
  },
};

/** Parameters for the streaming methods, kept beside their callers' types. */
export const streams = {
  containerLogs: (id: string, tail: number) =>
    ['containers.logs', { id, tail, follow: true }] as const,
  machineLogs: (id: string, tail: number, boot: boolean) =>
    ['machines.logs', { id, tail, follow: true, boot }] as const,
  systemLogs: (last = '30m') => ['system.logs', { last, follow: true }] as const,
  pullImage: (reference: string, platform?: string, scheme?: string) =>
    ['images.pull', { reference, platform, scheme }] as const,
  buildImage: (spec: BuildSpec) => ['images.build', spec] as const,
  saveImage: (reference: string, platform: string, output: string) =>
    ['images.save', { reference, platform, output }] as const,
  loadImage: (input: string) => ['images.load', { input }] as const,
  pushImage: (reference: string, scheme?: string) =>
    ['images.push', { reference, scheme }] as const,
  createMachine: (spec: MachineSpec) => ['machines.create', spec] as const,
  createContainer: (spec: ContainerSpec) => ['containers.create', spec] as const,
};
