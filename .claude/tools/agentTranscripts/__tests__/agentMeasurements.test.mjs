// Pins the baseline, plan-read and report-size measurements per agent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { formatReport, parseTranscript } from '../index.mjs';
import { assistant, assistantSplit, tempDir, textBlock, toolResult, toolUseBlock, writeJsonl } from './transcriptFixtures.mjs';

const parse = (lines) => {
  const path = join(tempDir(), 't.jsonl');
  writeJsonl(path, lines);
  return parseTranscript(path);
};

test('baseline sums input, cache read and cache creation of the first assistant turn', () => {
  const stats = parse([
    assistantSplit('m1', { input: 3, cacheRead: 9000, cacheCreation: 2000 }),
    assistant('m2', 50_000),
  ]);
  assert.equal(stats.baseline, 11_003);
});

test('baseline uses the last streamed line of the first message and is 0 without turns', () => {
  const streamed = parse([
    assistantSplit('m1', { input: 1, cacheRead: 100, cacheCreation: 0 }),
    assistantSplit('m1', { input: 1, cacheRead: 100, cacheCreation: 400 }),
    assistant('m2', 9000),
  ]);
  assert.equal(streamed.baseline, 501);
  assert.equal(parse([{ type: 'user', message: { content: 'hi' } }]).baseline, 0);
});

test('planReads counts tool results of Read, Grep, Glob and Bash calls aimed at documents/plans/', () => {
  const stats = parse([
    assistant('m1', 100, [
      ['t1', 'Read', { file_path: '/repo/documents/plans/x/plan.md' }],
      ['t2', 'Grep', { pattern: 'S1', path: '/repo/documents/plans/x' }],
      ['t3', 'Glob', { pattern: '*.md', path: '/repo/documents/plans/' }],
      ['t4', 'Bash', { command: 'cat documents/plans/x/log.md' }],
      ['t5', 'Read', { file_path: '/repo/documents/contracts/sync.md' }],
      ['t6', 'Bash', { command: 'ls documents/' }],
      ['t7', 'Read', { file_path: '/repo/documents/plans/x/sessions/01.md' }],
    ]),
    ...['t1', 't2', 't3', 't4', 't5', 't6'].map((id) => toolResult(id, 'ok')),
  ]);
  // t7 has no result, so it is not counted.
  assert.equal(stats.planReads, 4);
});

test('planReads is 0 when nothing touches documents/plans/', () => {
  const stats = parse([assistant('m1', 100, [['t1', 'Read', { file_path: '/repo/a.ts' }]]), toolResult('t1', 'ok')]);
  assert.equal(stats.planReads, 0);
});

test('reportTokens estimates ceil(chars/4) of the final assistant message text', () => {
  const stats = parse([
    assistantSplit('m1', { input: 1, cacheRead: 0, cacheCreation: 10 }, [textBlock('thinking out loud '.repeat(50))]),
    assistantSplit('m2', { input: 1, cacheRead: 0, cacheCreation: 20 }, [textBlock('a'.repeat(9)), textBlock('b'.repeat(2))]),
  ]);
  assert.equal(stats.reportTokens, 3);
});

test('reportTokens prefers a SubagentHandback payload over the final text', () => {
  const stats = parse([
    assistantSplit('m1', { input: 1, cacheRead: 0, cacheCreation: 10 }, [toolUseBlock('h1', 'SubagentHandback', { message: 'r'.repeat(400) })]),
    toolResult('h1', 'ok'),
    assistantSplit('m2', { input: 1, cacheRead: 0, cacheCreation: 20 }, [textBlock('done')]),
  ]);
  assert.equal(stats.reportTokens, 100);
});

test('reportTokens is 0 when the transcript has no assistant text', () => {
  assert.equal(parse([assistant('m1', 100)]).reportTokens, 0);
});

test('formatReport prints baseline, plan reads and report tokens, with a dash for the main thread', () => {
  const stats = (extra) => ({ peak: 20_000, final: 20_000, turns: 3, toolCalls: [], repeatedReads: [], ...extra });
  const text = formatReport({
    main: stats({ baseline: 31_000, planReads: 5, reportTokens: 0 }),
    agents: [{ description: 'Scout', type: 'Explore', stats: stats({ baseline: 12_500, planReads: 2, reportTokens: 1500 }) }],
  });
  const [mainHead, agentHead] = text.split('\n').filter((line) => !line.startsWith('  '));
  assert.match(mainHead, /baseline 31\.0k/);
  assert.match(mainHead, /plan reads 5/);
  assert.match(mainHead, /report —/);
  assert.match(agentHead, /baseline 12\.5k/);
  assert.match(agentHead, /plan reads 2/);
  assert.match(agentHead, /report 1\.5k/);
});
