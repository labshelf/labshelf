// Persists a stable random identity per library outside its synced folder.
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ILogger } from '../../../ports/index.js';
import { DEVICE_ID, type DeviceIdentity } from '../../writeRecords/index.js';
import type { DeviceLocalLayout } from './deviceLocalLayout.js';

async function storedId(file: string): Promise<string> {
  const id = (await readFile(file, 'utf8')).trim();
  if (!DEVICE_ID.test(id)) { throw new Error(`Invalid device identity at ${file}`); }
  return id;
}

async function loadIdentity(file: string, logger: ILogger): Promise<string> {
  try { return await storedId(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
  const id = randomUUID();
  const temporary = `${file}.${id}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, `${id}\n`, { flag: 'wx', mode: 0o600 });
  try {
    // INVARIANT: linking publishes complete bytes without replacing a concurrent creator's identity.
    try { await link(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; } }
  } finally { await unlink(temporary); }
  const persisted = await storedId(file);
  if (persisted === id) { await logger.log('INFO', 'library.deviceIdentity', 'Created a library device identity', { file }); }
  return persisted;
}

export function createDeviceIdentity(layout: Pick<DeviceLocalLayout, 'deviceIdPath'>, logger: ILogger): DeviceIdentity {
  let pending: Promise<string> | undefined;
  return { id: () => pending ??= loadIdentity(layout.deviceIdPath, logger).catch(async error => {
    pending = undefined;
    await logger.error('library.deviceIdentity', error, { file: layout.deviceIdPath });
    throw error;
  }) };
}
