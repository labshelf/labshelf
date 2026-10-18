// Runs the non-interactive library subcommands (ls, search, show, add, bib, open, status, tag, mv, copy), handing other words to the project commands:
// each opens the library through the same composition root as the TUI and writes plain text or --json to stdout.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  paperComparator, papersUnder, type PaperEntry, type PaperRecord, type PaperStatus, type SortSpec,
} from "@labshelf/core";

import { isSortKey, type AppContext, type TerminalConfig } from "../app/index.js";
import { copyToClipboard } from "../platform/index.js";
import { fit, stringWidth } from "../tui/index.js";
import { STATUS_GLYPH } from "../ui/index.js";
import { stringFlag, type ParsedArgs } from "./args.js";
import { runOpen } from "./openCommand.js";
import { requirePaper } from "./paperLookup.js";
import { runProjectCommand } from "./project/index.js";
import { showText } from "./show/index.js";
import { Output, UsageError } from "./usage.js";

const STATUS_WORDS: Record<string, PaperStatus> = { unread: "unread", u: "unread", reading: "reading", r: "reading", done: "done", d: "done" };

function sortSpec(flags: ParsedArgs["flags"], config: TerminalConfig): SortSpec {
  const raw = stringFlag(flags, "sort") ?? config.terminal?.sort ?? "title";
  const reverse = raw.endsWith("!") || flags["reverse"] === true;
  const key = raw.replace(/!$/, "");
  return { key: isSortKey(key) ? key : "title", reverse };
}

function asJson(entry: PaperEntry): Record<string, unknown> {
  return { ...entry.record, collection: entry.collection, pdfBytes: entry.pdfBytes ?? null };
}

function table(entries: PaperEntry[], columns: number): string {
  const idWidth = Math.min(28, Math.max(4, ...entries.map((e) => stringWidth(e.record.id))));
  const titleWidth = Math.max(20, columns - idWidth - 12);
  return entries.map((e) => {
    const r = e.record;
    return `${STATUS_GLYPH[r.status]} ${String(r.year ?? "").padEnd(4)}  ${fit(r.id, idWidth)}  ${fit(r.title, titleWidth).trimEnd()}`;
  }).join("\n");
}

function requireCollection(ctx: AppContext, raw: string | undefined): string {
  const rel = (raw ?? "").replace(/^papers\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!ctx.store.collection(rel)) { throw new UsageError(`No collection "${raw}"`); }
  return rel;
}

/**
 * Runs one library command: computes the shared json/sort flags and dispatches to a
 * per-command function.
 * @returns the exit code
 */
export async function runLibraryCommand(ctx: AppContext, args: ParsedArgs, io: Output): Promise<number> {
  const { command, positionals, flags } = args;
  const json = flags["json"] === true;
  const sort = sortSpec(flags, ctx.config);
  switch (command) {
    case "ls": case "list": return runLs(ctx, positionals, flags, io, json, sort);
    case "search": case "find": return runSearch(ctx, positionals, io, json, sort);
    case "show": return runShow(ctx, positionals, io, json);
    case "add": case "import": return runAdd(ctx, positionals, flags, io);
    case "bib": case "bibtex": return runBib(ctx, positionals, flags, io, sort);
    case "open": return runOpen(ctx, positionals, io);
    case "status": return runStatus(ctx, positionals, io);
    case "tag": case "tags": return runTag(ctx, positionals, io);
    case "mv": return runMv(ctx, positionals, io);
    case "copy": return runCopy(ctx, positionals, io);
    default: return runProjectCommand(ctx, args, io);
  }
}

async function runLs(ctx: AppContext, positionals: string[], flags: ParsedArgs["flags"], io: Output, json: boolean, sort: SortSpec): Promise<number> {
  const rel = requireCollection(ctx, positionals[0]);
  if (flags["recursive"] === true || flags["all"] === true) {
    const papers = papersUnder(ctx.store.snapshot, rel).sort(paperComparator(sort));
    io.out(json ? JSON.stringify(papers.map(asJson), null, 2) : table(papers, io.columns));
    return 0;
  }
  const entries = ctx.store.listCollection(rel, { sort });
  if (json) {
    io.out(JSON.stringify(entries.map((e) => (e.kind === "paper"
      ? { kind: "paper", ...asJson(e.paper) }
      : { kind: "collection", path: e.node.rel, name: e.node.name, papers: e.node.total })), null, 2));
    return 0;
  }
  const lines = entries.filter((e) => e.kind === "collection").map((e) => (e.kind === "collection" ? `  ${e.node.name}/ (${e.node.total})` : ""));
  const papers = entries.flatMap((e) => (e.kind === "paper" ? [e.paper] : []));
  io.out([...lines, papers.length ? table(papers, io.columns) : ""].filter(Boolean).join("\n") || "(empty)");
  return 0;
}

