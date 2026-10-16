// Collects the namespaces (workspace, window, commands, env, extensions) of the `vscode` mock.
const { workspace, RelativePattern, _fileWatchers } = require('./workspace');

module.exports = {
  workspace,
  RelativePattern,
  _fileWatchers,
  window: require('./window'),
  commands: require('./commands'),
  env: require('./env'),
  extensions: require('./extensions'),
};
