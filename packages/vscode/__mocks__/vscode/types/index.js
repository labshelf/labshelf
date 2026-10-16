// Collects the value types and enums of the `vscode` mock.
module.exports = {
  ...require('./uri'),
  ...require('./enums'),
  ...require('./events'),
  ...require('./text'),
  ...require('./treeItems'),
  ...require('./languageFeatures'),
};
