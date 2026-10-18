// Tests the toolchain wrapper: it hands core the shared TeX and the VS Code prompt, and explains an install that failed.
import * as vscode from "vscode";

import { ensureToolchain as ensureCoreToolchain } from "@labshelf/core/node";
import { ensureToolchain } from "../../../../src/writing/build/node";
import { fakeHost, readyEntry } from "../../../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), ensureToolchain: jest.fn() }));

const window = vscode.window as unknown as Record<string, jest.Mock>;
const core = ensureCoreToolchain as jest.Mock;
const entry = readyEntry("/code/repo");
const project = entry as Extract<typeof entry, { kind: "ready" }>;
const tex = { resolve: jest.fn() } as never;
const deps = () => ({ tex, host: fakeHost() });

beforeEach(() => jest.resetAllMocks());

it("returns the toolchain core prepared, built on the shared TeX", async () => {
  core.mockResolvedValue({ engine: "xelatex", executable: "/t" });
  expect(await ensureToolchain(deps(), project)).toEqual({ engine: "xelatex", executable: "/t" });
  expect(core.mock.calls[0]![1].tex).toBe(tex);
});

it("is silent when the user declined", async () => {
  core.mockResolvedValue({ status: "toolchain-missing", reason: "declined" });
  expect(await ensureToolchain(deps(), project)).toBeUndefined();
  expect(window["showErrorMessage"]).not.toHaveBeenCalled();
});

it("shows why the install failed and offers the install guide", async () => {
  core.mockResolvedValue({ status: "toolchain-missing", reason: "install-failed", message: "Checksum mismatch" });
  window["showErrorMessage"]!.mockResolvedValue("Open install guide");

  expect(await ensureToolchain(deps(), project)).toBeUndefined();

  expect(window["showErrorMessage"]).toHaveBeenCalledWith("LaTeX could not be installed: Checksum mismatch", "Open install guide");
  expect(vscode.env.openExternal).toHaveBeenCalled();
});
