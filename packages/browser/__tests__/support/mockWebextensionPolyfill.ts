// Replaces webextension-polyfill, which throws when loaded outside an extension, so the native bridge fails to connect.
jest.mock("webextension-polyfill", () => ({}));
