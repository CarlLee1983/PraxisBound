/**
 * The interactive terminal seam `review confirm` prompts through (Story
 * TST-026 R9(a)): automated tests inject a scripted `ReviewConfirmTerminal`;
 * `createDefaultReviewConfirmTerminal` wraps `node:readline` for the real
 * interactive path. Split out of `review-confirm.ts` so that file stays
 * focused on orchestration.
 */

import { createInterface } from "node:readline";

/** Prompts and messages go to stderr only (contract §8 step 1: "互動提示只寫 stderr"); stdout still carries exactly one JSON envelope in `--json` mode. */
export interface ReviewConfirmTerminal {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  write(text: string): void;
  /** Prompts (to stderr) and reads one line from stdin; `undefined` on EOF/abort. */
  question(prompt: string): Promise<string | undefined>;
}

export interface ClosableReviewConfirmTerminal extends ReviewConfirmTerminal {
  close(): void;
}

/** The real interactive terminal adapter: prompts and messages go to stderr; input is read from stdin. */
export function createDefaultReviewConfirmTerminal(): ClosableReviewConfirmTerminal {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    write(text: string): void {
      process.stderr.write(text);
    },
    question(prompt: string): Promise<string | undefined> {
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolvePromise) => {
        let settled = false;
        const onClose = (): void => {
          if (settled) return;
          settled = true;
          resolvePromise(undefined);
        };
        rl.once("close", onClose);
        rl.question(prompt, (answer) => {
          if (settled) return;
          settled = true;
          rl.off("close", onClose);
          resolvePromise(answer);
        });
      });
    },
    close(): void {
      rl.close();
    },
  };
}
