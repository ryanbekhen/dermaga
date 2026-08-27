import type { Container } from '../types';

/**
 * Looking through no project at all: everything, however it is filed.
 *
 * Spelled as the empty string because that is what an unset preference is, so
 * a window that has never chosen opens on everything -- which is what every
 * window did before projects existed.
 */
export const EVERYTHING = '';

/**
 * What sits between a project and what it named.
 *
 * An underscore, matching Compose, because people arrive already reading
 * `myapp_db` as "db, in myapp". Kept in step with projects.Separator in Go.
 */
export const SEPARATOR = '_';

/** The project that means "filed under nothing". */
export const DEFAULT_PROJECT = 'default';

/** What a container's membership is called on screen. */
export function projectOf(container: Container): string {
  return container.project?.trim() ? container.project.trim() : DEFAULT_PROJECT;
}

/** What the switcher shows for the point of view currently in force. */
export function projectLabel(active: string): string {
  return active === EVERYTHING ? 'All' : active;
}

/**
 * Whether a container is in view while looking through a project.
 *
 * A project shows what is filed under it, and nothing else. Default is a
 * project like any other in this respect: looking through `bengkel` does not
 * list what is in default, the same way `kubectl -n foo` does not list the
 * default namespace.
 *
 * This is not what was decided first. The original rule kept default visible
 * from inside every project, out of a fear that a narrowed list would read as
 * lost work -- and that fear was right, at the time, because nothing on screen
 * said how much was out of sight. The count in the page header says it now, and
 * one press widens back to everything. What the old rule was left doing was
 * defeating the feature: every container that existed before projects did is in
 * default, so opening a project showed the whole list with one name above it.
 *
 * Filtering, still: what is out of view is out of *this list*, never out of
 * reach. Two containers in different projects talk to each other exactly as
 * they did before, because the runtime has never heard of any of this.
 */
export function inProject(container: Container, active: string): boolean {
  return filedInProject(container.project, active);
}

/**
 * The same question for anything Dermaga files by record rather than by what
 * happens to be using it: a container, a volume.
 *
 * Both are things somebody owns and keeps, so an unfiled one is in default --
 * not global. That is the difference from an image, which is usually fetched
 * rather than made, and is shared by everybody until somebody builds it here.
 */
export function filedInProject(project: string | undefined, active: string): boolean {
  if (active === EVERYTHING) return true;

  return (project?.trim() ? project.trim() : DEFAULT_PROJECT) === active;
}

/** How many containers are filed under a project, default included. */
export function countIn(containers: Container[], project: string): number {
  return containers.filter((container) => projectOf(container) === project).length;
}

/**
 * Whether a volume or a network is in view while looking through a project.
 *
 * Neither has a membership of its own, and neither is asked for one. A volume
 * belongs to whatever is mounting it and a network to whatever is attached, so
 * the answer is read off the containers using it -- which means it is right
 * from the moment a container is filed, with nothing to keep in step and
 * nothing new on disk.
 *
 * Two cases decide themselves, and both err towards showing. Something nothing
 * is using is placed by nothing, so it stays in view. And a user that is not in
 * the list -- Apple's builder, hidden by its own filter -- is not grounds for
 * hiding what it holds: an answer the reader cannot check is worse than one
 * item too many.
 */
export function attachedInProject(
  usedBy: string[] | undefined,
  containers: Container[],
  active: string
): boolean {
  if (active === EVERYTHING) return true;

  // Nothing is using it, so nothing places it anywhere. It stays visible
  // rather than falling to default and vanishing: a volume made a moment ago
  // and not yet mounted would disappear from the very project it was made in,
  // and a volume nobody can see is one somebody makes a second time.
  const users = (usedBy ?? []).filter(Boolean);
  if (users.length === 0) return true;

  const byName = new Map(containers.map((container) => [container.name, container] as const));

  return users.some((name) => {
    const container = byName.get(name);

    return container ? inProject(container, active) : true;
  });
}

/**
 * Whether an image is in view while looking through a project.
 *
 * Only a **built** image belongs to a project, and only because building is the
 * moment a project can be said to have made something. Everything pulled is
 * global and stays in view wherever you are: `postgres:16` came off a registry,
 * it is the same bytes for everybody, and hiding it inside a project would be
 * inventing an ownership nobody claimed. A project that cannot see the image it
 * is about to run is a project getting in the way.
 *
 * So the rule is one-sided on purpose. A record means built here, and built
 * here means this project's alone. No record means nothing was claimed, and
 * unclaimed means everyone's.
 *
 * Tags rather than one tag, because the list groups by digest: one set of bytes
 * built once can carry `dev` and `latest`, and being filed under either is
 * enough to be the project's.
 */
export function builtInProject(tagProjects: (string | undefined)[], active: string): boolean {
  if (active === EVERYTHING) return true;

  const owners = tagProjects.map((project) => project?.trim()).filter(Boolean) as string[];
  if (owners.length === 0) return true;

  return owners.includes(active);
}

/**
 * The name a thing born in a project is given.
 *
 * Names on this runtime are global -- a container's name is its id -- so two
 * projects cannot both hold a `dashboard`. Rather than leaving people to invent
 * `weba` and `webc`, the project answers it: `bengkel-dashboard`.
 *
 * The cost lands in the hostname and nothing here can soften it: a container's
 * name is also its address, and this runtime offers neither `--hostname` nor a
 * per-network alias, so a prefixed container answers at `bengkel-dashboard`.
 * Shown in the form for exactly that reason -- it is part of the address, so it
 * is never applied behind somebody's back.
 */
export function prefixed(project: string, name: string): string {
  const wanted = name.trim();
  if (project === EVERYTHING || project === DEFAULT_PROJECT || !wanted) return wanted;

  const prefix = `${project}${SEPARATOR}`;

  return wanted.startsWith(prefix) ? wanted : prefix + wanted;
}

/**
 * The short name, for reading a thing inside the project that named it.
 *
 * The prefix is what makes two projects able to hold a `dashboard`; repeating
 * it on every row inside the one project that already says it is noise. Lists
 * read short while a project is open and long everywhere else -- the shape
 * `docker compose ps` has.
 */
export function unprefixed(project: string, name: string): string {
  if (project === EVERYTHING || project === DEFAULT_PROJECT) return name;

  const prefix = `${project}${SEPARATOR}`;

  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Whether a network is in view while looking through a project.
 *
 * Networks are not read off what is attached to them, the way volumes are, and
 * two of them are the reason why.
 *
 * Every project has one, and it is only ever that project's. A network Dermaga
 * made for a project carries the project in a label, so there is nothing to
 * infer: it belongs there and nowhere else.
 *
 * The built-in `default` is the same thing one step back -- it is the *default
 * project's* network, the one a container with no project lands on -- so it
 * shows in default and nowhere else, exactly like the rest. It was treated as
 * infrastructure at first, always in view on the grounds that every container
 * ends up on it. That confused "everything is attached to it" with "it belongs
 * to everybody", and made the one project whose network needs no explaining
 * the one project whose network was everywhere.
 *
 * Attachments only decide a network nobody claimed: one made by hand, outside
 * all of this.
 */
export function networkInProject(
  network: { labels?: Record<string, string>; builtin?: boolean; usedBy?: string[] },
  containers: Container[],
  active: string
): boolean {
  if (active === EVERYTHING) return true;

  if (network.builtin) return active === DEFAULT_PROJECT;

  const owner = network.labels?.['dermaga.project']?.trim();
  if (owner) return owner === active;

  return attachedInProject(network.usedBy, containers, active);
}
