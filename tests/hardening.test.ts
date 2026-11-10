import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backStep } from "../shared/back";
import { joinArgs, splitArgs } from "../shared/bot";
import { lineDiff, parseUnifiedDiff } from "../shared/diff";
import { forgetItem } from "../shared/library";
import { wrapIndex } from "../shared/pixel";
import { latestDue, scheduleToCron, validateCron } from "../shared/routines";
import { SkillName } from "../shared/rpc";
import { parseSkillFrontmatter, parseSkillSource } from "../shared/skills";
import { relativeTime } from "../shared/time";
import { JsonFile, writeFileAtomic } from "../server/json-file";
import { isPrivateAddress } from "../server/safe-fetch";
import { withTimeout } from "../server/timeout";
import { librarySkillPath } from "../server/library";
import { makeBot } from "./helpers";

describe("skill names cannot leave the library", () => {
  it("rejects dot names in the RPC schema and in path building", () => {
    for (const bad of [".", "..", ".hidden", "-x", "a/b"]) expect(SkillName.safeParse(bad).success, bad).toBe(false);
    for (const good of ["pdf", "my-skill_2", "v1.2"]) expect(SkillName.safeParse(good).success, good).toBe(true);
    expect(() => librarySkillPath("..")).toThrow("valid skill name");
    expect(() => librarySkillPath("../x")).toThrow("valid skill name");
    expect(librarySkillPath("pdf")).toMatch(/library[\\/]skills[\\/]pdf$/);
  });
});

describe("durable JSON files", () => {
  it("writes atomically and keeps a damaged file aside instead of erasing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bots-json-"));
    try {
      const path = join(dir, "state.json");
      const file = new JsonFile<{ n: number }>(() => path, () => ({ n: 0 }), (raw) => {
        if (typeof (raw as { n?: unknown }).n !== "number") throw new Error("bad");
        return raw as { n: number };
      });
      expect(await file.read()).toEqual({ n: 0 });
      await Promise.all([1, 2, 3].map(() => file.update((current) => ({ value: { n: current.n + 1 }, result: null }))));
      expect(await file.read()).toEqual({ n: 3 }); // queued edits all counted
      await writeFile(path, "{ not json");
      expect(await file.read()).toEqual({ n: 0 });
      const kept = (await readdir(dir)).filter((name) => name.includes(".corrupt-"));
      expect(kept).toHaveLength(1);
      expect(await readFile(join(dir, kept[0]!), "utf8")).toBe("{ not json");
      await writeFileAtomic(path, "{}");
      expect((await readdir(dir)).some((name) => name.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops waiting for work that never finishes", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "Waiting")).rejects.toThrow("Waiting took longer");
    await expect(withTimeout(Promise.resolve(5), 20, "Waiting")).resolves.toBe(5);
  });
});

describe("addresses that may be fetched", () => {
  it("refuses private and local ones", () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(address), address).toBe(false);
  });
});

describe("shared logic fixes", () => {
  it("steps back one level at a time", () => {
    const base = { libraryOpen: false, libraryPage: false, panelOpen: false, panelSection: false, compact: true, teamMapOpen: false };
    expect(backStep({ ...base, libraryOpen: true, libraryPage: true })).toBe("library-list");
    expect(backStep({ ...base, libraryOpen: true, libraryPage: true, compact: false })).toBe("close-library");
    expect(backStep({ ...base, panelOpen: true, panelSection: true })).toBe("settings-list");
    expect(backStep({ ...base, panelOpen: true })).toBe("close-settings");
    expect(backStep({ ...base, teamMapOpen: true })).toBe("close-team-map");
    expect(backStep({ ...base, teamMapOpen: true, compact: false })).toBeNull();
  });

  it("shows older dates in the reader's calendar", () => {
    const iso = new Date(2026, 7, 3, 0, 30).toISOString(); // 03 Aug local, 00:30
    expect(relativeTime(iso, new Date(2026, 10, 1).getTime())).toBe("2026-08-03");
  });

  it("keeps '---' content lines inside a hunk", () => {
    const diff = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n-----\n-- note\n+kept");
    expect(diff.filter((line) => line.type === "remove").map((line) => line.content)).toEqual(["-----", "-- note"]);
    expect(diff.some((line) => line.content.startsWith("+++"))).toBe(false);
  });

  it("reads frontmatter keys at the top level and block descriptions", () => {
    const text = "---\nname: pdf\nmetadata:\n  name: nested\ndescription: >-\n  Fills in\n  PDF forms.\n---\nbody";
    expect(parseSkillFrontmatter(text)).toEqual({ name: "pdf", description: "Fills in PDF forms." });
    expect(() => parseSkillSource("https://github.com/o/r/pull/12")).toThrow("repository");
    expect(parseSkillSource("https://github.com/o/r/tree/main/skills/a")).toMatchObject({ owner: "o", repo: "r", ref: "main", path: "skills/a" });
  });

  it("keeps an unrelated server's grants from outliving the server", () => {
    const bot = makeBot({ mcpServerIds: ["s1"], alwaysAllow: ["files/delete", "other/read"] });
    expect(forgetItem([bot], "mcp", "s1", "files")[0]).toMatchObject({ mcpServerIds: [], alwaysAllow: ["other/read"] });
    expect(forgetItem([bot], "mcp", "s1")[0]!.alwaysAllow).toEqual(["files/delete", "other/read"]);
  });

  it("round-trips arguments with one kind of quote", () => {
    for (const args of [['{"x":1}'], ["it's"], ["a b", ""], ["plain"]]) expect(splitArgs(joinArgs(args))).toEqual(args);
  });


  it("counts a long file's edits as the few lines they are", () => {
    const lines = Array.from({ length: 3_000 }, (_, i) => `line ${i}`);
    const edited = [...lines];
    edited[10] = "changed A";
    edited[2_990] = "changed B";
    expect(lineDiff(lines.join("\n"), edited.join("\n"))).toMatchObject({ added: 2, removed: 2 });
  });

  it("handles negative palette numbers", () => {
    expect(wrapIndex(-1, 12)).toBe(11);
    expect(wrapIndex(13, 12)).toBe(1);
  });

  it("reads 'N/step' cron as from N to the end", () => {
    expect(validateCron("0/15 * * * *")).toBeNull();
    const since = new Date(2026, 5, 1, 10, 0, 0);
    expect(latestDue({ kind: "cron", expression: "0/15 * * * *" }, since, new Date(2026, 5, 1, 10, 31, 0))?.getMinutes()).toBe(30);
  });

  it("only turns an interval into cron when cron can say it exactly", () => {
    expect(scheduleToCron({ kind: "interval", minutes: 15 })).toBe("*/15 * * * *");
    expect(scheduleToCron({ kind: "interval", minutes: 45 })).toBeNull();
    expect(scheduleToCron({ kind: "interval", minutes: 90 })).toBeNull();
    expect(scheduleToCron({ kind: "interval", minutes: 360 })).toBe("0 */6 * * *");
    expect(scheduleToCron({ kind: "interval", minutes: 300 })).toBeNull();
  });

  it("never fires a stored time that doesn't exist", () => {
    const now = new Date(2026, 5, 10, 12, 0, 0);
    expect(latestDue({ kind: "daily", time: "25:99", weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date(2026, 5, 1), now)).toBeNull();
    expect(latestDue({ kind: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, new Date(2026, 5, 1), now)).not.toBeNull();
  });
});
