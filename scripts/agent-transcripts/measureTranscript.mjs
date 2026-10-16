// Measures an agent's starting context, plan-file reads and returned report size from parsed transcript lines.
import { contextOf } from './budgets.mjs';

const PLANS_DIR = 'documents/plans/';
const TARGET_FIELD = { Read: 'file_path', Grep: 'path', Glob: 'path', Bash: 'command' };

const blocksOf = (line) => (Array.isArray(line.message?.content) ? line.message.content : []);

function targetsPlans(item) {
  const field = TARGET_FIELD[item.name];
  const value = field ? item.input?.[field] : undefined;
  return typeof value === 'string' && value.includes(PLANS_DIR);
}

export function measureTranscript(lines) {
  // INVARIANT: Map keeps first-insertion order, so a re-set message id (streamed lines) stays at its original position.
  const contextByMessage = new Map();
  const textByMessage = new Map();
  const planCalls = new Set();
  let planReads = 0;
  let handback;

  for (const line of lines) {
    const message = line.message;
    if (line.type === 'assistant' && message) {
      if (message.usage && message.id) contextByMessage.set(message.id, contextOf(message.usage));
      for (const item of blocksOf(line)) {
        if (item.type === 'tool_use' && targetsPlans(item)) planCalls.add(item.id);
        if (item.type === 'tool_use' && item.name === 'SubagentHandback' && typeof item.input?.message === 'string') handback = item.input.message;
        if (item.type === 'text' && typeof item.text === 'string') textByMessage.set(message.id, (textByMessage.get(message.id) ?? '') + item.text);
      }
      if (message.id && !textByMessage.has(message.id)) textByMessage.set(message.id, '');
    } else if (line.type === 'user') {
      planReads += blocksOf(line).filter((item) => item.type === 'tool_result' && planCalls.has(item.tool_use_id)).length;
    }
  }

  const finalText = [...textByMessage.values()].at(-1) ?? '';
  return {
    baseline: [...contextByMessage.values()][0] ?? 0,
    planReads,
    reportTokens: Math.ceil((handback ?? finalText).length / 4),
  };
}
