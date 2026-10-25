// Reloads Spaces when library files change outside the page.
import type { ILogger } from '@labshelf/core';
import { bx } from '../platform';
import { onPaperRecordsRebuilt } from '../storage';

export function watchSpaces(reload: () => Promise<void>, logger: ILogger): () => void {
  const run = (): void => { void reload().catch((error: unknown) => logger.error('spaces', error, { action: 'reloadSpaces' })); };
  const visible = (): void => { if (document.visibilityState === 'visible') run(); };
  // PLATFORM: Runtime broadcasts must return synchronously so they do not answer another surface's request.
  const message = (raw: unknown): void => { if ((raw as { type?: unknown } | null)?.type === 'library.changed') run(); };
  const stopRebuilt = onPaperRecordsRebuilt(run);
  document.addEventListener('visibilitychange', visible);
  bx.runtime.onMessage.addListener(message);
  return () => {
    stopRebuilt();
    document.removeEventListener('visibilitychange', visible);
    bx.runtime.onMessage.removeListener(message);
  };
}
