// Builds tiny transcript files in a temp directory for the transcript tests.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'agentTranscripts-'));

export const assistant = (id, context, toolUses = []) => ({
  type: 'assistant',
  message: {
    id,
    usage: { input_tokens: 2, cache_creation_input_tokens: context - 2, cache_read_input_tokens: 0, output_tokens: 5 },
    content: toolUses.map(([toolId, name, input]) => ({ type: 'tool_use', id: toolId, name, input })),
  },
});

export const toolResult = (toolId, content) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: toolId, content }] },
});

export function writeJsonl(path, lines) {
  writeFileSync(path, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n');
}

// Writes <dir>/<sessionId>.jsonl plus one subagent transcript and returns their paths.
export function writeSession(dir, sessionId, { mainContext, agentContext, agentId = 'abc' }) {
  const main = join(dir, `${sessionId}.jsonl`);
  const subagents = join(dir, sessionId, 'subagents');
  mkdirSync(subagents, { recursive: true });
  const agent = join(subagents, `agent-${agentId}.jsonl`);
  writeJsonl(main, [assistant('m1', mainContext)]);
  writeJsonl(agent, [assistant('a1', agentContext)]);
  writeFileSync(join(subagents, `agent-${agentId}.meta.json`), JSON.stringify({ description: 'Scout config', agentType: 'Explore' }));
  return { main, agent };
}

// An assistant turn whose usage splits the context across input, cache read and cache creation.
export const assistantSplit = (id, { input, cacheRead, cacheCreation }, content = []) => ({
  type: 'assistant',
  message: {
    id,
    usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation, output_tokens: 5 },
    content,
  },
});

export const textBlock = (text) => ({ type: 'text', text });
export const toolUseBlock = (id, name, input) => ({ type: 'tool_use', id, name, input });
