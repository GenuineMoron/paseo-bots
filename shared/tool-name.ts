import { z } from "zod";

// Paseo names an ACP provider's tool call (Hermes, Gemini, …) by its ACP kind, which is "other"
// for MCP tools, and keeps the agent's own title, "<tool>" or "<tool>: <preview>", in
// `metadata.title`. These read the real tool back, so cards keyed on tool names work.

const AcpToolMetadata = z.object({ kind: z.string().optional(), title: z.string() });

/** "mcp__bots__propose_changes: Add a bot" → "mcp__bots__propose_changes"; a plain sentence → null. */
function toolInTitle(title: string): string | null {
  const head = title.split(": ", 1)[0]!.trim();
  return /^[\w.-]+$/.test(head) ? head : null;
}

/**
 * The tool a timeline tool call ran. Its name, unless Paseo filled the name in from the ACP kind
 * or title, in which case the tool the title starts with. A provider's own name always wins.
 */
export function toolCallName(call: { name: string; metadata?: unknown }): string {
  const metadata = AcpToolMetadata.safeParse(call.metadata);
  if (!metadata.success || (call.name !== metadata.data.kind && call.name !== metadata.data.title)) return call.name;
  return toolInTitle(metadata.data.title) ?? call.name;
}

/**
 * The tool of one MCP server that a resolved tool name is, whatever the provider calls it: Claude
 * and Hermes `mcp__bots__ask_bot`, Codex `bots.ask_bot`, omp `bots / ask_bot`, others `bots_ask_bot`.
 */
export function serverToolName(name: string, server: string): string | null {
  const match = /^(?:mcp__)?([A-Za-z0-9-]+?)(?:__|\.|_| \/ )(\w+)$/.exec(name.trim());
  return match?.[1] === server ? match[2]! : null;
}
