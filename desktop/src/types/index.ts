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
  /** The project it is filed under. Absent means default: filed under none. */
  project?: string;
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
  /**
   * The image the container is actually made of, and whether the tag it was
   * created from still points at it.
   *
   * A container is a copy of an image taken at one moment. Build that image
   * again and the tag moves on; the container carries on running the bytes it
   * was made from, under a name that now means something else. Recreating it
   * is what closes the gap.
   */
  imageDigest?: string;
  imageMoved?: boolean;
  /**
   * Whether Dermaga starts this container when it starts.
   *
   * Kept by Dermaga rather than by the runtime, which has nowhere for it. It
   * was a label until 1.11.0, and a label can only be written by
   * `container run` — so turning this on meant recreating the container, which
   * is a filesystem lost for the sake of a tick.
   */
  autoBoot?: boolean;
  status: ContainerStatus;
  state: string;
  createdAt: string;
  startedAt?: string;
  ports: Port[];
  /**
   * What the image says the container listens on, e.g. "80/tcp". Read from the
   * image, because the runtime reports what a container publishes to the host
   * and nothing about what it listens on.
   */
  exposedPorts?: string[];
  mounts: Mount[];
  labels: Record<string, string>;
  cpuAllocation?: number;
  shmSize?: string;
  ulimits?: string[];
  memoryAllocation?: string;
  environmentVariables?: string[];
  /** Percentage of the container's own CPU allocation, 0-100. */
  cpuUsage?: number;
  /** Human-readable resident memory, e.g. "252m". */
  memoryUsage?: string;
  /** The same figure exactly, for the chart: "252m" steps in whole mebibytes. */
  memoryUsageBytes?: number;
  /** Percentage of the container's memory allocation, 0-100. */
  memoryUsagePercent?: number;
  /** Bytes per second, from the difference between the last two samples. */
  networkRxPerSec?: number;
  networkTxPerSec?: number;
  blockReadPerSec?: number;
  blockWritePerSec?: number;
  /** Totals since the container started, which the rates are derived from. */
  networkRxBytes?: number;
  networkTxBytes?: number;
  blockReadBytes?: number;
  blockWriteBytes?: number;
  /** How many processes are running inside it. */
  processes?: number;
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
  /**
   * The project it was built in, absent for none. An image that was pulled
   * belongs to no project and stays in default, borrowed by whoever needs it.
   */
  project?: string;
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
  /** The project it is filed under, absent for none. */
  project?: string;
  driver: string;
  format: string;
  source: string;
  /** The cap the image was created with, not how full it is. */
  sizeInBytes: number;
  /** Blocks the sparse image actually occupies on the Mac. */
  usedBytes: number;
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
/**
 * An edit that was begun and never finished.
 *
 * Written down before the container is taken apart, so a recreate that fails
 * does not take the changes with it.
 */
export interface PendingEdit {
  id: string;
  spec: ContainerSpec;
  /** What the container was, so a restore that also failed can be retried. */
  previous: ContainerSpec;
  /** Why it did not finish, in the runtime's own words. */
  reason?: string;
  at: string;
}

/** A starting point for the create form, from the catalogue the agent fetches. */
export interface Template {
  id: string;
  name: string;
  summary: string;
  /** What the template cannot do for you, said before it is discovered. */
  caveat?: string;
  homepage?: string;
  /** A data URI, or absent — in which case the window draws a monogram. */
  logo?: string;
  spec: ContainerSpec;
}

export interface ContainerSpec {
  name: string;
  image: string;
  /**
   * The project to file it under. Not a `container run` flag: the runtime has
   * no idea projects exist, so the agent writes it to Dermaga's own record.
   */
  project?: string;
  entrypoint?: string;
  command?: string[];
  env?: string[];
  ports?: Port[];
  mounts?: SpecMount[];
  labels?: Record<string, string>;
  cpus?: number;
  memory?: string;
  /**
   * The size of /dev/shm, in the size syntax the CLI takes — 64m, 1g. The
   * default is small enough that Postgres and headless Chrome both fall over
   * on it, and the way they fall over says nothing about shared memory.
   */
  shmSize?: string;
  /** Resource limits, one per entry, as `<type>=<soft>[:<hard>]`. */
  ulimits?: string[];
  /** Every network to attach at creation; empty means the default network. */
  networks?: string[];
  workdir?: string;
  user?: string;
  readOnly?: boolean;
  init?: boolean;
  removeOnExit?: boolean;
  /**
   * Settings the forms never show but every recreate has to preserve. The
   * agent reads them back from the container and renders them as flags again;
   * dropping them here would reconfigure a container that was only meant to
   * change one thing.
   */
  platform?: string;
  runtimeHandler?: string;
  capAdd?: string[];
  capDrop?: string[];
  dns?: DNSConfig;
  rosetta?: boolean;
  virtualization?: boolean;
  ssh?: boolean;
  terminal?: boolean;
}

