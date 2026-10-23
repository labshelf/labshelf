// Presents shared wording for conflict-copy decisions.
import { conflictResolutions, type ConflictCopy, type ConflictResolution } from './conflictCopy.js';

export type ConflictPromptResolution = ConflictResolution | 'mergeMyself';
export interface ConflictPromptChoice { resolution: ConflictPromptResolution; label: string }
const labels: Record<ConflictPromptResolution, string> = {
  keepMine: 'Keep mine', keepOther: 'Keep the other', keepBoth: 'Keep both',
  mergeAutomatically: 'Merge Automatically', mergeMyself: 'Merge Myself', notAVersion: 'Not a Version',
};
export function conflictPromptChoices(copy: ConflictCopy): ConflictPromptChoice[] {
  const resolutions: ConflictPromptResolution[] = conflictResolutions(copy);
  if (copy.match === 'record' || copy.match === 'similar') resolutions.splice(1, 0, 'mergeMyself');
  return resolutions.map(resolution => ({ resolution, label: labels[resolution] }));
}
export function contentConflictMessage(copy: ConflictCopy): string {
  const name = (file: string) => file.split(/[\\/]/).at(-1) ?? file;
  return `${name(copy.copy)} appeared in ${copy.owner.id} and looks like a version of ${name(copy.original)}.`;
}
