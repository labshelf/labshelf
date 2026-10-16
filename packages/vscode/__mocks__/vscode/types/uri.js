// Mocks vscode.Uri for file and URL paths.
const nodePath = require('path');

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme || 'file';
    this.authority = authority || '';
    this.path = path || '';
    this.query = query || '';
    this.fragment = fragment || '';
    this.fsPath = path || '';
  }

  static file(fsPath) {
    const u = new Uri('file', '', fsPath, '', '');
    u.fsPath = fsPath;
    return u;
  }

  static parse(raw, strict) {
    try {
      const url = new URL(raw);
      const fsPath = decodeURIComponent(url.pathname);
      const u = new Uri(url.protocol.replace(':', ''), url.host, fsPath, url.search, url.hash);
      u.fsPath = fsPath;
      return u;
    } catch {
      const u = new Uri('file', '', raw, '', '');
      u.fsPath = raw;
      return u;
    }
  }

  static joinPath(base, ...segments) {
    const joined = nodePath.join(base.fsPath, ...segments);
    return Uri.file(joined);
  }

  toString() {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

module.exports = { Uri };
