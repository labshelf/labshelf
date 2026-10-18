// Runs trystero's WebRTC handshake over node-datachannel in Node hosts, such as the VS Code extension host.
import type { DescriptionType } from "node-datachannel";
import type { RTCPeerConnection as PolyfillPeerConnection } from "node-datachannel/polyfill";

// Declared here: the polyfill's own types extend the DOM's, which Node builds do not load.
interface IceServerConfig { urls: string | string[]; username?: string | undefined; credential?: string | undefined }
interface PeerConnectionConfig { iceServers?: IceServerConfig[] | undefined }
type PolyfillConfig = ConstructorParameters<typeof PolyfillPeerConnection>[0];
type Description = PolyfillPeerConnection["localDescription"];

/** node-datachannel takes TURN credentials inside the URL: `turn:user:pass@host:port`. */
export function toNativeIceServers(servers: readonly IceServerConfig[]): string[] {
  return servers.flatMap((server) => [server.urls].flat().map((url) => {
    if (!server.username || typeof server.credential !== "string" || !url.startsWith("turn")) { return url; }
    const separator = url.indexOf(":");
    const credentials = `${encodeURIComponent(server.username)}:${encodeURIComponent(server.credential)}`;
    return `${url.slice(0, separator)}:${credentials}@${url.slice(separator + 1)}`;
  }));
}

/**
 * Loads node-datachannel and returns the peer connection class to pass trystero as `rtcPolyfill`.
 * The polyfill negotiates on its own as soon as a data channel is created, before trystero's
 * `negotiationneeded` handler exists, and then trystero never sends an offer; the class turns
 * that off and gives trystero the browser behaviour it relies on.
 */
export async function loadNodeRTCPeerConnection(): Promise<typeof PolyfillPeerConnection> {
  // PLATFORM: the native binary loads on first use, so a host where it is missing still activates everything else.
  const { PeerConnection } = await import("node-datachannel");
  const { RTCPeerConnection: Polyfill } = await import("node-datachannel/polyfill");
  return class NodeRTCPeerConnection extends Polyfill {
    // TRAP: an unreferenced native PeerConnection is collected and its destructor closes the connection.
    readonly #native: InstanceType<typeof PeerConnection>;

    constructor(config: PolyfillConfig & PeerConnectionConfig = {}) {
      const native = new PeerConnection("labshelf-peer", { iceServers: toNativeIceServers(config.iceServers ?? []), disableAutoNegotiation: true });
      super({ ...config, peerConnection: native });
      this.#native = native;
    }

    // trystero retries an offer only while there is no local description, which the polyfill never reports as null.
    override get localDescription(): Description {
      return this.#native.localDescription() ? super.localDescription : (null as unknown as Description);
    }

    override get remoteDescription(): Description {
      return this.#native.remoteDescription() ? super.remoteDescription : (null as unknown as Description);
    }

    // The polyfill ignores a call without a type, which perfect negotiation makes.
    override setLocalDescription(description?: { type?: DescriptionType }): Promise<void> {
      this.#native.setLocalDescription(description?.type ?? (this.signalingState === "have-remote-offer" ? "answer" : "offer"));
      return Promise.resolve();
    }
  };
}
