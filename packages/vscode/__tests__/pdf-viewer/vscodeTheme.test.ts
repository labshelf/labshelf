import { autoReaderTheme, onAutoReaderThemeChange, readerThemeOfKind } from '../../src/pdf-viewer/vscodeTheme';

const vscode = require('vscode');

describe('vscodeTheme', () => {
  beforeEach(() => {
    vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Dark };
  });

  it.each([[1, 'light'], [2, 'dark'], [3, 'high-contrast'], [4, 'light'], [99, 'light']])(
    'maps ColorThemeKind %i to %s', (kind, theme) => {
      expect(readerThemeOfKind(kind)).toBe(theme);
    },
  );

  it('resolves the auto theme from the active VS Code theme', () => {
    expect(autoReaderTheme()).toBe('dark');
    vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Light };
    expect(autoReaderTheme()).toBe('light');
  });

  it('reports the mapped theme when the VS Code theme changes', () => {
    const callback = jest.fn();
    const disposable = onAutoReaderThemeChange(callback);
    const listener = (vscode.window.onDidChangeActiveColorTheme as jest.Mock).mock.calls.at(-1)[0];
    listener({ kind: 3 });
    expect(callback).toHaveBeenCalledWith('high-contrast');
    disposable.dispose();
  });
});
