// Retries held copies when another process dismisses their content match.
import { watch } from 'node:fs';
import * as path from 'node:path';
import type { ILogger, MirrorDisk } from '@labshelf/core';

export function watchConflictDismissals(
  disk: MirrorDisk, file: string, candidates: ReadonlySet<string>, logger: ILogger,
): MirrorDisk {
  return { ...disk, watch: (onChange) => {
    const watcher = watch(path.dirname(file), (_event, name) => {
      if (name === null || name.toString() === path.basename(file)) candidates.forEach(onChange);
    });
    watcher.on('error', error => { void logger.error('collab.conflicts', error, { file }); });
    try {
      const stop = disk.watch?.(onChange);
      return () => { watcher.close(); stop?.(); };
    } catch (error) {
      watcher.close();
      throw error;
    }
  } };
}
