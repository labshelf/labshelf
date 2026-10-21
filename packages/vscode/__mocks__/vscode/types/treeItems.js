// Mocks tree view items, theme icons and colours, and drag-and-drop data transfer.

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) { this.id = id; }
}

class ThemeColor {
  constructor(id) { this.id = id; }
}

class DataTransferItem {
  constructor(value) { this._value = value; }
  async asString() { return this._value; }
  asFile() { return null; }
  get value() { return this._value; }
}

class DataTransfer {
  constructor(entries) { this._map = new Map(Object.entries(entries || {})); }
  get(mimeType) { return this._map.has(mimeType) ? new DataTransferItem(this._map.get(mimeType)) : undefined; }
  set(mimeType, value) { this._map.set(mimeType, value); }
  [Symbol.iterator]() { return this._map.entries(); }
}

module.exports = { TreeItem, ThemeIcon, ThemeColor, DataTransfer, DataTransferItem };
