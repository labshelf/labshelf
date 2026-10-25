// Presents shared wording for conflict-copy decisions.
import { deriveConflictResolutions, type ConflictCopy, type ConflictResolution } from './conflictCopy.js';

export type ConflictAskResolution = ConflictResolution | 'mergeMyself';
export interface ConflictAskChoice { resolution: ConflictAskResolution; label: string }
const labels: Record<ConflictAskResolution, string> = {
  keepMine: 'Keep mine', keepOther: 'Keep the other', keepBoth: 'Keep both',
  mergeAutomatically: 'Merge Automatically', mergeMyself: 'Merge Myself', notAVersion: 'Not a Version',
};
export function listConflictAskChoices(copy: ConflictCopy): ConflictAskChoice[] {
  const resolutions: ConflictAskResolution[] = deriveConflictResolutions(copy);
  if (copy.match === 'record' || copy.match === 'similar') resolutions.splice(1, 0, 'mergeMyself');
  return resolutions.map(resolution => ({ resolution, label: labels[resolution] }));
}
export function describeContentConflict(copy: ConflictCopy): string {
  const name = (file: string) => file.split(/[\\/]/).at(-1) ?? file;
  return `${name(copy.copy)} appeared in ${copy.owner.id} and looks like a version of ${name(copy.original)}.`;
}
