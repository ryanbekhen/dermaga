import type { Container } from '../types';

/**
 * Where a container can actually be reached from this Mac.
 *
 * Every container on this runtime has an address of its own, so a port it
 * listens on is reachable whether or not anything was published to the host --
 * which is most of them. That makes "somewhere to click" a real offer rather
 * than a guess.
 *
 * The name is preferred over the address, and only when it carries a domain.
 * A container the runtime has put under a DNS domain is called
 * `redis.internal.`, and that domain is one the Mac has a resolver for; one
 * without is called plainly `buildkit`, which resolves nowhere. The dot is the
 * whole test, and it saves asking a second question about whether names are
 * registered.
 */
export function reachableAt(container: Container): string | null {
  const hostname = (container.hostname ?? '').replace(/\.$/, '');
  if (hostname.includes('.')) return hostname;

  // Addresses come from the runtime with their prefix on -- `192.168.64.12/24`
  // -- which is a network, not somewhere to knock. It was being printed whole.
  const address = container.interfaces?.[0]?.ipv4Address;
  if (address) return address.split('/')[0];

  return null;
}

/** The port number on its own, from "6379/tcp" or "6379". */
export function portNumber(port: string): string {
  return port.split('/')[0];
}

/** Whether a declared port is one a browser could open. */
export function isWeb(port: string): boolean {
  const [, protocol = 'tcp'] = port.split('/');
  return protocol.toLowerCase() === 'tcp';
}

/**
 * A URL for a port, guessing http.
 *
 * There is no way to know whether something speaks TLS from the outside, and
 * the overwhelming majority of what people run locally does not. A browser
 * that lands on the wrong one says so immediately, which is a better failure
 * than refusing to offer the link at all.
 */
export function urlFor(host: string, port: string): string {
  return `http://${host}:${portNumber(port)}`;
}
