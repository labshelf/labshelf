// Opens the storage port for a project's device-local share state.
import * as path from 'node:path';
import { nodeCollabStorage } from '../../../../collab/node/state/index.js';
import { deviceLocalLayout } from '../../../node/index.js';

export function sharedProjectStorage(root: string, shareId: string) {
  if (!shareId || /[/\\\0]/.test(shareId) || shareId === '.' || shareId === '..') {
    throw new Error(`Invalid share id for project conflict scan: ${shareId}`);
  }
  return nodeCollabStorage({ dir: path.join(deviceLocalLayout(root).collabDir, shareId), shareId });
}
