// Validates device-local version journals before they influence project file writes.
import { sha256Hex } from '../../hash/index.js';
export interface VersionJournal { versions: Array<{ hash: string; text: string }>; pending?: string; known?: string }
export const textHash = (text: string): Promise<string> => sha256Hex(new TextEncoder().encode(text));

export async function parseVersionJournal(text: string): Promise<VersionJournal> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || !('versions' in value) || !Array.isArray(value.versions) || value.versions.length > 20) {
    throw new Error('Invalid project version journal');
  }
  for (const entry of value.versions) {
    if (!entry || typeof entry.hash !== 'string' || typeof entry.text !== 'string' || await textHash(entry.text) !== entry.hash) {
      throw new Error('Invalid project version text or hash');
    }
  }
  const pending = 'pending' in value ? value.pending : undefined;
  if (pending !== undefined && (typeof pending !== 'string' || !pending || /[/\\\0]/.test(pending) || pending === '.' || pending === '..')) {
    throw new Error('Invalid pending conflict path');
  }
  const known = 'known' in value ? value.known : undefined;
  if (known !== undefined && (typeof known !== 'string' || !value.versions.some(entry => entry.hash === known))) {
    throw new Error('Invalid latest project version');
  }
  return { versions: value.versions, ...(known === undefined ? {} : { known }), ...(pending === undefined ? {} : { pending }) };
}
