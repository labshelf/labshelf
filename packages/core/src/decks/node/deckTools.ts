// The seven deck tools of the MCP server over a project: rules, project context, list, read, create, edit and validate, with validated and confined writes.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { formatError } from "../../errors/index.js";
import type { McpTool } from "../../mcp/index.js";
import type { ILogger } from "../../ports/hostPorts.js";
import { nodeFileReads } from "../../writing/project/node/projectReads.js";
import type { ReadyProject } from "../../writing/project/projectEntry.js";
import {
  applyDeckEdit, checkDeckPath, deckRootOf, isDeckName, listDeckRules, listDeckSizePresets, listDecks, readProjectContext, scaffoldDeck, validateDeck,
  type DeckDiagnostic, type DeckEdit, type DeckPath, type ProjectContextRequest,
} from "../index.js";
import { ensureDeckFolder, listDeckFiles, locateDeck, readRegularText, sameContent, writeDeckFiles, type DeckFile, type DeckLocation } from "./deckFolder.js";
import {
  ToolRefusal, okResult, optionalAssets, optionalEdits, optionalString, refusalResult, requiredString, type DeckAsset,
} from "./deckToolArgs.js";
import { DECK_VOCABULARY } from "./deckVocabulary.js";

export interface DeckToolsDeps { logger: ILogger }

type Args = Record<string, unknown>;
type Properties = Record<string, unknown>;

const LOG_MODULE = "decks/tools";
const PATH_REFUSAL = "Decks live in talks/<name>/ or posters/<name>/ of the project.";
const NAME_REFUSAL = "A deck name is lower-case letters, digits and hyphens, starting with a letter or digit, at most 64 characters.";
const PARTS = ["outline", "section", "figures", "bibliography"] as const;

const DECK_PROPERTY = { type: "string", description: "The deck folder relative to the project, talks/<name> or posters/<name>." };
const ASSETS_PROPERTY = {
  type: "array",
  description: "Files for the deck folder, each at most 5 MB.",
  items: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to the deck folder, for example assets/plot.png." }, base64: { type: "string", description: "The file contents, base64 encoded." } },
    required: ["path", "base64"],
    additionalProperties: false,
  },
};
const EDITS_PROPERTY = {
  type: "array",
  description: "DeckEdit objects applied in order, each with a kind: move, resize, setText, moveSlide, addSlide, duplicateSlide, deleteSlide, addBlock, deleteBlock or setSize.",
  items: { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] },
};

interface StoredDeck { html: string; theme: string; files: string[] }

function deckPathOf(deck: string): DeckPath {
  const trimmed = deck.endsWith("/") ? deck.slice(0, -1) : deck;
  const parsed = checkDeckPath(trimmed);
  if (parsed === null || (parsed.inner !== "" && parsed.inner !== "deck.html")) throw new ToolRefusal(PATH_REFUSAL);
  return parsed;
}

async function readStored(location: DeckLocation): Promise<StoredDeck | undefined> {
  const html = await readRegularText(path.join(location.real, "deck.html"));
  if (html === undefined) return undefined;
  const theme = (await readRegularText(path.join(location.real, "theme.css"))) ?? "";
  return { html, theme, files: await listDeckFiles(location.real) };
}

async function requireStored(project: ReadyProject, deck: string): Promise<{ location: DeckLocation; stored: StoredDeck }> {
  const location = await locateDeck(project.folder, deckPathOf(deck));
  const stored = await readStored(location);
  if (stored === undefined) throw new ToolRefusal(`The deck ${location.relative} does not exist.`);
  return { location, stored };
}

/** Diagnostics of the deck as it will be stored; any error refuses the write with all of them. */
function checkedDiagnostics(html: string, theme: string, files: Iterable<string>): DeckDiagnostic[] {
  const diagnostics = validateDeck(html, { theme, files: new Set(files) });
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new ToolRefusal("The deck has errors, so nothing was written.", diagnostics);
  }
  return diagnostics;
}

const assetFiles = (assets: readonly DeckAsset[]): DeckFile[] => assets.map((asset) => ({ path: asset.path, data: asset.data }));

