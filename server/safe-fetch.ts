import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching text from an address a person pasted in. It must be a public https page: nothing on
 * this machine or its network (the daemon can reach services the person's browser can't), no
 * redirect to such a place, a time limit, and a size limit.
 */

const MAX_REDIRECTS = 3;

function privateV4(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
}

/** True for loopback, private, link-local and other addresses that aren't on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1]! : address;
  if (isIP(ip) === 4) return privateV4(ip.split(".").map(Number));
  const lower = ip.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("Only https links can be fetched.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error(`${host} isn't a public address.`);
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error(`${host} isn't a public address.`);
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`The page is larger than ${Math.round(maxBytes / 1024)} KB.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface FetchTextOptions {
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

export async function fetchPublicText(address: string, { accept = "text/plain, */*", maxBytes = 1_000_000, timeoutMs = 20_000 }: FetchTextOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url = new URL(address);
    for (let hop = 0; ; hop++) {
      await assertPublic(url);
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "paseo-bots", Accept: accept } });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`${url.hostname} answered ${response.status}.`);
      return await readCapped(response, maxBytes);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${address} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
