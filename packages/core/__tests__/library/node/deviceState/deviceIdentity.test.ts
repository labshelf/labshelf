// Pins stable device identity across processes sharing a library state folder.
import { readFile, writeFile } from 'node:fs/promises';
import { createDeviceIdentity, createDeviceLocalLayout } from '../../../../src/library/node/index';
import { cleanupTempDirs, makeTempDir } from '../../../support/tempDirs';
import { fakeLogger } from '../../../support/fakeLogger';

afterEach(cleanupTempDirs);
it('creates one stable UUID per library, including concurrent first use', async () => {
  const state = await makeTempDir();
  const layout = createDeviceLocalLayout('/library', { XDG_STATE_HOME: state });
  const identities = Array.from({ length: 10 }, () => createDeviceIdentity(layout, fakeLogger()));
  const ids = await Promise.all(identities.map(identity => identity.id()));
  expect(new Set(ids).size).toBe(1);
  expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect((await readFile(layout.deviceIdPath, 'utf8')).trim()).toBe(ids[0]);
  expect(await createDeviceIdentity(layout, fakeLogger()).id()).toBe(ids[0]);
});
it('surfaces a corrupt device identity without overwriting it', async () => {
  const state = await makeTempDir();
  const layout = createDeviceLocalLayout('/library', { XDG_STATE_HOME: state });
  await createDeviceIdentity(layout, fakeLogger()).id();
  await writeFile(layout.deviceIdPath, 'invalid');
  await expect(createDeviceIdentity(layout, fakeLogger()).id()).rejects.toThrow('device identity');
  expect(await readFile(layout.deviceIdPath, 'utf8')).toBe('invalid');
});
