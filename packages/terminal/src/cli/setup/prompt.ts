// Asks the user questions on the terminal and reports a closed input as no answer.
import { createInterface } from "node:readline/promises";

/** Resolves to the trimmed answer, or undefined when stdin ends. */
export type Ask = (question: string) => Promise<string | undefined>;

export async function withPrompt<T>(use: (ask: Ask) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  // PLATFORM: a pending readline question is never rejected when stdin ends, so the close event is raced against it.
  const closed = new Promise<undefined>((resolve) => rl.once("close", () => resolve(undefined)));
  const ask: Ask = (question) => Promise.race([rl.question(question).then((answer) => answer.trim(), () => undefined), closed]);
  try {
    return await use(ask);
  } finally {
    rl.close();
  }
}
