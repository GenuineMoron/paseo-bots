// A small line diff for the memory change journal: unified hunks with two
// lines of context, like `diff -U2`, plus the added and removed line counts.

const CONTEXT = 2;
/** Beyond this many differing lines on each side the hunks are skipped and only counts are kept. */
const MAX_MIDDLE = 1_000;

type Op = { kind: " " | "-" | "+"; line: string };

/** One line of a unified diff, as the diff view shows it. */
export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\n$/, "").split("\n");
}

/** Longest-common-subsequence lengths: table[i][j] covers a[i..] and b[j..]. */
function lcsTable<T>(a: readonly T[], b: readonly T[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** The edit script for the lines between the shared prefix and suffix. */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const table = lcsTable(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) ops.push({ kind: "-", line: a[i++]! });
    else ops.push({ kind: "+", line: b[j++]! });
  }
  while (i < a.length) ops.push({ kind: "-", line: a[i++]! });
  while (j < b.length) ops.push({ kind: "+", line: b[j++]! });
  return ops;
}

function hunks(ops: readonly Op[]): string {
  const out: string[] = [];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  const lineNumbers = ops.map((op) => {
    const at = { old: oldLine, new: newLine };
    if (op.kind !== "+") oldLine++;
    if (op.kind !== "-") newLine++;
    return at;
  });
  while (index < ops.length) {
    if (ops[index]!.kind === " ") {
      index++;
      continue;
    }
    const start = Math.max(0, index - CONTEXT);
    let end = index;
    // Extend over changes that are close enough to share context.
    while (end < ops.length) {
      if (ops[end]!.kind !== " ") {
        end++;
        continue;
      }
      let next = end;
      while (next < ops.length && ops[next]!.kind === " ") next++;
      if (next < ops.length && next - end <= CONTEXT * 2) end = next;
      else break;
    }
    const stop = Math.min(ops.length, end + CONTEXT);
    const slice = ops.slice(start, stop);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const first = lineNumbers[start]!;
    out.push(`@@ -${oldCount ? first.old : first.old - 1},${oldCount} +${newCount ? first.new : first.new - 1},${newCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
    index = stop;
  }
  return out.join("\n");
}

/** Lines in `after` with no counterpart in `before` (added), and the other way round (removed). */
function unmatchedCounts(before: readonly string[], after: readonly string[]): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}

export function lineDiff(before: string, after: string, maxChars = 8_000): { diff: string; added: number; removed: number } {
  const a = splitLines(before);
  const b = splitLines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  if (middleA.length > MAX_MIDDLE || middleB.length > MAX_MIDDLE) {
    // Too long to align line by line: count the lines each side has that the other lacks, so that
    // two small edits far apart in a long file read as a few lines changed, not thousands.
    return { diff: "", ...unmatchedCounts(middleA, middleB) };
  }
  const ops: Op[] = [...a.slice(0, prefix).map((line) => ({ kind: " " as const, line })), ...editScript(middleA, middleB), ...a.slice(a.length - suffix).map((line) => ({ kind: " " as const, line }))];
  const diff = hunks(ops);
  return {
    diff: diff.length > maxChars ? `${diff.slice(0, maxChars)}\n…` : diff,
    added: ops.filter((op) => op.kind === "+").length,
    removed: ops.filter((op) => op.kind === "-").length,
  };
}

/** The lines of a unified diff, for showing it. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const diff: DiffLine[] = [];
  // "+++ b/file" and "--- a/file" are headers only before the first hunk; inside one, a line
  // starting "---" is a removed line of text (a Markdown rule, a SQL comment).
  let inHunk = false;
  for (const line of text ? text.replace(/\r\n/g, "\n").split("\n") : []) {
    if (!line.length) diff.push({ type: "context", content: line });
    else if (line.startsWith("@@")) {
      inHunk = true;
      diff.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      if (inHunk || !line.startsWith("+++")) diff.push({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      if (inHunk || !line.startsWith("---")) diff.push({ type: "remove", content: line });
    } else if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    else if (line.startsWith("\\ No newline")) diff.push({ type: "header", content: line });
    else diff.push({ type: "context", content: line });
  }
  return diff;
}
