#!/usr/bin/env node
// Prints how many tokens each agent of a Claude Code session used: node scripts/agent-tokens.mjs [session-id|path]
import { findSessionTranscripts, formatReport, parseTranscript } from './agent-transcripts/index.mjs';

const found = findSessionTranscripts(process.argv[2]);
if (!found) {
  console.error('No session transcript found. Pass a session id or a .jsonl path.');
  process.exit(1);
}
const report = {
  main: parseTranscript(found.main),
  agents: found.agents.map((agent) => ({ ...agent, stats: parseTranscript(agent.path) })),
};
console.log(formatReport(report));
