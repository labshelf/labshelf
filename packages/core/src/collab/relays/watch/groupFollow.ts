// Keeps a client with its group: retries the earlier relays peers report using, and watches the other relays once its own socket opens.
import type { ILogger } from "../../../ports/index.js";
import type { RelayHolds } from "../relayHolds.js";
import type { RelayPresence } from "../relayPresence.js";
import type { WatchReports } from "./relayWatch.js";

const LOG_MODULE = "collab.relays";

export class GroupFollow {
  /** Relays peers were seen on that this client retried once for them; cleared when no peer reports the relay any more. */
  private readonly followed = new Set<string>();
  private connected: string | undefined;

  constructor(private presence: RelayPresence, private holds: RelayHolds, private logger: ILogger, private reports: WatchReports) {}

  /** A socket to `url` as the relay in use opened. */
  connectedTo(url: string): void { this.connected = url; }

  /**
   * A relay listed before the one in use that peers report using is retried at once, so a client that skipped it for a passing
   * failure joins the group within seconds; one that cannot use it holds it down by the usual rules, and its presence moves the group.
   */
  retryGroupRelays(urls: readonly string[], current: string | undefined, groupRelays: readonly (string | null)[], failing: Set<string>): void {
    const end = current === undefined ? urls.length : urls.indexOf(current);
    urls.slice(0, end < 0 ? urls.length : end).forEach((url) => {
      if (!groupRelays.includes(url) || this.holds.isDown(url)) { this.followed.delete(url); return; }
      if (this.followed.has(url)) { return; }
      this.followed.add(url);
      if (failing.delete(url)) { void this.logger.log("INFO", LOG_MODULE, "Retrying the relay peers use", { url }); }
    });
  }

  /** Until its socket to the relay in use opens, this client has not heard the peers there and cannot tell whether it is their watcher. */
  watchOthers(urls: readonly string[], current: string | undefined): void {
    const ready = current !== undefined && this.connected === current;
    this.presence.watch(ready ? urls.filter((url) => url !== current && !this.holds.isDown(url)) : [], this.reports);
  }
}