/** Persisted in ~/.dermaga/config.json by the server. */
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  showStopped: boolean;
  logTail: number;
  confirmDestructive: boolean;
  notifyOnExit: boolean;
  /** And when work somebody started finishes: an image built or pulled, a
   *  container or a machine made. */
  notifyOnFinish: boolean;
  notifyOnUpdate: boolean;
  sidebarCollapsed: boolean;
  /**
   * The project the window is looking through. Empty is "All".
   *
   * Deliberately a window preference and not something the agent acts on: a
   * project decides what is shown, so where it is remembered is here.
   */
  activeProject?: string;
  /** Where templates are fetched from. Empty means Dermaga's own catalogue. */
  templatesUrl?: string;
  showBuilder: boolean;
}

/** How Apple's CLI is installed, and whether it can be updated from here. */
export interface ToolchainStatus {
  installed: boolean;
  version?: string;
  managedBy?: 'homebrew' | 'manual';
  brewAvailable: boolean;
  updateAvailable: boolean;
  latestVersion?: string;
  /** The oldest CLI Dermaga is written for, and whether this one is behind it. */
  minimumVersion?: string;
  belowMinimum?: boolean;
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
  /**
   * A Dockerfile typed into the app rather than one on disk. The agent writes
   * it to a directory of its own, which becomes the context unless `context`
   * names a real one — which is what a paste with COPY in it needs.
   */
  dockerfileText?: string;
  dockerfile?: string;
  tag?: string;
  target?: string;
  platform?: string;
  buildArgs?: string[];
  /** Forward the SSH agent into the build, for a Dockerfile that reaches a
   *  private repository. The keys never enter the image. */
  ssh?: boolean;
  /** The project to file the built image under. Not a build flag. */
  project?: string;
  noCache?: boolean;
}

/**
 * A path dragged onto the window that turns out to be something to build.
 *
 * A Dockerfile is edited in one window and built in another, and the second one
 * asks for the folder, the file's name within it, and a tag. The drop already
 * knows the first two.
 */
export interface BuildDrop {
  context: string;
  /** Empty when it is the plain `Dockerfile` the CLI looks for anyway. */
  dockerfile?: string;
  /** A tag worth suggesting, from the folder's own name. */
  name?: string;
}

/**
 * A command that has finished, and what it printed.
 *
 * Kept by the agent so a build's log outlives the window that watched it
 * arrive. Only finished work: anything still running belongs to the window,
 * because it is still arriving there.
 */
export interface TaskRecord {
  id: string;
  /** What the agent called the run, which is the name a notification carries. */
  streamId?: string;
  kind: 'image' | 'machine' | 'container';
  label: string;
  status: 'done' | 'failed';
  error?: string;
  lines: string[];
  at: string;
}

