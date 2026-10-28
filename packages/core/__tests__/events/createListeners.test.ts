// Tests the listener registry for add, emit, unsubscribe, clear and the live-iteration edge cases.
import { createListeners } from '../../src/events/createListeners';

describe('createListeners', () => {
  it('passes the emitted value to every listener in order', () => {
    const listeners = createListeners<number>();
    const seen: string[] = [];
    listeners.add((value) => seen.push(`a${value}`));
    listeners.add((value) => seen.push(`b${value}`));
    listeners.emit(7);
    expect(seen).toEqual(['a7', 'b7']);
  });

  it('calls a void listener with no value', () => {
    const listeners = createListeners();
    const listener = jest.fn();
    listeners.add(listener);
    listeners.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener after it unsubscribes, and unsubscribe returns undefined', () => {
    const listeners = createListeners<number>();
    const listener = jest.fn();
    const unsubscribe = listeners.add(listener);
    expect(unsubscribe()).toBeUndefined();
    listeners.emit(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('treats a second unsubscribe as harmless', () => {
    const listeners = createListeners();
    const other = jest.fn();
    const unsubscribe = listeners.add(() => undefined);
    listeners.add(other);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    listeners.emit();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('drops every listener on clear', () => {
    const listeners = createListeners();
    const listener = jest.fn();
    listeners.add(listener);
    listeners.clear();
    listeners.emit();
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs a listener added during an emit in that same emit', () => {
    const listeners = createListeners();
    const late = jest.fn();
    listeners.add(() => { listeners.add(late); });
    listeners.emit();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('skips a listener removed before its turn', () => {
    const listeners = createListeners();
    const second = jest.fn();
    let removeSecond: () => void = () => undefined;
    listeners.add(() => removeSecond());
    removeSecond = listeners.add(second);
    listeners.emit();
    expect(second).not.toHaveBeenCalled();
  });

  it('lets a throwing listener propagate and skips the later listeners', () => {
    const listeners = createListeners();
    const later = jest.fn();
    listeners.add(() => { throw new Error('boom'); });
    listeners.add(later);
    expect(() => listeners.emit()).toThrow('boom');
    expect(later).not.toHaveBeenCalled();
  });
});
