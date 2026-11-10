import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes `text` so a crash or a full disk can never leave a half-written file: the content goes
 * to a temporary file next to the target, which then replaces it in one step. Files are private
 * to the user (0600) unless a mode says otherwise.
 */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode });
    await chmod(temporary, mode).catch(() => {});
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * One JSON document on disk, shared by everything that edits it. Edits run one at a time, each
 * on the latest content, and are saved atomically. A file that can't be read as JSON is kept
 * aside as `<name>.corrupt-<time>` instead of being overwritten, so a bad write never silently
 * erases saved state.
 */
export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: () => string,
    private readonly empty: () => T,
    /** Turns parsed JSON into T, or throws when it isn't one. Defaults to trusting the shape. */
    private readonly parse: (raw: unknown) => T = (raw) => raw as T,
    private readonly mode = 0o600,
  ) {}

  async read(): Promise<T> {
    const path = this.path();
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return this.empty();
    }
    try {
      return this.parse(JSON.parse(text));
    } catch {
      await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {});
      return this.empty();
    }
  }

  /** Reads the latest content, lets `edit` change it, and saves the result. `edit` returns the new value and what to hand back. */
  update<R>(edit: (current: T) => { value: T; result: R } | Promise<{ value: T; result: R }>): Promise<R> {
    const run = async () => {
      const { value, result } = await edit(await this.read());
      await writeFileAtomic(this.path(), JSON.stringify(value, null, 2), this.mode);
      return result;
    };
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }
}
