// Decodes raw xterm/VT input (CSI/SS3 keys, SGR mouse, bracketed paste) into key, paste and mouse events.
// Each key becomes a short id the keymap binds against: "j", "C-d", "M-x", "enter", "esc", "S-tab", "space".

export interface KeyEvent {
  type: "key";
  /** Normalized id used by keymaps, e.g. "j", "C-d", "up", "enter". */
  id: string;
  /** The printable text this key inserts in a text field, if any. */
  text?: string;
}

export interface PasteEvent {
  type: "paste";
  text: string;
}

export interface MouseEvent {
  type: "mouse";
  kind: "down" | "up" | "wheel-up" | "wheel-down" | "drag";
  button: number;
  /** 0-based cell coordinates. */
  x: number;
  y: number;
}

export type InputEvent = KeyEvent | PasteEvent | MouseEvent;

const CSI_TILDE: Record<string, string> = {
  "1": "home", "2": "insert", "3": "delete", "4": "end", "5": "pageup", "6": "pagedown", "7": "home", "8": "end",
  "11": "f1", "12": "f2", "13": "f3", "14": "f4", "15": "f5", "17": "f6", "18": "f7", "19": "f8", "20": "f9",
  "21": "f10", "23": "f11", "24": "f12",
};

const CSI_LETTER: Record<string, string> = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4", Z: "S-tab",
};

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// xterm modifier parameter: 1 + (shift 1 | alt 2 | ctrl 4).
function withModifiers(name: string, param: string | undefined): string {
  const mod = param ? Number(param) - 1 : 0;
  if (!Number.isFinite(mod) || mod <= 0) { return name; }
  let prefix = "";
  if (mod & 4) { prefix += "C-"; }
  if (mod & 2) { prefix += "M-"; }
  if (mod & 1 && name !== "S-tab") { prefix += "S-"; }
  return prefix + name;
}

function controlKey(code: number): KeyEvent {
  switch (code) {
    // Raw mode delivers Enter as CR; LF is Ctrl-J, which pickers use to move down.
    case 0x0d: return { type: "key", id: "enter" };
    case 0x09: return { type: "key", id: "tab" };
    case 0x7f: case 0x08: return { type: "key", id: "backspace" };
    case 0x1b: return { type: "key", id: "esc" };
    case 0x00: return { type: "key", id: "C-space" };
    default:
      if (code >= 0x01 && code <= 0x1a) { return { type: "key", id: "C-" + String.fromCharCode(code + 0x60) }; }
      return { type: "key", id: "C-" + String.fromCharCode(code + 0x40).toLowerCase() };
  }
}

function printableKey(ch: string): KeyEvent {
  return { type: "key", id: ch === " " ? "space" : ch, text: ch };
}

/**
 * Stateful decoder. Sequences split across reads are held until the rest arrives (or flushed as plain keys after a
 * short timeout by the caller via flush()).
 */
export class InputDecoder {
  private pending = "";
  private pasting: string | undefined;

  /**
   * Decodes one chunk of input.
   * @returns the complete events found; incomplete trailing sequences stay pending
   */
  feed(chunk: string): InputEvent[] {
    const data = this.pending + chunk;
    this.pending = "";
    const events: InputEvent[] = [];
    let i = 0;
    while (i < data.length) {
      const next = this.pasting !== undefined ? this.feedPaste(data, i, events) : this.feedKey(data, i, events);
      if (next === undefined) { return events; }
      i = next;
    }
    return events;
  }

  // The feed* steps return the next index, or undefined once the rest of the chunk is held in `pending`.
  private feedPaste(data: string, i: number, events: InputEvent[]): number | undefined {
    const end = data.indexOf(PASTE_END, i);
    if (end < 0) {
      // The end marker may arrive split across reads: hold back a trailing partial marker.
      let keep = 0;
      for (let n = Math.min(PASTE_END.length - 1, data.length - i); n > 0; n--) {
        if (PASTE_END.startsWith(data.slice(data.length - n))) {
          keep = n;
          break;
        }
      }
      this.pasting += data.slice(i, data.length - keep);
      this.pending = data.slice(data.length - keep);
      return undefined;
    }
    events.push({ type: "paste", text: this.pasting + data.slice(i, end) });
    this.pasting = undefined;
    return end + PASTE_END.length;
  }

