import { describe, expect, it } from 'vitest';
import { isWeb, portNumber, reachableAt, urlFor } from './endpoint';
import type { Container } from '../types';

const container = (over: Partial<Container>): Container =>
  ({ id: 'x', name: 'x', image: 'x', status: 'running', ports: [], mounts: [], labels: {}, state: 'running', createdAt: '', ...over }) as Container;

describe('reachableAt', () => {
  it('prefers the name, when the runtime has put it under a domain', () => {
    expect(reachableAt(container({ hostname: 'redis.internal.' }))).toBe('redis.internal');
  });

  // A container with no DNS domain is called plainly "buildkit", which resolves
  // nowhere -- so its address is the only thing worth handing a browser.
  it('falls back to the address when the name is not a domain name', () => {
    const c = container({
      hostname: 'buildkit',
      interfaces: [{ network: 'default', ipv4Address: '192.168.64.9/24' }],
    });

    expect(reachableAt(c)).toBe('192.168.64.9');
  });

  // The prefix makes it a network rather than somewhere to knock, and it was
  // being printed whole in the Ports column.
  it('drops the prefix from an address', () => {
    const c = container({ interfaces: [{ network: 'default', ipv4Address: '192.168.64.12/24' }] });

    expect(reachableAt(c)).toBe('192.168.64.12');
  });

  it('answers nothing for a container that is not up', () => {
    expect(reachableAt(container({ hostname: '' }))).toBeNull();
  });
});

describe('a declared port', () => {
  it('is read apart from its protocol', () => {
    expect(portNumber('6379/tcp')).toBe('6379');
    expect(portNumber('80')).toBe('80');
  });

  it('is only worth a browser when it is tcp', () => {
    expect(isWeb('6379/tcp')).toBe(true);
    expect(isWeb('53/udp')).toBe(false);
    expect(isWeb('80')).toBe(true);
  });

  it('becomes a URL that guesses http', () => {
    expect(urlFor('redis.internal', '6379/tcp')).toBe('http://redis.internal:6379');
  });
});
