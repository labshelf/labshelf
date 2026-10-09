/** The browser's scripting API, found on whichever global the browser exposes it (webextension-polyfill omits it). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scriptingApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome?.scripting ?? (globalThis as any).browser?.scripting;
}
