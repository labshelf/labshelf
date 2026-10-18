// Names this device's user to collaborators, on their cursors and as the author of comments.
import * as os from "node:os";

export function userName(): string {
  try {
    return os.userInfo().username;
  } catch {
    // PLATFORM: userInfo throws for a user without a passwd entry, as in some containers.
    return "LabShelf user";
  }
}