function rulesTool(): Promise<unknown> {
  return Promise.resolve({
    folders: ["talks/<name>/", "posters/<name>/"],
    vocabulary: DECK_VOCABULARY,
    presets: [...listDeckSizePresets("talk"), ...listDeckSizePresets("poster")],
    rules: listDeckRules(),
  });
}

function projectContext(project: ReadyProject, args: Args): Promise<unknown> {
  const part = requiredString(args, "part");
  if (!PARTS.some((candidate) => candidate === part)) throw new ToolRefusal(`The argument part must be one of ${PARTS.join(", ")}.`);
  const heading = optionalString(args, "heading");
  const cursor = optionalString(args, "cursor");
  const request: ProjectContextRequest = { part: part as ProjectContextRequest["part"], ...(heading === undefined ? {} : { heading }), ...(cursor === undefined ? {} : { cursor }) };
  return readProjectContext(nodeFileReads, project, request);
}

async function readDeck(project: ReadyProject, args: Args): Promise<unknown> {
  const { location, stored } = await requireStored(project, requiredString(args, "deck"));
  const diagnostics = validateDeck(stored.html, { theme: stored.theme, files: new Set(stored.files) });
  return { deck: location.relative, html: stored.html, theme: stored.theme, files: stored.files, diagnostics };
}

async function createDeck(project: ReadyProject, args: Args): Promise<unknown> {
  const name = requiredString(args, "name");
  const kind = requiredString(args, "kind");
  if (kind !== "talk" && kind !== "poster") throw new ToolRefusal('The argument kind must be "talk" or "poster".');
  if (!isDeckName(name)) throw new ToolRefusal(NAME_REFUSAL);
  const givenHtml = optionalString(args, "html");
  const givenTheme = optionalString(args, "theme");
  const assets = optionalAssets(args) ?? [];
  const location = await locateDeck(project.folder, { kind, name, folder: `${deckRootOf(kind)}/${name}`, inner: "" });
  if ((await fs.lstat(path.join(location.real, "deck.html")).catch(() => undefined)) !== undefined) {
    throw new ToolRefusal(`The deck ${location.relative} already exists.`);
  }
  const scaffold = scaffoldDeck(kind, name);
  const html = givenHtml ?? scaffold.html;
  const theme = givenTheme ?? scaffold.theme;
  const files = new Set([...(await listDeckFiles(location.real)), "theme.css", ...assets.map((asset) => asset.path)]);
  const diagnostics = checkedDiagnostics(html, theme, files);
  await ensureDeckFolder(location);
  await writeDeckFiles(location.real, [...assetFiles(assets), { path: "theme.css", data: theme }, { path: "deck.html", data: html }]);
  return { ok: true, deck: location.relative, diagnostics };
}

function applyEdits(html: string, edits: readonly DeckEdit[]): string {
  let current = html;
  for (const edit of edits) {
    const step = applyDeckEdit(current, edit);
    if (!step.ok) throw new ToolRefusal(step.error);
    current = step.html;
  }
  return current;
}

async function editDeck(project: ReadyProject, args: Args): Promise<unknown> {
  const deck = requiredString(args, "deck");
  const givenHtml = optionalString(args, "html");
  const edits = optionalEdits(args);
  const givenTheme = optionalString(args, "theme");
  const assets = optionalAssets(args);
  if (givenHtml === undefined && edits === undefined && givenTheme === undefined && assets === undefined) {
    throw new ToolRefusal("Give at least one of html, edits, theme or assets.");
  }
  const { location, stored } = await requireStored(project, deck);
  const html = applyEdits(givenHtml ?? stored.html, edits ?? []);
  const theme = givenTheme ?? stored.theme;
  const files = new Set([...stored.files, "theme.css", ...(assets ?? []).map((asset) => asset.path)]);
  const diagnostics = checkedDiagnostics(html, theme, files);
  const candidates: DeckFile[] = [...assetFiles(assets ?? [])];
  if (givenTheme !== undefined || html !== stored.html) candidates.push({ path: "theme.css", data: theme }, { path: "deck.html", data: html });
  const changed: DeckFile[] = [];
  for (const file of candidates) {
    if (file.path === "theme.css" && givenTheme === undefined) continue;
    if (!(await sameContent(path.join(location.real, ...file.path.split("/")), file.data))) changed.push(file);
  }
  await writeDeckFiles(location.real, changed);
  return { ok: true, deck: location.relative, diagnostics };
}

