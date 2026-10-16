// Mocks vscode.Disposable, EventEmitter and CancellationToken.
class Disposable {
  constructor(callOnDispose) { this._callOnDispose = callOnDispose; }
  static from(...items) { return new Disposable(() => items.forEach(item => item.dispose())); }
  dispose() { this._callOnDispose?.(); this._callOnDispose = undefined; }
}

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (cb) => {
      this._listeners.push(cb);
      return new Disposable(() => { this._listeners = this._listeners.filter(l => l !== cb); });
    };
  }
  fire(data) { [...this._listeners].forEach(l => l(data)); }
  dispose() { this._listeners = []; }
}

const CancellationToken = { None: { isCancellationRequested: false } };

module.exports = { Disposable, EventEmitter, CancellationToken };
