// Reads one agent transcript (jsonl) into per-turn context sizes, tool-result sizes, Read counts and the measures of measureTranscript.
import { readFileSync } from 'node:fs';
import { contextOf } from './budgets.mjs';
import { measureTranscript } from './measureTranscript.mjs';

const SUMMARY_LENGTH = 60;

// The first string argument of a tool call is usually the part that identifies it.
function summarizeInput(tool, input = {}) {
  const key = { Bash: 'command', Read: 'file_path', Edit: 'file_path', Write: 'file_path', Grep: 'pattern', Glob: 'pattern' }[tool];
  const value = key ? input[key] : Object.values(input).find((v) => typeof v === 'string');
  // The leading `cd <dir> &&` is on nearly every Bash call and says nothing about it.
  return String(value ?? '').replace(/^cd \S+ && /, '').replace(/\s+/g, ' ').slice(0, SUMMARY_LENGTH);
}

function resultChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0);
}

function parseLines(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // Unknown or truncated lines are skipped: the transcript format is internal.
    }
  }
  return lines;
}

export function parseTranscript(path) {
  // INVARIANT: a streamed assistant message is written as several lines sharing one message.id; the last line wins.
  const contextByMessage = new Map();
  const pending = new Map();
  const toolCalls = [];
  const reads = new Map();

  const lines = parseLines(readFileSync(path, 'utf8'));
  for (const line of lines) {
    const message = line.message;
    if (line.type === 'assistant' && message) {
      if (message.usage && message.id) contextByMessage.set(message.id, contextOf(message.usage));
      for (const item of Array.isArray(message.content) ? message.content : []) {
        if (item.type !== 'tool_use') continue;
        pending.set(item.id, { tool: item.name, summary: summarizeInput(item.name, item.input) });
        if (item.name === 'Read' && item.input?.file_path) reads.set(item.input.file_path, (reads.get(item.input.file_path) ?? 0) + 1);
      }
    } else if (line.type === 'user' && Array.isArray(message?.content)) {
      for (const item of message.content) {
        const call = item.type === 'tool_result' ? pending.get(item.tool_use_id) : undefined;
        if (!call) continue;
        const chars = resultChars(item.content);
        toolCalls.push({ ...call, chars, tokens: Math.round(chars / 4) });
      }
    }
  }

  const contexts = [...contextByMessage.values()];
  return {
    turns: contexts.length,
    peak: Math.max(0, ...contexts),
    final: contexts.at(-1) ?? 0,
    toolCalls,
    ...measureTranscript(lines),
    repeatedReads: [...reads].filter(([, count]) => count > 1).map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
  };
}
