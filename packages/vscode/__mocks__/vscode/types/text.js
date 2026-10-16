// Mocks positions, ranges, selections, edits and text tabs of text documents.

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}

class Range {
  constructor(a, b, c, d) {
    const [start, end] = typeof a === 'number' ? [new Position(a, b), new Position(c, d)] : [a, b];
    this.start = start;
    this.end = end;
  }
  contains(position) {
    const after = (a, b) => a.line > b.line || (a.line === b.line && a.character >= b.character);
    return after(position, this.start) && after(this.end, position);
  }
}

class WorkspaceEdit {
  constructor() { this.replacements = []; }
  replace(uri, range, text) { this.replacements.push({ uri, range, text }); }
}
class TextEdit {
  constructor(range, newText) { this.range = range; this.newText = newText; }
  static insert(position, newText) { return new TextEdit(new Range(position, position), newText); }
}

class Selection {
  constructor(anchor, active) { this.anchor = anchor; this.active = active; }
}

class Location {
  constructor(uri, range) { this.uri = uri; this.range = range; }
}

class TabInputText {
  constructor(uri) { this.uri = uri; }
}

module.exports = { Position, Range, Selection, TextEdit, WorkspaceEdit, Location, TabInputText };
