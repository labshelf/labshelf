// Exports VS Code's runtime-neutral side of linked outputs: the source host's shape, one project's files, sources and watcher, and the native editor's hover, lenses and commands.
export { openProjectOutputs, type OutputSourceHost, type ProjectOutputs } from "./projectOutputs.js";
export { LINK_OUTPUT_COMMAND, registerOutputLinks, type OutputCommandDeps } from "./outputCommands.js";
