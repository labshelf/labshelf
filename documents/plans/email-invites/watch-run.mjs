#!/usr/bin/env node
// Follows the unattended run of the email-invites plan: the driver log as it is, and the newest session transcript
// (stream-json) condensed to one line per step (agent launched, command run, file edited, text, result).
// Usage: node documents/plans/email-invites/watch-run.mjs [--all]   (--all also prints the transcripts' earlier lines)
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
const dir = join(gitDir, "plan-runs", "email-invites");
const fromStart = process.argv.includes("--all");
const offsets = new Map();
const startedAt = Date.now();
const time = () => new Date().toTimeString().slice(0, 8);
const short = (text, max = 160) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function describeTool(block) {
  const input = block.input ?? {};
  if (block.name === "Agent") return `agent ${input.subagent_type ?? "general"}${input.model ? ` (${input.model})` : ""}: ${short(input.description, 80)}`;
  if (block.name === "Bash") return `$ ${short(input.description || input.command, 140)}`;
  if (["Edit", "Write", "Read"].includes(block.name)) return `${block.name.toLowerCase()} ${input.file_path ?? ""}`;
  return `${block.name} ${short(JSON.stringify(input), 100)}`;
}

function condense(line, source) {
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  const tag = event.parent_tool_use_id ? "  ↳" : "";
  if (event.type === "system" && event.subtype === "init") return `── ${source} started (${event.model ?? ""})`;
  if (event.type === "assistant") {
    return (event.message?.content ?? []).map((block) => {
      if (block.type === "tool_use") return `${tag} ▸ ${describeTool(block)}`;
      if (block.type === "text" && block.text.trim()) return `${tag} ✎ ${short(block.text)}`;
      return null;
    }).filter(Boolean).join("\n") || null;
  }
  if (event.type === "user") {
    const errors = (event.message?.content ?? []).filter((b) => b.type === "tool_result" && b.is_error);
    return errors.length ? errors.map((b) => `${tag} ✗ ${short(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 140)}`).join("\n") : null;
  }
  if (event.type === "result") return `── ${source} ended: ${event.subtype} · $${(event.total_cost_usd ?? 0).toFixed(2)} · ${Math.round((event.duration_ms ?? 0) / 60000)} min\n${short(event.result, 600)}`;
  return null;
}

function follow(file, raw) {
  const path = join(dir, file);
  const size = statSync(path).size;
  if (!offsets.has(file)) offsets.set(file, fromStart || raw || statSync(path).birthtimeMs > startedAt ? 0 : size);
  const start = offsets.get(file);
  if (size <= start) return;
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(size - start);
  readSync(fd, buffer, 0, buffer.length, start);
  closeSync(fd);
  const text = buffer.toString("utf8");
  const end = text.lastIndexOf("\n") + 1; // keep a partial last line for the next read
  offsets.set(file, start + Buffer.byteLength(text.slice(0, end)));
  for (const line of text.slice(0, end).split("\n").filter(Boolean)) {
    const out = raw ? line : condense(line, file.replace(/-\d{8}-\d{6}\.jsonl$|\.jsonl$/, ""));
    if (out) console.log(raw ? out : `${time()} ${out}`);
  }
}

function tick() {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs })).sort((a, b) => a.m - b.m);
  const driver = files.filter(({ f }) => f.startsWith("driver-")).pop();
  if (driver) follow(driver.f, true);
  const transcript = files.filter(({ f }) => f.endsWith(".jsonl")).pop();
  if (transcript) follow(transcript.f, false);
}

console.log(`following ${dir} (Ctrl-C to stop)`);
tick();
setInterval(tick, 2000);
