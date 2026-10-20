// Declares the shape of a helper message handler and the map the dispatcher routes by.
import type { ToHelperMessage, ToPageMessage } from "../../index.js";

/** Sends one message to the page; `payload` rides after the envelope on the socket (helper.md#transport). */
export type HelperSend = (message: ToPageMessage, payload?: Uint8Array) => void;
export type HelperHandler = (message: ToHelperMessage, send: HelperSend, payload?: Uint8Array) => Promise<void>;
export type HelperHandlers = Partial<Record<ToHelperMessage["type"], HelperHandler>>;
