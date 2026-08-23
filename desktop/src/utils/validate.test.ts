import { describe, expect, it } from 'vitest';
import {
  absolutePath,
  containerName,
  count,
  envText,
  imageReference,
  port,
  registryHost,
  resourceName,
  size,
  subnet,
  user,
} from './validate';

// Every rule answers with a sentence or with null, and null is the only thing
// that means "carry on" -- so these tests are mostly about what is accepted.
describe('port', () => {
  it('takes a number in range', () => {
    expect(port('80', 'Host port')).toBeNull();
    expect(port('65535', 'Host port')).toBeNull();
  });

  it('says which port and why', () => {
    expect(port('', 'Host port')).toBe('Host port is required.');
    expect(port('http', 'Host port')).toBe('Host port must be a number.');
    expect(port('0', 'Host port')).toBe('Host port must be between 1 and 65535.');
    expect(port('70000', 'Container port')).toBe('Container port must be between 1 and 65535.');
  });
});

describe('absolutePath', () => {
  it('insists on a path from the root, because that is what a container resolves', () => {
    expect(absolutePath('/data', 'Target')).toBeNull();
    expect(absolutePath('data', 'Target')).toMatch(/must start with \//);
  });
});

describe('size', () => {
  it('takes the CLI’s own syntax, and nothing is not a mistake', () => {
    expect(size('512M', 'Memory')).toBeNull();
    expect(size('2g', 'Memory')).toBeNull();
    expect(size('1024', 'Memory')).toBeNull();
    expect(size('', 'Memory')).toBeNull();
  });

  it('rejects units the CLI does not know', () => {
    expect(size('512MB', 'Memory')).toMatch(/K, M, G or T/);
    expect(size('a lot', 'Memory')).toMatch(/K, M, G or T/);
  });

  // The runtime refuses under 200 MiB, but only after pulling the image.
  it('holds the floor the runtime would only mention later', () => {
    expect(size('100m', 'Memory', 200)).toMatch(/at least 200m/);
    expect(size('1g', 'Memory', 200)).toBeNull();
    expect(size('204800k', 'Memory', 200)).toBeNull();
  });

  // A machine's floor is a gibibyte, and saying "at least 1024m" to somebody
  // who typed 512M is arithmetic they should not have to do.
  it('says a floor in the unit it would be typed in', () => {
    expect(size('512M', 'Memory', 1024)).toBe(
      'Memory must be at least 1G — the runtime refuses anything smaller.'
    );
    expect(size('1G', 'Memory', 1024)).toBeNull();
    expect(size('2048m', 'Memory', 1024)).toBeNull();
  });
});

describe('count', () => {
  it('wants a whole number, at least one', () => {
    expect(count('4', 'CPUs')).toBeNull();
    expect(count('', 'CPUs')).toBeNull();
    expect(count('0', 'CPUs')).toBe('CPUs must be at least 1.');
    expect(count('2.5', 'CPUs')).toBe('CPUs must be a whole number.');
  });
});

describe('envText', () => {
  it('accepts what a shell would', () => {
    expect(envText('PATH=/usr/bin\nDEBUG=\nURL=postgres://a=b')).toBeNull();
    expect(envText('')).toBeNull();
  });

  it('names the line that is wrong', () => {
    expect(envText('PATH=/usr/bin\nBROKEN')).toBe('“BROKEN” must be KEY=value.');
    expect(envText('2FAST=yes')).toMatch(/not starting with a digit/);
    expect(envText('=orphan')).toBe('Every line needs a name before the =.');
  });
});

describe('containerName', () => {
  it('is happy with nothing, because the CLI will generate one', () => {
    expect(containerName('')).toBeNull();
  });

  it('takes a name that can also be a hostname', () => {
    expect(containerName('api-1')).toBeNull();
    expect(containerName('my_app.dev')).toBeNull();
  });

  it('refuses what the CLI refuses, in the CLI’s own terms', () => {
    expect(containerName('my api')).toBe('A name cannot contain spaces or slashes.');
    expect(containerName('team/api')).toBe('A name cannot contain spaces or slashes.');
    expect(containerName('-api')).toMatch(/beginning and ending/);
  });
});

describe('imageReference', () => {
  it('takes every ordinary shape', () => {
    expect(imageReference('redis')).toBeNull();
    expect(imageReference('redis:8-alpine')).toBeNull();
    expect(imageReference('ghcr.io/owner/name:1.2.3')).toBeNull();
    expect(imageReference('localhost:5050/api:dev')).toBeNull();
    expect(imageReference(`alpine@sha256:${'a'.repeat(64)}`)).toBeNull();
  });

  it('catches what a registry would reject later', () => {
    expect(imageReference('Redis')).toBe('An image name has to be lowercase.');
    expect(imageReference('redis:')).toBe('There is a colon with no tag after it.');
    expect(imageReference('my image')).toBe('A reference cannot contain spaces.');
    expect(imageReference('alpine@sha256:abc')).toMatch(/64 hexadecimal/);
  });
});

describe('resourceName', () => {
  it('is required, unlike a container’s', () => {
    expect(resourceName('', 'A name')).toBe('A name is required.');
    expect(resourceName('pgdata', 'A name')).toBeNull();
  });
});

describe('subnet', () => {
  it('takes a CIDR block and nothing else', () => {
    expect(subnet('192.168.80.0/24')).toBeNull();
    expect(subnet('')).toBeNull();
    expect(subnet('192.168.80.0')).toBe('A subnet looks like 192.168.80.0/24.');
    expect(subnet('300.1.1.0/24')).toBe('Each part of the address is 0 to 255.');
    expect(subnet('10.0.0.0/64')).toBe('The prefix after the / is 0 to 32.');
  });
});

describe('registryHost', () => {
  it('takes a host, with a port when there is one', () => {
    expect(registryHost('ghcr.io')).toBeNull();
    expect(registryHost('localhost:5050')).toBeNull();
  });

  it('turns away the URL people paste instead', () => {
    expect(registryHost('https://ghcr.io')).toMatch(/Leave off http/);
    expect(registryHost('ghcr.io/owner')).toBe('This is the host only, without a path.');
    expect(registryHost('')).toBe('A registry is required.');
  });
});

describe('user', () => {
  it('takes the three forms the CLI documents', () => {
    expect(user('root')).toBeNull();
    expect(user('1000')).toBeNull();
    expect(user('1000:1000')).toBeNull();
    expect(user('')).toBeNull();
    expect(user('1000:1000:1000')).toMatch(/name, a uid, or uid:gid/);
  });
});
