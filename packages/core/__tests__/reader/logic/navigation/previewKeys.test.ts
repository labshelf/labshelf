// Tests the preview-only keyboard bindings: recompile, next and previous problem.
import { cheatsheetRows, resolveKey, type KeyContext, type KeyInput } from '../../../../src/reader/logic/navigation/keymap';

function ctx(overrides: Record<string, unknown> = {}): KeyContext {
  return { vimKeys: false, isMac: false, inTextInput: false, pendingPrefix: null, ...overrides } as KeyContext;
}
function key(overrides: Partial<KeyInput> & { key: string }): KeyInput {
  return { ctrl: false, meta: false, alt: false, shift: false, ...overrides };
}

describe('preview key bindings', () => {
  it('resolves Ctrl+S to recompile on Windows and Linux, Cmd+S on macOS', () => {
    expect(resolveKey(key({ key: 's', ctrl: true }), ctx({ preview: true })).action).toBe('recompile');
    expect(resolveKey(key({ key: 's', meta: true }), ctx({ preview: true, isMac: true })).action).toBe('recompile');
    expect(resolveKey(key({ key: 's', meta: true }), ctx({ preview: true })).action).toBeNull();
  });

  it('resolves F8 and Shift+F8 to next and previous problem', () => {
    expect(resolveKey(key({ key: 'F8' }), ctx({ preview: true })).action).toBe('nextProblem');
    expect(resolveKey(key({ key: 'F8', shift: true }), ctx({ preview: true })).action).toBe('prevProblem');
  });

  it('still fires from a text input, as function keys and modified chords do', () => {
    expect(resolveKey(key({ key: 'F8' }), ctx({ preview: true, inTextInput: true })).action).toBe('nextProblem');
    expect(resolveKey(key({ key: 's', ctrl: true }), ctx({ preview: true, inTextInput: true })).action).toBe('recompile');
  });

  it('resolves nothing when the reader is not a preview', () => {
    for (const preview of [false, undefined]) {
      expect(resolveKey(key({ key: 's', ctrl: true }), ctx({ preview })).action).toBeNull();
      expect(resolveKey(key({ key: 'F8' }), ctx({ preview })).action).toBeNull();
      expect(resolveKey(key({ key: 'F8', shift: true }), ctx({ preview })).action).toBeNull();
    }
  });

  it('lists the bindings under a Preview group in the cheatsheet of a preview only', () => {
    const rows = cheatsheetRows(ctx({ preview: true }) as never);
    const preview = rows.filter((r) => (r.group as string) === 'Preview');
    expect(preview.flatMap((r) => r.keys)).toEqual(expect.arrayContaining(['Ctrl+S', 'F8', 'Shift+F8']));
    const plain = cheatsheetRows(ctx({ preview: false }) as never);
    expect(plain.some((r) => (r.group as string) === 'Preview')).toBe(false);
  });
});
