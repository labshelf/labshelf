// Declares the shape of a helper message handler and the map the dispatcher routes by.
import type { ToHelperMessage, ToPageMessage } from "../../index.js";

export type HelperSend = (message: ToPageMessage) => void;
export type HelperHandler = (message: ToHelperMessage, send: HelperSend) => Promise<void>;
export type HelperHandlers = Partial<Record<ToHelperMessage["type"], HelperHandler>>;
