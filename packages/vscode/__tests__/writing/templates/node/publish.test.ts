// Pins the GitHub sign-in: the requested scope, the token and login it returns, and that a refusal throws.
import { signInToGitHub } from "../../../../src/writing/templates/node/publish";

const getSession = jest.fn();
jest.mock("vscode", () => ({ ...jest.requireActual("vscode"), authentication: { getSession: (...args: unknown[]) => getSession(...args) } }));

beforeEach(() => { getSession.mockReset(); });

describe("signInToGitHub", () => {
  it("asks for public_repo, creating a session when none exists, and returns the token and login", async () => {
    getSession.mockResolvedValue({ accessToken: "tok", account: { label: "ada" } });
    await expect(signInToGitHub()).resolves.toEqual({ token: "tok", login: "ada" });
    expect(getSession).toHaveBeenCalledWith("github", ["public_repo"], { createIfNone: true });
  });

  it("throws when the user refuses", async () => {
    getSession.mockRejectedValue(new Error("User did not consent to login."));
    await expect(signInToGitHub()).rejects.toThrow("did not consent");
  });
});
