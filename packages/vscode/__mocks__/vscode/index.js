// Assembles the `vscode` module mock that jest maps `vscode` imports to.
module.exports = {
  ...require('./types'),
  ...require('./api'),
};