async function runSearch(ctx: AppContext, positionals: string[], io: Output, json: boolean, sort: SortSpec): Promise<number> {
  // Highlights are indexed in the background; a one-shot search must not run before they are in.
  await ctx.annotationsReady;
  const query = positionals.join(" ");
  const results = ctx.store.search(query, sort);
  io.out(json ? JSON.stringify(results.map(asJson), null, 2) : results.length ? table(results, io.columns) : "No match.");
  return results.length ? 0 : 1;
}

async function runShow(ctx: AppContext, positionals: string[], io: Output, json: boolean): Promise<number> {
  const entry = requirePaper(ctx, positionals[0] ?? "");
  const data = await ctx.sidecars.load(entry.record.id);
  if (json) {
    io.out(JSON.stringify({ ...asJson(entry), annotations: data.annotations, reading: data.reading ?? null }, null, 2));
    return 0;
  }
  io.out(showText(entry, data.annotations.length, data.reading?.page));
  return 0;
}

async function runAdd(ctx: AppContext, positionals: string[], flags: ParsedArgs["flags"], io: Output): Promise<number> {
  if (!positionals.length) { throw new UsageError("add needs at least one PDF, folder, URL, DOI or arXiv id"); }
  const target = requireCollection(ctx, stringFlag(flags, "to"));
  const outcomes = await ctx.papers.importAny(positionals, target, (p) => io.err(`[${p.index}/${p.total}] ${p.input}`));
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "added") {
      io.out(`added  ${outcome.record.id}  ${outcome.record.title}${outcome.needsReview ? "  (metadata unconfirmed)" : ""}`);
    } else if (outcome.status === "duplicate") {
      io.out(`exists ${outcome.existingId}  (${outcome.input})`);
    } else if (outcome.status === "skipped") {
      failed++;
      io.err(`skipped ${outcome.input}`);
    } else {
      failed++;
      io.err(`failed ${outcome.input}: ${outcome.error}`);
    }
  }
  return failed ? 1 : 0;
}

async function runBib(ctx: AppContext, positionals: string[], flags: ParsedArgs["flags"], io: Output, sort: SortSpec): Promise<number> {
  let records: PaperRecord[];
  if (positionals.length) {
    records = positionals.map((id) => requirePaper(ctx, id).record);
  } else {
    records = papersUnder(ctx.store.snapshot, requireCollection(ctx, stringFlag(flags, "collection"))).sort(paperComparator(sort)).map((e) => e.record);
  }
  const text = ctx.papers.bibtexFor(records);
  const output = stringFlag(flags, "output");
  if (output) {
    await fs.writeFile(path.resolve(output), text);
    io.err(`${records.length} entries written to ${path.resolve(output)}`);
  } else {
    io.out(text.trimEnd());
  }
  return 0;
}

/** Prints each failed id and @returns the exit code: 1 when any failed. */
function reportFailures(failed: ReadonlyArray<{ id: string; error: string }>, io: Output): number {
  for (const failure of failed) { io.err(`${failure.id}: ${failure.error}`); }
  return failed.length ? 1 : 0;
}

async function runStatus(ctx: AppContext, positionals: string[], io: Output): Promise<number> {
  const word = positionals[positionals.length - 1] ?? "";
  const status = STATUS_WORDS[word.toLowerCase()];
  if (!status || positionals.length < 2) { throw new UsageError("Usage: labshelf status <id…> <unread|reading|done>"); }
  const ids = positionals.slice(0, -1).map((id) => requirePaper(ctx, id).record.id);
  const outcome = await ctx.papers.setStatus(ids, status);
  return reportFailures(outcome.failed, io);
}

async function runTag(ctx: AppContext, positionals: string[], io: Output): Promise<number> {
  const ids: string[] = [];
  const add: string[] = [];
  const remove: string[] = [];
  for (const token of positionals) {
    if (token.startsWith("+")) { add.push(token.slice(1)); } else if (token.startsWith("-")) { remove.push(token.slice(1)); } else { ids.push(requirePaper(ctx, token).record.id); }
  }
  if (!ids.length || (!add.length && !remove.length)) { throw new UsageError("Usage: labshelf tag <id…> +tag -tag"); }
  const outcome = await ctx.papers.editTags(ids, add, remove);
  return reportFailures(outcome.failed, io);
}

async function runMv(ctx: AppContext, positionals: string[], io: Output): Promise<number> {
  if (positionals.length < 2) { throw new UsageError("Usage: labshelf mv <id…> <collection>"); }
  const target = requireCollection(ctx, positionals[positionals.length - 1]);
  const ids = positionals.slice(0, -1).map((id) => requirePaper(ctx, id).record.id);
  const outcome = await ctx.papers.movePapers(ids, target);
  return reportFailures(outcome.failed, io);
}

async function runCopy(ctx: AppContext, positionals: string[], io: Output): Promise<number> {
  const entry = requirePaper(ctx, positionals[0] ?? "");
  await copyToClipboard(entry.record.citeKey);
  return 0;
}
