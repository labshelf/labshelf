// Opens the native host, says hello and, when the helper is ready, opens and authenticates the session socket.
import { HELPER_HOST_NAME, PROTOCOL_VERSION, type HelperState, type ToPageMessage } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import { isHostNotFound } from "../../platform";
import {
  HelperClosedError, HelperConnection, HelperVersionError, nativeChannel, openSocketChannel, statusFromReady, statusFromVersionError,
  type ConnectionHooks, type HelperPortFactory, type HelperWebSocketConstructor,
} from "./connection";

export interface HandshakeDeps {
  logger: ILogger;
  extensionVersion: string;
  origin: string;
  connectNative: HelperPortFactory;
  webSocket: HelperWebSocketConstructor;
}

export interface Handshake { status: HelperState; native?: HelperConnection; socket?: HelperConnection }

type Ready = Extract<ToPageMessage, { type: "ready" }>;
type Session = Extract<ToPageMessage, { type: "session" }>;

function failureReason(error: unknown): string | undefined {
  return error instanceof HelperClosedError ? error.reason : error instanceof Error ? error.message : undefined;
}

/** Settles with the ready message alone when the protocols differ, since no session follows it. */
function helloStep() {
  let ready: Ready | undefined;
  return (message: ToPageMessage): { done: { ready: Ready; session?: Session } } | undefined => {
    if (message.type === "ready") {
      ready = message;
      return message.protocol === PROTOCOL_VERSION ? undefined : { done: { ready } };
    }
    return message.type === "session" && ready ? { done: { ready, session: message } } : undefined;
  };
}

async function openSession(deps: HandshakeDeps, session: Session, hooks: ConnectionHooks): Promise<HelperConnection> {
  const channel = await openSocketChannel(`ws://127.0.0.1:${session.port}/`, deps.webSocket);
  const socket = new HelperConnection(channel, deps.logger, hooks);
  try {
    await socket.request({ type: "auth", token: session.token }, (m) => (m.type === "authed" ? { done: undefined } : undefined));
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

/** Only a ready helper keeps its connections. A missing host is a status, any other failure is logged and thrown. */
export async function handshake(deps: HandshakeDeps, hooks: ConnectionHooks & Required<Pick<ConnectionHooks, "onClose">>): Promise<Handshake> {
  let native: HelperConnection | undefined;
  try {
    native = new HelperConnection(nativeChannel(deps.connectNative()), deps.logger, { onClose: hooks.onClose });
    const { ready, session } = await native.request({ type: "hello", extensionVersion: deps.extensionVersion, origin: deps.origin }, helloStep());
    const status = statusFromReady(ready, PROTOCOL_VERSION);
    if (status.state !== "ready" || !session) {
      native.disconnect();
      return { status };
    }
    return { status, native, socket: await openSession(deps, session, hooks) };
  } catch (error) {
    native?.disconnect();
    if (error instanceof HelperVersionError) {
      await deps.logger.log("WARN", "browser.helper", "LabShelf Helper and this page speak different protocol versions", { helperProtocol: error.helperProtocol, pageProtocol: PROTOCOL_VERSION });
      return { status: statusFromVersionError(error, PROTOCOL_VERSION) };
    }
    if (!isHostNotFound(failureReason(error))) {
      await deps.logger.error("browser.helper", error, { step: "handshake", host: HELPER_HOST_NAME });
      throw error;
    }
    return { status: { state: "not-installed" } };
  }
}
