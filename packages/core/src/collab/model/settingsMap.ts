/** Writes the shared settings into the index doc's settings map and reads them back. */

import type { Map as YMap } from "yjs";
import { SHARED_SETTING_KEYS, type SharedSettings } from "./sharedSettings.js";

/** Sets changed keys and deletes absent ones in one transaction; an unchanged key is left alone so no update is sent. */
export function writeSettingsMap(map: YMap<unknown>, shared: SharedSettings): void {
  const write = (): void => {
    for (const key of SHARED_SETTING_KEYS) {
      const value = shared[key];
      if (value === undefined) {
        if (map.has(key)) { map.delete(key); }
      } else if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
        map.set(key, value);
      }
    }
  };
  if (map.doc) { map.doc.transact(write); } else { write(); }
}

/**
 * Writes only the keys whose value in `shared` differs from `base`, the settings the map and the file last agreed on,
 * so a key another member changed meanwhile is left as they set it.
 */
export function writeSettingsChanges(map: YMap<unknown>, shared: SharedSettings, base: SharedSettings): void {
  const write = (): void => {
    for (const key of SHARED_SETTING_KEYS) {
      const value = shared[key];
      if (JSON.stringify(value) === JSON.stringify(base[key])) { continue; }
      if (value === undefined) { map.delete(key); } else { map.set(key, value); }
    }
  };
  if (map.doc) { map.doc.transact(write); } else { write(); }
}

/** The shared keys the map holds; keys outside the shared list (from a later version) are ignored. */
export function readSettingsMap(map: YMap<unknown>): SharedSettings {
  return Object.fromEntries(SHARED_SETTING_KEYS.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
}
