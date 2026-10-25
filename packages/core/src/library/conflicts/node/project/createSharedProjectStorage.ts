// Opens the storage port for a project's device-local share state.
import * as path from 'node:path';
import { createNodeCollabStorage } from '../../../../collab/node/deviceState/index.js';
import { createDeviceLocalLayout } from '../../../node/index.js';

export function createSharedProjectStorage(root: string, shareId: string) {
  if (!shareId || /[/\\\0]/.test(shareId) || shareId === '.' || shareId === '..') {
    throw new Error(`Invalid share id for project conflict scan: ${shareId}`);
  }
  return createNodeCollabStorage({ dir: path.join(createDeviceLocalLayout(root).collabDir, shareId), shareId });
}
