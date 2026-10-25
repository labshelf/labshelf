/** Lists the .bib files a LaTeX main file loads, without the generated bibliography. */

const BIBLIOGRAPHY_COMMAND = /\\(bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)\}/g;
const COMMENT = /(^|[^\\])%.*$/gm;

/** `generated` is the project's generated bibliography path, which is never a user file. */
export function listBibliographyFiles(mainText: string, generated: string): string[] {
  const code = mainText.replace(COMMENT, "$1");
  const paths = [...code.matchAll(BIBLIOGRAPHY_COMMAND)].flatMap((match) =>
    match[2]!.split(",").map((name) => name.trim()).filter(Boolean)
      .map((name) => (match[1] === "bibliography" && !name.endsWith(".bib") ? `${name}.bib` : name)));
  return [...new Set(paths)].filter((path) => path !== generated);
}
