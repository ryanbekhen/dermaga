export interface Port {
  host: string;
  container: string;
  protocol: string;
}

export interface Mount {
  source: string;
  destination: string;
  type: string;
  readOnly?: boolean;
}

export type ContainerStatus = 'running' | 'stopped' | 'stopping' | 'paused' | 'unknown';

export interface NetworkInterface {
  network: string;
  hostname?: string;
  ipv4Address?: string;
  ipv4Gateway?: string;
  ipv6Address?: string;
  macAddress?: string;
  mtu?: number;
}

export interface DNSConfig {
  nameservers: string[];
  searchDomains: string[];
  options: string[];
  domain?: string;
}

export interface Container {
  id: string;
  networks?: string[];
  interfaces?: NetworkInterface[];
  hostname?: string;
  platform?: string;
  runtimeHandler?: string;
  stopSignal?: string;
  dns?: DNSConfig;
  capAdd?: string[];
  capDrop?: string[];
  sysctls?: Record<string, string>;
  rosetta?: boolean;
  virtualization?: boolean;
  ssh?: boolean;
  readOnlyRoot?: boolean;
  useInit?: boolean;
  terminal?: boolean;
  entrypoint?: string;
  command?: string[];
  workingDir?: string;
  user?: string;
  name: string;
  image: string;
  status: ContainerStatus;
  state: string;
  createdAt: string;
  startedAt?: string;
  ports: Port[];
  mounts: Mount[];
  labels: Record<string, string>;
  cpuAllocation?: number;
  memoryAllocation?: string;
  environmentVariables?: string[];
  /** Percentage of the container's own CPU allocation, 0-100. */
  cpuUsage?: number;
  /** Human-readable resident memory, e.g. "252m". */
  memoryUsage?: string;
  /** Percentage of the container's memory allocation, 0-100. */
  memoryUsagePercent?: number;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  message?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  runtime: 'available' | 'unavailable';
}

export interface Machine {
  id: string;
  status: 'running' | 'stopped' | 'stopping' | 'unknown';
  default: boolean;
  createdAt: string;
  cpus: number;
  memoryBytes: number;
  memoryAllocation: string;
  diskSizeBytes: number;
  startedAt?: string;
  ipAddress?: string;
  containerId?: string;
  /** Only present on the detail (inspect) response. */
  image?: string;
  homeMount?: string;
  architecture?: string;
  os?: string;
  username?: string;
}

export interface Image {
  reference: string;
  name: string;
  tag: string;
  digest: string;
  createdAt: string;
  platforms: string[];
  sizeInBytes: number;
}

export interface ImageHistory {
  createdAt: string;
  createdBy: string;
  comment?: string;
  emptyLayer?: boolean;
}

export interface ImageVariant {
  platform: string;
  digest: string;
  sizeInBytes: number;
  createdAt: string;
  entrypoint: string[];
  command: string[];
  env: string[];
  workingDir?: string;
  user?: string;
  exposedPorts: string[];
  labels: Record<string, string>;
  layers: number;
  history: ImageHistory[];
}

export interface ImageDetail {
  reference: string;
  name: string;
  tag: string;
  digest: string;
  createdAt: string;
  variants: ImageVariant[];
}

export interface Volume {
  name: string;
  driver: string;
  format: string;
  source: string;
  sizeInBytes: number;
  createdAt: string;
  labels: Record<string, string>;
  usedBy: string[];
}

export interface Network {
  name: string;
  mode: string;
  plugin: string;
  createdAt: string;
  labels: Record<string, string>;
  ipv4Subnet?: string;
  ipv4Gateway?: string;
  ipv6Subnet?: string;
  builtin: boolean;
  usedBy: string[];
}

export interface SpecMount {
  type: string;
  source: string;
  target: string;
  readOnly?: boolean;
}

/** Everything Dermaga can set when creating or recreating a container. */
export interface ContainerSpec {
  name: string;
  image: string;
  entrypoint?: string;
  command?: string[];
  env?: string[];
  ports?: Port[];
  mounts?: SpecMount[];
  labels?: Record<string, string>;
  cpus?: number;
  memory?: string;
  network?: string;
  workdir?: string;
  user?: string;
  readOnly?: boolean;
  init?: boolean;
  removeOnExit?: boolean;
}

