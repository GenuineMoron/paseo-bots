/** Rejects if `work` hasn't settled within `ms`. The work itself isn't cancelled; callers stop waiting for it. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
