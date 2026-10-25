// Tells whether a native-messaging failure means the native host is not installed.

// PLATFORM: Chrome says "Specified native messaging host not found."; Firefox says "No such native application <name>".
const NOT_FOUND = [/native messaging host not found/i, /no such native application/i];

export function isHostNotFound(reason: string | undefined): boolean {
  return reason !== undefined && NOT_FOUND.some((pattern) => pattern.test(reason));
}
