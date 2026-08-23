/**
 * What a field will not accept, and why.
 *
 * Every rule answers with the sentence to show the reader, or null when there
 * is nothing wrong. They are plain functions rather than a schema so that each
 * one can say something specific: "must be at least 200m" is worth more than
 * "invalid", and a schema tends towards the second.
 *
 * Several of these exist on the Go side too, in `ContainerSpec.Validate`. That
 * is deliberate duplication, not an oversight: the agent has to refuse a bad
 * spec whatever sent it, and the window has to answer before a round trip. The
 * wording is kept in step so the same mistake reads the same way whichever half
 * caught it.
 */

/** Nothing typed at all, for the fields that cannot be left out. */
export function required(value: string, what: string): string | null {
  return value.trim() ? null : `${what} is required.`;
}

/**
 * A TCP or UDP port.
 *
 * Zero is rejected along with everything out of range: the runtime treats it
 * as "pick one for me" nowhere in this form, so it is only ever a typo.
 */
export function port(value: string, what: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${what} is required.`;
  if (!/^\d+$/.test(trimmed)) return `${what} must be a number.`;

  const number = Number(trimmed);
  if (number < 1 || number > 65535) return `${what} must be between 1 and 65535.`;

  return null;
}

/** A path the container can resolve, which means one from its root. */
export function absolutePath(value: string, what: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${what} is required.`;
  if (!trimmed.startsWith('/')) return `${what} must start with / — it is resolved from the root.`;

  return null;
}

/**
 * A size the CLI understands: digits with an optional K, M, G or T.
 *
 * `min` is in mebibytes, for the one caller that has a floor.
 */
export function size(value: string, what: string, min = 0): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!/^\d+\s*[kmgt]?$/i.test(trimmed)) {
    return `${what} must be a number, optionally with K, M, G or T — for example 512M or 2G.`;
  }

  if (min > 0 && mebibytes(trimmed) < min) {
    return `${what} must be at least ${floor(min)} — the runtime refuses anything smaller.`;
  }

  return null;
}

/** A floor in the unit somebody would have typed it in. */
function floor(mib: number): string {
  return mib % 1024 === 0 ? `${mib / 1024}G` : `${mib}m`;
}

/** The CLI's size syntax as a number of mebibytes. */
function mebibytes(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const amount = parseInt(trimmed, 10);

  switch (trimmed[trimmed.length - 1]) {
    case 'k':
      return amount / 1024;
    case 'g':
      return amount * 1024;
    case 't':
      return amount * 1024 * 1024;
    default:
      return amount;
  }
}

/** A whole number of something there has to be at least one of. */
export function count(value: string, what: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return `${what} must be a whole number.`;
  if (Number(trimmed) < 1) return `${what} must be at least 1.`;

  return null;
}

/**
 * One `KEY=value` line.
 *
 * The name is what a shell will accept: letters, digits and underscores, not
 * starting with a digit. A value may be anything, including empty and
 * including further `=`.
 */
export function envLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const at = trimmed.indexOf('=');
  if (at === -1) return `“${trimmed}” must be KEY=value.`;

  const key = trimmed.slice(0, at).trim();
  if (!key) return 'Every line needs a name before the =.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `“${key}” is not a usable name — letters, digits and underscores, not starting with a digit.`;
  }

  return null;
}

/** The first thing wrong in a block of KEY=value lines. */
export function envText(text: string): string | null {
  for (const line of text.split('\n')) {
    const problem = envLine(line);
    if (problem) return problem;
  }

  return null;
}

/**
 * A container's name, which the runtime also uses as its id and its hostname.
 *
 * Slashes and spaces are what the CLI itself refuses; the rest of the rule is
 * what survives being a DNS label, since containers find each other by name.
 */
export function containerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/[\s/]/.test(trimmed)) return 'A name cannot contain spaces or slashes.';
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/.test(trimmed)) {
    return 'A name is letters, digits, dots, dashes and underscores, beginning and ending with a letter or digit.';
  }

  return null;
}

/**
 * An image reference: a name, optionally with a registry in front and a tag or
 * digest after it.
 *
 * Deliberately loose about the registry -- `localhost:5050/x`, a bare `redis`
 * and a full `ghcr.io/owner/name:tag` are all ordinary -- and strict only
 * about the shapes that cannot work: uppercase, which registries reject, and
 * an empty tag after the colon.
 */
export function imageReference(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/\s/.test(trimmed)) return 'A reference cannot contain spaces.';

  const [path, ...rest] = trimmed.split('@');
  if (rest.length > 1) return 'A reference can carry only one digest.';
  if (rest.length === 1 && !/^sha256:[0-9a-f]{64}$/.test(rest[0])) {
    return 'A digest looks like sha256: followed by 64 hexadecimal characters.';
  }

  const slash = path.lastIndexOf('/');
  const colon = path.lastIndexOf(':');
  const name = colon > slash ? path.slice(0, colon) : path;
  const tag = colon > slash ? path.slice(colon + 1) : '';

  if (!name) return 'A reference needs a name.';
  if (name !== name.toLowerCase()) return 'An image name has to be lowercase.';
  if (colon > slash && !tag) return 'There is a colon with no tag after it.';
  if (tag && !/^[\w][\w.-]*$/.test(tag)) {
    return 'A tag is letters, digits, dots, dashes and underscores.';
  }

  return null;
}

/** A name for a volume or a network, which the CLI keeps as a filename. */
export function resourceName(value: string, what: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${what} is required.`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(trimmed)) {
    return `${what} is letters, digits, dots, dashes and underscores, beginning with a letter or digit.`;
  }

  return null;
}

/** An IPv4 network in CIDR form, e.g. 192.168.80.0/24. */
export function subnet(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return 'A subnet looks like 192.168.80.0/24.';

  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return 'Each part of the address is 0 to 255.';
  if (Number(match[5]) > 32) return 'The prefix after the / is 0 to 32.';

  return null;
}

/** Where a registry lives: a host, optionally with a port. */
export function registryHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'A registry is required.';
  if (/\s/.test(trimmed)) return 'A registry address cannot contain spaces.';
  if (/^https?:\/\//i.test(trimmed)) return 'Leave off http:// — this is a host, not a URL.';
  if (trimmed.includes('/')) return 'This is the host only, without a path.';

  const [host, port, ...rest] = trimmed.split(':');
  if (rest.length > 0) return 'A registry address carries at most one port.';
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) {
    return 'That is not a hostname.';
  }
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return 'The port after the : must be a number.';

  return null;
}

/** A user, as the CLI takes it: a name, a uid, or uid:gid. */
export function user(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return 'A user cannot contain spaces.';
  if (!/^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)?$/.test(trimmed)) {
    return 'A user is a name, a uid, or uid:gid.';
  }

  return null;
}
