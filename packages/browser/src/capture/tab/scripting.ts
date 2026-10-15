/** Finds the browser's scripting API on whichever global exposes it. */
// PLATFORM: webextension-polyfill omits the scripting API.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scriptingApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome?.scripting ?? (globalThis as any).browser?.scripting;
}
