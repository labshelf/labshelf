// Registers the module hooks that let Node run core's TypeScript sources directly.
import { register } from "node:module";

register("./typeScriptHooks.mjs", import.meta.url);
