// Registers and unregisters both native hosts of the standalone helper binary with the user's browsers.
import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, installNativeHost, uninstallNativeHost, type NativeHostEnv } from "@labshelf/core/nativeHost/node";

import { bridgeAliasPath, createBridgeAlias, removeBridgeAlias } from "./bridgeAlias.js";

/** Returns the exit code: 1 when no browser got a manifest. */
export async function registerStandaloneHosts(env: NativeHostEnv, binaryPath: string): Promise<number> {
  const alias = await createBridgeAlias(binaryPath, env.platform);
  const helper = await installNativeHost(env, HELPER_HOST_SPEC, { kind: "binary", path: binaryPath });
  const bridge = await installNativeHost(env, BRIDGE_HOST_SPEC, { kind: "binary", path: alias });
  return helper.browsers.length + bridge.browsers.length > 0 ? 0 : 1;
}

/** Returns the exit code: 1 when a manifest could not be removed. */
export async function unregisterStandaloneHosts(env: NativeHostEnv, binaryPath: string): Promise<number> {
  const helper = await uninstallNativeHost(env, HELPER_HOST_SPEC, { kind: "binary", path: binaryPath });
  const bridge = await uninstallNativeHost(env, BRIDGE_HOST_SPEC, { kind: "binary", path: bridgeAliasPath(binaryPath, env.platform) });
  await removeBridgeAlias(binaryPath, env.platform);
  return helper.warnings.length + bridge.warnings.length > 0 ? 1 : 0;
}
