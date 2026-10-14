import { SETTINGS_ACTIONS, parseSettingsMessage } from '../../../src/ui/settings/protocol';

describe('parseSettingsMessage', () => {
  it('accepts ready', () => {
    expect(parseSettingsMessage({ type: 'ready' })).toEqual({ type: 'ready' });
  });

  it.each(SETTINGS_ACTIONS)('accepts the action %s', (action) => {
    expect(parseSettingsMessage({ type: 'action', action })).toEqual({ type: 'action', action });
  });

  it('keeps only the known fields', () => {
    expect(parseSettingsMessage({ type: 'action', action: 'sync.now', extra: 1 })).toEqual({ type: 'action', action: 'sync.now' });
  });

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['no type', {}],
    ['an unknown type', { type: 'state' }],
    ['an action without a name', { type: 'action' }],
    ['an unknown action', { type: 'action', action: 'rm -rf' }],
    ['a message with a command field', { command: 'sync.now' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseSettingsMessage(raw)).toBeNull();
  });
});
