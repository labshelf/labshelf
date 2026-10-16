// Defines the context-size budgets (in tokens) that flag an agent as too large.
export const BUDGETS = { main: 100_000, subagent: 60_000 };

// Context tokens an agent carries into a turn: everything the API read or cached for it.
export function contextOf(usage) {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}
