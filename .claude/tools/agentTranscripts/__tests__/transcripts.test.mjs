// Pins transcript parsing, session discovery and the token report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { findSessionTranscripts, formatReport, latestContext, parseTranscript } from '../index.mjs';
import { assistant, tempDir, toolResult, writeJsonl, writeSession } from './transcriptFixtures.mjs';

test('parseTranscript sizes turns, tool results and repeated reads', () => {
  const path = join(tempDir(), 't.jsonl');
  writeJsonl(path, [
    assistant('m1', 1000, [['t1', 'Read', { file_path: '/repo/a.ts' }]]),
    toolResult('t1', 'x'.repeat(400)),
    assistant('m2', 5000, [['t2', 'Read', { file_path: '/repo/a.ts' }], ['t3', 'Bash', { command: 'cd /repo && ls -la' }]]),
    // The same message streamed again: the last line replaces the earlier one.
    assistant('m2', 6000),
    toolResult('t2', [{ type: 'text', text: 'y'.repeat(800) }]),
    toolResult('t3', 'ok'),
    '{"type":"mystery"',
    { type: 'api-request', payload: 1 },
  ]);
  const stats = parseTranscript(path);
  assert.deepEqual([stats.turns, stats.peak, stats.final], [2, 6000, 6000]);
  assert.deepEqual(stats.toolCalls.map((c) => [c.tool, c.tokens]), [['Read', 100], ['Read', 200], ['Bash', 1]]);
  assert.equal(stats.toolCalls[2].summary, 'ls -la');
  assert.deepEqual(stats.repeatedReads, [{ path: '/repo/a.ts', count: 2 }]);
});

test('findSessionTranscripts resolves a session id and its subagents', () => {
  const dir = tempDir();
  const { main, agent } = writeSession(dir, 'sess-1', { mainContext: 10, agentContext: 20 });
  const found = findSessionTranscripts(main);
  assert.equal(found.main, main);
  assert.deepEqual(found.agents, [{ path: agent, description: 'Scout config', type: 'Explore' }]);
  assert.equal(findSessionTranscripts(join(dir, 'missing.jsonl'), dir), undefined);
});

test('formatReport lists main first, sorts subagents by peak and flags over-budget agents', () => {
  const stats = (peak) => ({ peak, final: peak, turns: 3, toolCalls: [{ tool: 'Bash', summary: 'ls', tokens: 900 }], repeatedReads: [] });
  const text = formatReport({
    main: stats(160_000),
    agents: [
      { description: 'small', type: 'Explore', stats: stats(20_000) },
      { description: 'large', type: 'implementer', stats: stats(70_000) },
      { description: 'mid', type: 'implementer', stats: stats(59_000) },
    ],
  });
  const heads = text.split('\n').filter((line) => !line.startsWith('  '));
  assert.deepEqual(heads.map((line) => line.split(' — ')[0]), ['main thread', 'implementer: large', 'implementer: mid', 'Explore: small']);
  assert.deepEqual(heads.map((line) => line.includes('OVER')), [true, true, false, false]);
});

test('latestContext reads the newest turn from a tail that starts mid-line', () => {
  const path = join(tempDir(), 't.jsonl');
  writeJsonl(path, [assistant('m1', 1111), { type: 'user', message: { content: 'z'.repeat(5000) } }, assistant('m2', 2222), '{"type":"assistant","message":{"usa']);
  assert.equal(latestContext(path, 600), 2222);
  assert.equal(latestContext(path), 2222);
});