  private feedKey(data: string, i: number, events: InputEvent[]): number | undefined {
    const ch = data[i]!;
    if (ch === "\x1b") { return this.feedEscape(data, i, events); }
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      events.push(controlKey(code));
      return i + 1;
    }
    const text = String.fromCodePoint(data.codePointAt(i)!);
    events.push(printableKey(text));
    return i + text.length;
  }

  // A lone ESC, an Alt-modified key, or the start of a CSI / SS3 sequence.
  private feedEscape(data: string, i: number, events: InputEvent[]): number | undefined {
    if (i + 1 >= data.length) {
      this.pending = data.slice(i);
      return undefined;
    }
    const next = data[i + 1]!;
    if (next === "[") {
      const parsed = this.parseCsi(data, i);
      if (parsed === "incomplete") {
        this.pending = data.slice(i);
        return undefined;
      }
      if (parsed.event) { events.push(parsed.event); }
      return parsed.end;
    }
    if (next === "O") {
      if (i + 2 >= data.length) {
        this.pending = data.slice(i);
        return undefined;
      }
      const name = CSI_LETTER[data[i + 2]!];
      if (name) { events.push({ type: "key", id: name }); }
      return i + 3;
    }
    if (next === "\x1b") {
      events.push({ type: "key", id: "esc" });
      return i + 1;
    }
    return this.feedAltKey(data, i, events);
  }

  private feedAltKey(data: string, i: number, events: InputEvent[]): number {
    const code = data[i + 1]!.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      events.push({ type: "key", id: "M-" + controlKey(code).id });
      return i + 2;
    }
    const text = String.fromCodePoint(data.codePointAt(i + 1)!);
    events.push({ type: "key", id: "M-" + (text === " " ? "space" : text) });
    return i + 1 + text.length;
  }

  /**
   * Emits whatever is pending as plain keys — a lone ESC typed by the user arrives without a follow-up byte.
   * @returns the flushed events
   */
  flush(): InputEvent[] {
    if (this.pasting !== undefined || !this.pending) { return []; }
    const pending = this.pending;
    this.pending = "";
    if (pending === "\x1b") { return [{ type: "key", id: "esc" }]; }
    // A truncated sequence: report ESC and decode the rest as typed text.
    return [{ type: "key", id: "esc" }, ...this.feed(pending.slice(1))];
  }

  /** @returns true while bytes are held waiting for the rest of a sequence */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  private parseCsi(data: string, start: number): "incomplete" | { event?: InputEvent; end: number } {
    if (data.startsWith(PASTE_START, start)) {
      this.pasting = "";
      return { end: start + PASTE_START.length };
    }
    if (PASTE_START.startsWith(data.slice(start)) && data.length - start < PASTE_START.length) {
      return "incomplete";
    }
    let j = start + 2;
    while (j < data.length) {
      const code = data.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) { break; }
      j++;
    }
    if (j >= data.length) { return "incomplete"; }
    const params = data.slice(start + 2, j);
    const final = data[j]!;
    const end = j + 1;

    if (params.startsWith("<") && (final === "M" || final === "m")) {
      const mouse = parseSgrMouse(params.slice(1), final === "M");
      return mouse ? { event: mouse, end } : { end };
    }
    if (final === "~") {
      const [code, mod] = params.split(";");
      const name = CSI_TILDE[code ?? ""];
      return name ? { event: { type: "key", id: withModifiers(name, mod) }, end } : { end };
    }
    const name = CSI_LETTER[final];
    const parts = params.split(";");
    // Keys carry no first parameter or "1" (then modifiers); anything else (a cursor-position report) is not a key.
    if (name && (parts[0] === "" || parts[0] === "1")) {
      return { event: { type: "key", id: withModifiers(name, parts[1]) }, end };
    }
    return { end };
  }
}

function parseSgrMouse(params: string, pressed: boolean): MouseEvent | undefined {
  const [b, x, y] = params.split(";").map(Number);
  if (b === undefined || x === undefined || y === undefined || [b, x, y].some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  const base = { type: "mouse" as const, x: x - 1, y: y - 1 };
  if (b & 64) { return { ...base, kind: (b & 1) ? "wheel-down" : "wheel-up", button: 0 }; }
  if (b & 32) { return { ...base, kind: "drag", button: b & 3 }; }
  return { ...base, kind: pressed ? "down" : "up", button: b & 3 };
}
