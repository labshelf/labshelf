// The language a LaTeX or Typst document declares (babel, polyglossia, `#set text`), as a BCP-47 tag of a spelling dictionary.
import type { SourceDeckFormat } from "../../decks/sourceDecks.js";
import { removeComments } from "../../latex/index.js";

/** `tag` is the dictionary code (null when the language has no dictionary), `name` its English name for the notice, `declared` whether the document says it. */
export interface DocumentLanguage {
  tag: string | null;
  name: string;
  declared: boolean;
}

const DEFAULT_LANGUAGE: DocumentLanguage = { tag: "en-US", name: "English", declared: false };

/** [babel/polyglossia names, tag (null without a dictionary), English name]. The first entry of a tag names it. */
const LANGUAGES: ReadonlyArray<readonly [readonly string[], string | null, string]> = [
  [["english", "english-us"], "en-US", "English"],
  [["american", "usenglish", "us", "usmax"], "en-US", "English (United States)"],
  [["british", "ukenglish", "english-gb", "en-gb", "uk"], "en-GB", "English (United Kingdom)"],
  [["australian", "english-au"], "en-AU", "English (Australia)"],
  [["canadian", "english-ca"], "en-CA", "English (Canada)"],
  [["newzealand"], "en-GB", "English (New Zealand)"],
  [["brazilian", "brazil", "portuguese-br", "brazilianportuguese", "portuges-br"], "pt-BR", "Portuguese (Brazil)"],
  [["portuguese", "portugues", "portuges", "europeanportuguese", "portuguese-pt"], "pt-PT", "Portuguese (Portugal)"],
  [["french", "francais", "frenchb", "acadian", "canadien"], "fr", "French"],
  [["german", "ngerman", "germanb", "deutsch"], "de", "German"],
  [["austrian", "naustrian"], "de-AT", "German (Austria)"],
  [["swissgerman", "nswissgerman", "swiss"], "de-CH", "German (Switzerland)"],
  [["spanish", "espanol"], "es", "Spanish"],
  [["mexican"], "es-MX", "Spanish (Mexico)"],
  [["italian"], "it", "Italian"],
  [["dutch"], "nl", "Dutch"],
  [["polish"], "pl", "Polish"],
  [["russian"], "ru", "Russian"],
  [["ukrainian"], "uk", "Ukrainian"],
  [["catalan"], "ca", "Catalan"],
  [["czech"], "cs", "Czech"],
  [["danish"], "da", "Danish"],
  [["swedish"], "sv", "Swedish"],
  [["norsk", "bokmal", "norwegian", "norwegian-bokmal"], "nb", "Norwegian (Bokmal)"],
  [["nynorsk", "norwegian-nynorsk"], "nn", "Norwegian (Nynorsk)"],
  [["finnish"], null, "Finnish"],
  [["greek", "monogreek"], "el", "Greek"],
  [["polutonikogreek", "ancientgreek"], "el-polyton", "Greek (polytonic)"],
  [["turkish"], "tr", "Turkish"],
  [["romanian"], "ro", "Romanian"],
  [["hungarian", "magyar"], "hu", "Hungarian"],
  [["bulgarian"], "bg", "Bulgarian"],
  [["breton"], "br", "Breton"],
  [["welsh"], "cy", "Welsh"],
  [["esperanto"], "eo", "Esperanto"],
  [["estonian"], "et", "Estonian"],
  [["basque"], "eu", "Basque"],
  [["farsi", "persian"], "fa", "Persian"],
  [["faroese"], "fo", "Faroese"],
  [["frisian"], "fy", "Frisian"],
  [["irish"], "ga", "Irish"],
  [["scottish"], "gd", "Scottish Gaelic"],
  [["galician"], "gl", "Galician"],
  [["hebrew"], "he", "Hebrew"],
  [["croatian"], "hr", "Croatian"],
  [["armenian"], "hy", "Armenian"],
  [["interlingua"], "ia", "Interlingua"],
  [["interlingue"], "ie", "Interlingue"],
  [["icelandic"], "is", "Icelandic"],
  [["georgian"], "ka", "Georgian"],
  [["korean"], "ko", "Korean"],
  [["latin"], "la", "Latin"],
  [["luxembourgish"], "lb", "Luxembourgish"],
  [["lithuanian"], "lt", "Lithuanian"],
  [["latvian"], "lv", "Latvian"],
  [["macedonian"], "mk", "Macedonian"],
  [["mongolian"], "mn", "Mongolian"],
  [["nepali"], "ne", "Nepali"],
  [["occitan"], "oc", "Occitan"],
  [["slovak"], "sk", "Slovak"],
  [["slovene", "slovenian"], "sl", "Slovenian"],
  [["serbian"], "sr", "Serbian"],
  [["turkmen"], "tk", "Turkmen"],
  [["vietnamese"], "vi", "Vietnamese"],
];

