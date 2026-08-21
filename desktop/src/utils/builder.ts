import type { Container } from '../types';

/**
 * Apple's build container, told apart from somebody's own.
 *
 * `container build` makes it, `container builder` manages it, and deleting it
 * only means the next build makes another exactly like it. It is shown by
 * default because it is real and holds real memory -- but it is nobody's work,
 * so it can be turned off, and once it is off it has to be off everywhere.
 *
 * Matched on its image rather than its name: "buildkit" is convention and not
 * something Dermaga is owed. Somebody may have a container of their own by that
 * name, and it is theirs.
 */
export const BUILDER_IMAGE = 'ghcr.io/apple/container-builder-shim/';

export function isBuilder(container: Pick<Container, 'image'>): boolean {
  return container.image.startsWith(BUILDER_IMAGE);
}

/** The containers to show, given the setting. */
export function withoutHidden<T extends Pick<Container, 'image'>>(
  containers: T[],
  showBuilder: boolean
): T[] {
  return showBuilder ? containers : containers.filter((container) => !isBuilder(container));
}
