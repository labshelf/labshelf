// Exports the build options: the auto compile and halt-on-error settings, the include-only state and the options a preview shows and changes.
export { autoCompileGate, autoCompileMode, onAutoCompileChange } from "./autoCompile.js";
export { haltOnErrorOn } from "./haltOnError.js";
export { buildOptions, setAutoCompile, setEngine, setHaltOnError } from "./buildOptions.js";
export { IncludeOnlyState, type IncludeOnlyTarget } from "./includeOnly.js";
