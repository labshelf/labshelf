// Sets or clears one optional string key on an entry while keeping every other key, known or not.
export function withOptionalField<T extends object>(entry: T, key: string, value: string | undefined): T {
  const { [key]: _removed, ...rest } = entry as Record<string, unknown>;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}