/** One live reading of a container's usage. Never stored: see useLiveUsage. */
export interface UsagePoint {
  at: number;
  cpuPercent: number;
  memoryBytes: number;
  /** Bytes per second: what a shape can show, unlike a total that only climbs. */
  networkRxPerSec: number;
  networkTxPerSec: number;
  blockReadPerSec: number;
  blockWritePerSec: number;
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
/** One domain the stored Cloudflare token can put a DNS record on. */
export interface Zone {
  id: string;
  name: string;
  /** The account that owns the domain, and the one its tunnel is made in. */
  account: { id: string; name?: string };
}

/**
 * What a route can point at.
 *
 * A container is the common one, but not the only thing on this Mac worth a
 * hostname: the Linux VMs have addresses of their own, and so does macOS, where
 * a dev server usually runs long before it is in a container at all.
 */
export type TunnelKind = 'container' | 'machine' | 'host';

export interface TunnelTarget {
  kind: TunnelKind;
  /** Which one. Empty for the host, of which there is only ever one. */
  name: string;
  /** Where this Mac reaches it. Empty when it is not running. */
  address: string;
  gateway?: string;
  network?: string;
  /**
   * Ports it is known to listen on, as suggestions. Empty for a machine or the
   * host, which declare nothing — so there the port is typed.
   */
  ports: string[];
}

export type TunnelStatus = 'running' | 'starting' | 'stopped' | 'error';

/** One public hostname, and what answers on it. */
export interface TunnelRoute {
  hostname: string;
  zoneId: string;
  zoneName: string;
  subdomain: string;
  /** What the route was made for; this does not change on its own. */
  kind: TunnelKind;
  /** Which one. Empty for the host. */
  target: string;
  port: string;
  /** Where that is right now, re-resolved when the container moves. */
  address: string;
  /**
   * The gateway of the network it sits on, and what that network is called.
   * Containers on different networks have different gateways, so this is per
   * route rather than one for the whole picture.
   */
  gateway?: string;
  network?: string;
  tunnelId: string;
  accountId: string;
  dnsRecord?: string;
  created: string;
  status: TunnelStatus;
  error?: string;
  url?: string;
  /** Whether the container behind it is running and has an address. */
  reachable: boolean;
}

/**
 * One Cloudflare tunnel: a connector, and the routes it carries.
 *
 * One per Cloudflare account, made by Dermaga rather than by the user — a
 * tunnel belongs to one account, so routes on domains in different accounts
 * cannot share one.
 */
export interface Tunnel {
  id: string;
  name: string;
  accountId: string;
  accountName?: string;
  status: TunnelStatus;
  error?: string;
  routes: TunnelRoute[];
}

/** What the window needs to know before it can offer any of this. */
export interface TunnelsStatus {
  /** Whether an API token is in the keychain. */
  connected: boolean;
  accountId?: string;
  /**
   * Set only when the token reaches exactly one account. A token can span
   * several, and naming one would name the wrong one for most of the domains.
   */
  accountName?: string;
  /** How much the token reaches, said instead when there are several accounts. */
  domains: number;
  accounts: number;
  /** Whether the cloudflared connector is on this Mac. */
  installed: boolean;
  brewAvailable: boolean;
  routes: number;
  running: number;
}

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
  /**
   * How many places in the image it was found in.
   *
   * Trivy reads the same library out of every binary built with it, so a flaw
   * in Go's standard library comes back once per Go binary. One problem in
   * twenty places, not twenty problems.
   */
  places?: number;
  /** Empty when upstream has no fix yet, which is worth showing as such. */
  fixed?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  title?: string;
  url?: string;

  // Read only when a finding is opened.

  /** "fixed", "affected", "will_not_fix", "end_of_life". */
  status?: string;
  /** The paragraph explaining what the flaw actually is. */
  description?: string;
  /** Classes of weakness, as CWE identifiers. */
  weaknesses?: string[];
  /** When it became public. */
  published?: string;
  /** When it was last revised. */
  lastModified?: string;
  /** The highest CVSS score any vendor gave it; absent when none did. */
  score?: number;
  /** The vector behind that score: how it is reached and what it costs. */
  vector?: string;
  /** Every vendor's rating, because they disagree. */
  ratings?: Rating[];
  /** Everything written about it elsewhere. */
  references?: string[];
  /** The layer that brought the vulnerable package in, by digest. */
  layer?: string;
  /** Which security database said so. */
  sourceName?: string;
  sourceUrl?: string;
}

/** One vendor's grading of one vulnerability. */
export interface Rating {
  source: string;
  score?: number;
  vector?: string;
}

/**
 * One layer of an image, as its manifest describes it. The size is the
 * compressed blob — what the image costs to pull and to store.
 */
export interface ImageLayer {
  digest: string;
  size: number;
}

/** One thing installed in an image, whether or not anything is wrong with it. */
export interface ImagePackage {
  name: string;
  version?: string;
  /**
   * How many places in the image it was read out of.
   *
   * Go's standard library is inside every binary built with it, and each
   * binary is a thing Trivy reads — so it came back as one row per binary,
   * every one of them identical.
   */
  places?: number;
  /**
   * How much room it takes once unpacked. Only OS packages have one — apk and
   * dpkg record it, while a Go module or an npm dependency is compiled or
   * bundled into something else. Absent means "not a thing with a size".
   */
  size?: number;
  /** The ecosystem it was read from: "alpine", "npm", "gobinary". */
  type?: string;
  /** What was read to find it — a package database, a lockfile path. */
  source?: string;
  licenses?: string[];
}

/**
 * How a scan came out, without the findings behind it.
 *
 * This is what the window asks for on opening, for every image that has been
 * scanned. A report is mostly its findings — a busy image carries three
 * thousand — and no list shows one: an image's row shows how many it has of
 * each severity, which is all of this. The findings are read on the image's
 * own page, which asks for that one report by name.
 */
