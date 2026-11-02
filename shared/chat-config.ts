import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Per-chat choices. Omitted fields retain the bot's defaults. */
export const ChatConfigSchema = z.object({
  model: z.string().min(1).nullable().optional(),
  modeId: z.string().min(1).optional(),
  thinkingOptionId: z.string().min(1).nullable().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
});
export type ChatConfig = z.infer<typeof ChatConfigSchema>;

// The 0.12 public plugin SDK exposes discovery/creation but not live config setters.
export const chatConfigRpc = defineRpc({
  name: "bots.chat.configure",
  input: z.object({ botId: z.string(), agentId: z.string().uuid(), config: ChatConfigSchema }),
  output: z.object({ notice: z.string().nullable() }),
});