const BY_NAME = new Map<string, DocumentLanguage>();
const BY_TAG = new Map<string, DocumentLanguage>();
for (const [names, tag, name] of LANGUAGES) {
  const language: DocumentLanguage = { tag, name, declared: true };
  for (const alias of names) if (!BY_NAME.has(alias)) BY_NAME.set(alias, language);
  if (tag !== null && !BY_TAG.has(tag.toLowerCase())) BY_TAG.set(tag.toLowerCase(), language);
}

/** Babel and class options that are not languages. */
const NON_LANGUAGE_OPTIONS = new Set([
  "showlanguages", "strings", "activeacute", "activegrave", "noconfigs", "safe", "math", "bidi", "base", "silent",
  "provide", "provide*", "provide+", "hyphenmap", "keepshorthandsactive", "nocase", "onchar", "headfoot", "layout",
  "main", "import", "draft", "final", "ensureinfo",
]);

function known(name: string): DocumentLanguage | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

function optionList(options: string | undefined): string[] {
  if (options === undefined) return [];
  return options
    .replace(/\{[^}]*\}/g, "")
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

function declared(language: DocumentLanguage | undefined, raw: string): DocumentLanguage {
  return language ?? { tag: null, name: raw.trim(), declared: true };
}

/** The language of one babel option list: `main=` first, else the last bare option that is not a babel switch. */
function babelOptionsLanguage(options: string | undefined): DocumentLanguage | null {
  const list = optionList(options);
  const main = list.find((option) => /^main\s*=/.test(option));
  if (main !== undefined) return declared(known(main.slice(main.indexOf("=") + 1)), main.slice(main.indexOf("=") + 1));
  const bare = list.filter((option) => !option.includes("=") && !NON_LANGUAGE_OPTIONS.has(option.toLowerCase()));
  const last = bare[bare.length - 1];
  return last === undefined ? null : declared(known(last), last);
}

const USE_PACKAGE = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
const POLYGLOSSIA = /\\set(?:main|default)language\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
const DOCUMENT_CLASS_OPTIONS = /\\documentclass\s*\[([^\]]*)\]/;

function polyglossiaLanguage(code: string): DocumentLanguage | null {
  let result: DocumentLanguage | null = null;
  for (const match of code.matchAll(POLYGLOSSIA)) {
    const base = match[2]!;
    const variant = optionList(match[1])
      .map((option) => /^variant\s*=\s*(.*)$/.exec(option)?.[1]?.trim())
      .find((value) => value !== undefined);
    const refined = variant === undefined ? undefined : known(variant);
    result = declared(refined ?? known(base), base);
  }
  return result;
}

function latexLanguage(text: string): DocumentLanguage | null {
  const code = removeComments(text);
  let babel: DocumentLanguage | null = null;
  for (const match of code.matchAll(USE_PACKAGE)) {
    if (!match[2]!.split(",").some((name) => name.trim() === "babel")) continue;
    babel = babelOptionsLanguage(match[1]) ?? babel;
  }
  if (babel !== null) return babel;
  const polyglossia = polyglossiaLanguage(code);
  if (polyglossia !== null) return polyglossia;
  const classOptions = optionList(DOCUMENT_CLASS_OPTIONS.exec(code)?.[1])
    .filter((option) => !option.includes("="))
    .map(known)
    .filter((language) => language !== undefined);
  return classOptions[classOptions.length - 1] ?? null;
}

/** The text without Typst comments, strings kept. */
function stripTypstComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      out += " ";
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/** The argument text of the call whose `(` is at `open`. */
function callArguments(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const char = code[i]!;
    if (char === '"') {
      i++;
      while (i < code.length && code[i] !== '"') i += code[i] === "\\" ? 2 : 1;
    } else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

const TYPST_SET_TEXT = /#set\s+text\s*\(/g;

function typstLanguage(text: string): DocumentLanguage | null {
  const code = stripTypstComments(text);
  for (const match of code.matchAll(TYPST_SET_TEXT)) {
    const args = callArguments(code, match.index + match[0].length - 1);
    const lang = /\blang\s*:\s*"([A-Za-z-]+)"/.exec(args)?.[1];
    if (lang === undefined) continue;
    const region = /\bregion\s*:\s*"([A-Za-z]+)"/.exec(args)?.[1];
    const base = lang.toLowerCase();
    const raw = region === undefined ? lang : `${lang}-${region}`;
    if (region === undefined && base === "en") return BY_NAME.get("english")!;
    if (region === undefined && base === "pt") return BY_NAME.get("portuguese")!;
    const exact = BY_TAG.get(region === undefined ? base : `${base}-${region.toLowerCase()}`);
    if (exact !== undefined) return exact;
    const known = region === undefined ? undefined : BY_TAG.get(base);
    return declared(known, raw);
  }
  return null;
}

/** The language a source declares: babel (`main=`, else the last language option), polyglossia (with its `variant`) or `\documentclass` options for LaTeX, the first `#set text(lang:, region:)` for Typst; en-US, undeclared, when it says none. A name without a dictionary gives a null tag and its raw name. */
export function detectDocumentLanguage(format: SourceDeckFormat, text: string): DocumentLanguage {
  const found = format === "latex" ? latexLanguage(text) : typstLanguage(text);
  return found ?? DEFAULT_LANGUAGE;
}