async function validateTool(project: ReadyProject, args: Args): Promise<unknown> {
  const deck = optionalString(args, "deck");
  const html = optionalString(args, "html");
  const theme = optionalString(args, "theme");
  if (deck === undefined && html === undefined) throw new ToolRefusal("Give deck or html.");
  const stored = deck === undefined ? undefined : (await requireStored(project, deck)).stored;
  if (html === undefined && stored !== undefined) {
    return { diagnostics: validateDeck(stored.html, { theme: theme ?? stored.theme, files: new Set(stored.files) }) };
  }
  const options = { ...(theme === undefined ? {} : { theme }), ...(stored === undefined ? {} : { files: new Set(stored.files) }) };
  return { diagnostics: validateDeck(html ?? "", options) };
}

/** The seven deck tools in order; each answers one JSON text and refuses a bad call with {ok: false} and isError. */
export function createDeckTools(project: ReadyProject, deps: DeckToolsDeps): McpTool[] {
  function tool(name: string, description: string, properties: Properties, required: string[], run: (args: Args) => Promise<unknown> | unknown): McpTool {
    return {
      name,
      description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      async call(args) {
        try {
          return okResult(await run(args));
        } catch (error) {
          if (error instanceof ToolRefusal) return refusalResult(error);
          await deps.logger.error(LOG_MODULE, error, { tool: name });
          return refusalResult(new ToolRefusal(formatError(error)));
        }
      },
    };
  }
  return [
    tool("deck_rules", "Returns the deck folders, the deck vocabulary, the size presets and every validation rule; call it before writing a deck.", {}, [], () => rulesTool()),
    tool("project_context", "Reads the project's outline, one section by heading, figure files or bibliography entries as pages of at most 64 KB.", {
      part: { type: "string", enum: [...PARTS], description: "What to read." },
      heading: { type: "string", description: "The heading of the section to read, for part section." },
      cursor: { type: "string", description: "The cursor of the previous page, to read the next one." },
    }, ["part"], (args) => projectContext(project, args)),
    tool("deck_list", "Lists the project's decks, talks then posters.", {}, [], async () => ({ decks: await listDecks(nodeFileReads, project.folder) })),
    tool("deck_read", "Returns a deck's html, theme.css, file list and validation diagnostics.", { deck: DECK_PROPERTY }, ["deck"], (args) => readDeck(project, args)),
    tool("deck_create", "Creates a talk or poster deck, a scaffold when html is absent, after validating it; errors refuse the write.", {
      name: { type: "string", description: "The deck name: lower-case letters, digits and hyphens." },
      kind: { type: "string", enum: ["talk", "poster"], description: "Whether the deck is a talk or a poster." },
      html: { type: "string", description: "The deck.html contents; the scaffold when absent." },
      theme: { type: "string", description: "The theme.css contents; the scaffold theme when absent." },
      assets: ASSETS_PROPERTY,
    }, ["name", "kind"], (args) => createDeck(project, args)),
    tool("deck_edit", "Changes an existing deck with a new html, a list of edits, a new theme or assets, after validating the result; errors refuse the write.", {
      deck: DECK_PROPERTY,
      html: { type: "string", description: "The new deck.html contents." },
      edits: EDITS_PROPERTY,
      theme: { type: "string", description: "The new theme.css contents." },
      assets: ASSETS_PROPERTY,
    }, ["deck"], (args) => editDeck(project, args)),
    tool("deck_validate", "Returns the diagnostics of the given html (with the theme when given) or of a stored deck, and never writes.", {
      deck: DECK_PROPERTY,
      html: { type: "string", description: "The deck.html contents to check." },
      theme: { type: "string", description: "The theme.css contents to check with the html." },
    }, [], (args) => validateTool(project, args)),
  ];
}
