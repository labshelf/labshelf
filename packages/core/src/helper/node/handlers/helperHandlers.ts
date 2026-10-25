// Declares the shape of a helper message handler, the map the dispatcher routes by and the error answer both read loops send.
import { PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "../../index.js";

/** Sends one message to the page; `payload` rides after the envelope on the socket (helper.md#transport). */
export type HelperSend = (message: ToPageMessage, payload?: Uint8Array) => void;
export type HelperHandler = (message: ToHelperMessage, send: HelperSend, payload?: Uint8Array) => Promise<void>;
export type HelperHandlers = Partial<Record<ToHelperMessage["type"], HelperHandler>>;

/** Answers message `id` with an error envelope. */
export type ErrorReply = (id: string, code: string, message: string) => void;

export const createErrorReply = (send: HelperSend): ErrorReply => (id, code, message) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });
