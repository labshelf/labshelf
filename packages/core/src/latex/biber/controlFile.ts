// Reads what running biber needs from a biblatex control file (.bcf): its format version and the data sources it lists.

export interface DataSource {
  /** The path as `\addbibresource` gave it. */
  path: string;
  /** `file` or `remote`; only files can be read without the network. */
  type: string;
}

export interface ControlFile {
  /** The `version` of `<bcf:controlfile>`, which pairs one biblatex release with one biber release. */
  version: string | undefined;
  dataSources: DataSource[];
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

const decodeXml = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, name: string) =>
    name.startsWith("#x") || name.startsWith("#X") ? String.fromCodePoint(parseInt(name.slice(2), 16))
      : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1)))
        : XML_ENTITIES[name.toLowerCase()] ?? "");

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];

export function parseControlFile(xml: string): ControlFile {
  const root = /<bcf:controlfile\b([^>]*)>/.exec(xml);
  const version = root ? attribute(root[1] ?? "", "version") : undefined;
  const dataSources = [...xml.matchAll(/<bcf:datasource\b([^>]*)>([^<]*)<\/bcf:datasource>/g)].map(([, attributes = "", body = ""]) => ({
    path: decodeXml(body.trim()), type: attribute(attributes, "type") ?? "file",
  }));
  // INVARIANT: biblatex lists a resource once per refsection that uses it; biber reads it once.
  const unique = dataSources.filter((source, index) => dataSources.findIndex((other) => other.path === source.path) === index);
  return { version: version === undefined ? undefined : decodeXml(version), dataSources: unique };
}
