// Pins project copy detection independently of provider naming conventions.
import { detectProjectConflict } from '../../../src/library/conflicts/index';
import { deriveTextHash } from '../../../src/writing/conflict/index';

const original = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
const input = (text: string) => ({ projectId: 'p', path: 'main (1).tex', text, siblings: [{ path: 'main.tex', text: original }], records: new Map() });
it('finds an 80 percent similar unnamed copy', async () => {
  const text = original.replace('Line 8', 'Other 8').replace('Line 9', 'Other 9');
  expect(await detectProjectConflict(input(text))).toMatchObject({ original: 'main.tex', copy: 'main (1).tex', match: 'similar', tool: 'unknown' });
});
it('leaves a chapter with ten percent equal lines alone', async () => {
  expect(await detectProjectConflict(input(Array.from({ length: 10 }, (_, i) => i === 0 ? 'Line 0' : `Chapter ${i}`).join('\n')))).toBeUndefined();
});
it('matches a recorded hash regardless of similarity', async () => {
  const text = 'Unrelated recorded text';
  const records = new Map([['main.tex', [{ hash: await deriveTextHash(text), parent: null, by: 'app' as const, at: 1 }]]]);
  expect(await detectProjectConflict({ ...input(text), records })).toMatchObject({ match: 'record' });
});
it('dismisses exactly the offered content', async () => {
  const dismissed = [{ path: 'main (1).tex', hash: await deriveTextHash(original) }];
  expect(await detectProjectConflict({ ...input(original), dismissed })).toBeUndefined();
  expect(await detectProjectConflict({ ...input(`${original}\nAdditional`), dismissed })).toMatchObject({ match: 'similar' });
});
it('skips keep-both copies and non-text files', async () => {
  expect(await detectProjectConflict({ ...input(original), path: 'main (copy 1).tex' })).toBeUndefined();
  expect(await detectProjectConflict({ ...input(original), path: 'figure.pdf' })).toBeUndefined();
});
