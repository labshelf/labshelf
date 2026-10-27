// Pins the per-device write record contract at the file boundary.
import { addWriteRecord, readWriteRecords, recordFor, createWriteRecordStore } from '../../../src/library/mutations/index';
import { MemoryLibraryFs } from '../../support/memoryLibraryFs';
import { fakeLogger } from '../../support/fakeLogger';

const a = '120d6638-719b-4905-a416-2c0e1516c146';
const b = '6436c119-7abc-4956-b0cf-f2344ee21d40';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const entry = (n = 1) => ({ path: 'src/main.tex', hash: hash(n), parent: null, by: 'mirror' as const, at: n });
const file = (id: string) => `/project/.labshelf/writes/${id}.json`;
let fs: MemoryLibraryFs;
let logger: ReturnType<typeof fakeLogger>;
beforeEach(() => { fs = new MemoryLibraryFs(); logger = fakeLogger(); });

it('round trips entries through only the writing device file', async () => {
  await addWriteRecord(fs, '/project', a, entry(), logger);
  const records = await readWriteRecords(fs, '/project', logger);
  expect(recordFor(records, 'src/main.tex', hash(1))).toEqual({ hash: hash(1), parent: null, by: 'mirror', at: 1 });
  expect(JSON.parse(await fs.readText(file(a)))).toEqual({ version: 1, files: { 'src/main.tex': [expect.objectContaining({ hash: hash(1) })] } });
  expect(fs.fileList()).toEqual([file(a)]);
});

it('keeps the newest 50 entries per path through concurrent appends', async () => {
  await Promise.all(Array.from({ length: 55 }, (_, i) => addWriteRecord(fs, '/project', a, entry(i), logger)));
  const records = await readWriteRecords(fs, '/project', logger);
  expect(records.get('src/main.tex')).toHaveLength(50);
  expect(recordFor(records, 'src/main.tex', hash(4))).toBeUndefined();
  expect(recordFor(records, 'src/main.tex', hash(54))).toBeDefined();
});

it.each(['{', '{"version":2,"files":{}}', '{"version":1,"files":{"../escape":[]}}', '{"version":1,"files":{"main.tex":[{"hash":"bad"}]}}'])('treats malformed data as empty with a warning: %s', async text => {
  await fs.writeText(file(a), text);
  expect((await readWriteRecords(fs, '/project', logger)).size).toBe(0);
  expect(logger.logs.some(log => log.level === 'WARN')).toBe(true);
});

it('merges two device files without writing the peer file', async () => {
  await addWriteRecord(fs, '/project', b, { ...entry(2), by: 'app', parent: hash(1) }, logger);
  const peer = await fs.readText(file(b));
  await addWriteRecord(fs, '/project', a, entry(), logger);
  const records = await readWriteRecords(fs, '/project', logger);
  expect(records.get('src/main.tex')).toHaveLength(2);
  expect(recordFor(records, 'src/main.tex', hash(2))?.parent).toBe(hash(1));
  expect(await fs.readText(file(b))).toBe(peer);
});

it('surfaces unreadable records rather than treating an I/O failure as empty', async () => {
  fs.unreadable.add('/project/.labshelf/writes');
  await fs.ensureDir('/project/.labshelf/writes');
  await expect(readWriteRecords(fs, '/project', logger)).rejects.toThrow('EACCES');
});

it('reports a listed record file read failure even when existence checks hide it', async () => {
  await addWriteRecord(fs, '/project', a, entry(), logger);
  jest.spyOn(fs, 'exists').mockResolvedValue(false);
  jest.spyOn(fs, 'readText').mockRejectedValue(Object.assign(new Error('record denied'), { code: 'EACCES' }));
  await expect(readWriteRecords(fs, '/project', logger)).rejects.toThrow('record denied');
  await expect(addWriteRecord(fs, '/project', a, entry(2), logger)).rejects.toThrow('record denied');
});

it('rejects a device id or path that escapes the folder', async () => {
  await expect(addWriteRecord(fs, '/project', '../escape', entry(), logger)).rejects.toThrow();
  await expect(addWriteRecord(fs, '/project', a, { ...entry(), path: '../escape' }, logger)).rejects.toThrow();
  expect(fs.fileList()).toEqual([]);
});

it('binds the device identity in the shared store factory', async () => {
  const store = createWriteRecordStore(fs, '/project', { id: async () => a }, logger);
  await store.append(entry());
  expect(recordFor(await store.read(), 'src/main.tex', hash(1))).toBeDefined();
});

it('serializes appends to different paths in the same device file', async () => {
  await Promise.all(['a.tex', 'b.tex'].map(path => addWriteRecord(fs, '/project', a, { ...entry(), path }, logger)));
  expect([...(await readWriteRecords(fs, '/project', logger)).keys()].sort()).toEqual(['a.tex', 'b.tex']);
});

it('retains mirror provenance when another writer records identical bytes', async () => {
  await addWriteRecord(fs, '/project', a, entry(), logger);
  await addWriteRecord(fs, '/project', b, { ...entry(), by: 'app' }, logger);
  expect(recordFor(await readWriteRecords(fs, '/project', logger), 'src/main.tex', hash(1))?.by).toBe('mirror');
});
