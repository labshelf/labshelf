/** Turns a registry record into plain metadata by dropping the registry-only flags. */
import type { ResolvedMetadata } from "../metadata/index.js";
import type { RegistryEntry } from "./registryMetadata.js";

export function derivePlainMetadata(record: RegistryEntry | undefined): ResolvedMetadata | undefined {
  if (!record) {
    return undefined;
  }
  const { isComponent: _isComponent, ...metadata } = record;
  return metadata;
}
