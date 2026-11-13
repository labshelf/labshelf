// Constants shared by the OCR message, handler and client tests.
import { PROTOCOL_VERSION } from "../../../src/helper/helperMessages.js";

export const ENV = (id: string) => ({ v: PROTOCOL_VERSION, id });
export const PNG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
export const TEX = { source: "texlive", year: 2026, complete: true } as const;