export interface ScanSummary {
  reference: string;
  scannedAt: string;
  os?: string;
  summary: Record<string, number>;
}

export interface VulnerabilityReport extends ScanSummary {
  findings: Finding[];
  /**
   * Everything installed. Absent from reports stored before Dermaga began
   * asking Trivy for the full inventory, which is why it is optional: an old
   * report has no packages listed, and that is not the same as an image with
   * no packages in it.
   */
  packages?: ImagePackage[];
  /**
   * The image's layers, in manifest order — which is build order, so the nth
   * of these is the nth layer-producing step of the build. Read while the
   * image was unpacked for the scan; absent from reports stored before that.
   */
  layers?: ImageLayer[];
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

/** What a container meets when it mounts a volume. */
export interface VolumeState {
  /** "uid:gid" of the volume's root directory. */
  owner: string;
  /**
   * Whether the ext4 filesystem's lost+found is still there. Images that look
   * before they write -- redis, Postgres -- read it as "this volume is not
   * empty" and refuse to set themselves up.
   */
  lostFound: boolean;
}

export interface VolumeSpec {
  name: string;
  size?: string;
  /** The project to make it in. Named for it, and filed under it. */
  project?: string;
  labels?: Record<string, string>;
}

export interface NetworkSpec {
  name: string;
  subnet?: string;
  subnetV6?: string;
  internal?: boolean;
}

export type ContainerTab = 'overview' | 'usage' | 'logs' | 'files' | 'terminal';
export type MachineTab = 'overview' | 'logs' | 'terminal';

export type Route =
  | { name: 'containers' }
  | { name: 'container'; id: string; tab: ContainerTab; path?: string }
  /**
   * The form that makes a container, which is a page rather than a dialog: it
   * is the longest form in the app -- name, image, limits, networks, ports,
   * mounts, environment -- and a panel floating over the list it will appear
   * in had to scroll inside itself to show half of it.
   *
   * It carries what to open with, because there is more than one way in: a
   * template picked from the gallery, or an image run from its own page. And
   * where to go back to, so leaving returns to whichever of those it was
   * rather than always to the container list.
   */
  | { name: 'container-new'; initial?: Partial<ContainerSpec>; from?: Route }
  /**
   * The same form over an existing container, and a page for the same reason.
   * It carries the spec rather than the id alone because that spec is read
   * from the server -- with an unfinished edit preferred over it -- before the
   * form is opened at all, and reading it twice would mean a page that opens
   * empty and fills in underneath whoever is already typing into it.
   */
  | {
      name: 'container-edit';
      id: string;
      initial: ContainerSpec;
      resumed?: PendingEdit;
      from?: Route;
    }
  /**
   * The catalogue the create form can be started from. A page because it is a
   * catalogue: read through, compared across, and left by going somewhere --
   * the form, filled in from whichever one was picked.
   */
  | { name: 'templates'; from?: Route }
  /**
   * The build form. Three ways in -- the button on the image list, a search
   * that asked for one half of it, and a Dockerfile dropped anywhere on the
   * window -- so it carries which half to open on, what the drop already
   * answered, and where the person was when it opened.
   */
  | { name: 'image-build'; start?: 'folder' | 'paste'; drop?: BuildDrop; from?: Route }
  /**
   * What one run is printing, live. Its id is the window's own name for the
   * run rather than the agent's, which is what the task list is keyed by.
   */
  | { name: 'task'; id: string; from?: Route }
  /**
   * The form that publishes a hostname. It carries the route being moved,
   * when it is a move: the same form, naming what it replaces.
   */
  | { name: 'tunnel-route'; editing?: TunnelRoute; from?: Route }
  /** The form that makes a Linux VM, which is a pull and a boot to watch. */
  | { name: 'machine-new'; from?: Route }
  | { name: 'images' }
  | { name: 'image'; reference: string }
  | { name: 'volumes' }
  | { name: 'volume'; volume: string }
  | { name: 'networks' }
  | { name: 'network'; network: string }
  | { name: 'registries' }
  | { name: 'tunnels' }
  | { name: 'machines' }
  | { name: 'machine'; id: string; tab: MachineTab }
  | { name: 'system' }
  | { name: 'settings' }
  | { name: 'help' }
  | { name: 'changelog' }
  | { name: 'licences' };

/**
 * A group containers can be filed under.
 *
 * `default` is not one of these. It is the absence of a project -- a container
 * with no membership recorded is in default -- so it is never in this list, and
 * the switcher puts it at the head of the list itself.
 */
export interface Project {
  name: string;
  createdAt?: string;
}
