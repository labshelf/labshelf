/**
 * Bundles monaco-vscode-api's non-script imports: stylesheets become their text with url() assets inlined, the form its
 * registerCss expects, and `new URL("<asset>", import.meta.url)` points at a copy of the asset in the output.
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const VSCODE_PACKAGE = /node_modules[\\/]@codingame[\\/]monaco-vscode-/;
const ASSET_URL = /\bnew\s+URL\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const ASSET_SUFFIX = "?labshelf-asset";
// Workers are separate entries the page names itself (workerEnvironment.ts), so their URLs stay untouched.
const SCRIPT = /\.(m?js|ts)$/;

async function stylesheetText(path) {
  const result = await build({
    entryPoints: [path], bundle: true, write: false, minify: true, logLevel: "silent",
    loader: { ".ttf": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".svg": "dataurl", ".png": "dataurl", ".gif": "dataurl" },
  });
  return result.outputFiles[0].text;
}

export const vscodeAssetsPlugin = {
  name: "labshelf-vscode-assets",
  setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async (args) => (VSCODE_PACKAGE.test(args.path) ? { contents: await stylesheetText(args.path), loader: "text" } : undefined));

    builder.onLoad({ filter: /\.js$/ }, async (args) => {
      if (!VSCODE_PACKAGE.test(args.path)) return undefined;
      const source = await readFile(args.path, "utf8");
      if (!source.includes("import.meta.url")) return undefined;
      const imports = [];
      const contents = source.replace(ASSET_URL, (match, _quote, rel) => {
        if (SCRIPT.test(rel)) return match;
        const name = `__labshelfAsset${imports.length}`;
        imports.push(`import ${name} from ${JSON.stringify(rel + ASSET_SUFFIX)};`);
        return `new URL(${name}, import.meta.url)`;
      });
      return imports.length ? { contents: `${imports.join("\n")}\n${contents}`, loader: "js" } : undefined;
    });

    builder.onResolve({ filter: /\?labshelf-asset$/ }, (args) => ({ path: resolve(dirname(args.importer), args.path.slice(0, -ASSET_SUFFIX.length)), namespace: "labshelf-asset" }));
    builder.onLoad({ filter: /.*/, namespace: "labshelf-asset" }, async (args) => ({ contents: await readFile(args.path), loader: "file" }));
  },
};
