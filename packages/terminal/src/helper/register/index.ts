// Exports registration of LabShelf Helper as a native-messaging host.
export { HELPER_ALLOWED_ORIGINS } from "./allowedOrigins.js";
export { buildHostManifest } from "./hostManifest.js";
export { registerHelper, unregisterHelper } from "./registerHelper.js";
export type { RegisterDeps, RegResult } from "./registerTypes.js";