/** Persisted in ~/.dermaga/config.json by the server. */
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  showStopped: boolean;
  logTail: number;
  confirmDestructive: boolean;
  notifyOnExit: boolean;
  sidebarCollapsed: boolean;
}

/** How Apple's CLI is installed, and whether it can be updated from here. */
export interface ToolchainStatus {
  installed: boolean;
  version?: string;
  managedBy?: 'homebrew' | 'manual';
  brewAvailable: boolean;
  updateAvailable: boolean;
  latestVersion?: string;
  checkError?: string;
}

/** What the running build was cut from. */
export interface BuildInfo {
  version: string;
  commit: string;
  date?: string;
}

export interface SystemStatus {
  status: string;
  running: boolean;
  apiServerVersion?: string;
  cliVersion?: string;
  apiServerBuild?: string;
  appRoot?: string;
  installRoot?: string;
  logRoot?: string;
}

export interface UsageEntry {
  total: number;
  active: number;
  sizeInBytes: number;
  reclaimable: number;
}

export interface DiskUsage {
  containers: UsageEntry;
  images: UsageEntry;
  volumes: UsageEntry;
}

export interface MachineSpec {
  name?: string;
  image: string;
  cpus?: number;
  memory?: string;
  homeMount?: string;
  setDefault?: boolean;
  noBoot?: boolean;
  virtualization?: boolean;
}

/** One `container build` run. Only the context directory is required. */
export interface BuildSpec {
  context: string;
  dockerfile?: string;
  tag?: string;
  target?: string;
  platform?: string;
  buildArgs?: string[];
  noCache?: boolean;
}

/** One sample of a container's usage, for the charts. */
export interface UsagePoint {
  at: number;
  cpuPercent: number;
  memoryBytes: number;
}

/** One entry in a container's filesystem. */
export interface FileEntry {
  name: string;
  path: string;
  size: number;
  mode: string;
  owner?: string;
  modified?: string;
  isDir: boolean;
  isLink: boolean;
  target?: string;
}

/** A registry the user is signed in to. Credentials live with Apple's CLI. */
export interface RegistryLogin {
  server: string;
  username?: string;
  created?: string;
  modified?: string;
}

/** What the background vulnerability scanner is doing. */
export interface ScannerStatus {
  installed: boolean;
  version?: string;
  brewAvailable: boolean;
  state: 'idle' | 'installing' | 'updating' | 'updatingDatabase' | 'scanning' | 'failed';
  updateAvailable?: boolean;
  latestVersion?: string;
  detail?: string;
  target?: string;
  /** Position within a sweep of several images, when there is one. */
  position?: number;
  total?: number;
  percent?: number;
  error?: string;
  databaseUpdatedAt?: string;
  databaseNextAt?: string;
  databaseReady: boolean;
}

export interface Finding {
  id: string;
  package: string;
  installed?: string;
  /** Empty when upstream has no fix yet, which is worth showing as such. */
  fixed?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  title?: string;
  url?: string;
}

export interface VulnerabilityReport {
  reference: string;
  scannedAt: string;
  os?: string;
  summary: Record<string, number>;
  findings: Finding[];
}

/** Whether the buildkit container every build runs through is up. */
export interface BuilderStatus {
  running: boolean;
  state?: string;
  image?: string;
  cpus?: number;
}

export interface MachineSettings {
  cpus?: number;
  memory?: string;
  homeMount?: string;
  virtualization?: boolean;
}

export interface VolumeSpec {
  name: string;
  size?: string;
  labels?: Record<string, string>;
}

export interface NetworkSpec {
  name: string;
  subnet?: string;
  subnetV6?: string;
  internal?: boolean;
}

export type ContainerTab = 'overview' | 'logs' | 'files' | 'terminal';
export type MachineTab = 'overview' | 'logs' | 'terminal';

export type Route =
  | { name: 'containers' }
  | { name: 'container'; id: string; tab: ContainerTab }
  | { name: 'images' }
  | { name: 'image'; reference: string }
  | { name: 'volumes' }
  | { name: 'networks' }
  | { name: 'registries' }
  | { name: 'machines' }
  | { name: 'machine'; id: string; tab: MachineTab }
  | { name: 'system' }
  | { name: 'settings' }
  | { name: 'help' }
  | { name: 'licences' };
