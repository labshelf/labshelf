/** Fails a web build on any import of Node: `node:*`, a Node builtin, or a path through a `node/` folder; the error names the importer. */
import { builtinModules } from "node:module";

const builtins = new Set(builtinModules);
const NODE_FOLDER = /(^|\/)node(\/|$)/;

/** @returns why the specifier is Node-only, or undefined when it is not */
export function nodeImportReason(specifier) {
  if (specifier.startsWith("node:")) { return "a node: import"; }
  if (builtins.has(specifier) || builtins.has(specifier.split("/")[0])) { return "a Node builtin"; }
  if ((specifier.startsWith(".") || specifier.startsWith("@labshelf/")) && NODE_FOLDER.test(specifier)) { return "a node/ folder"; }
  return undefined;
}

export const noNodePlugin = {
  name: "no-node",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const reason = nodeImportReason(args.path);
      if (!reason) { return undefined; }
      return { errors: [{ text: `The web build imports ${reason}: "${args.path}" from ${args.importer}` }] };
    });
  },
};
