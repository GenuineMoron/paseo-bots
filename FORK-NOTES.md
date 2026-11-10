# Local fork notes

This fork is upstream [`oliexe/paseo-bots`](https://github.com/oliexe/paseo-bots) plus a friend's
changes (bots at the top of Paseo's sidebar, drag to reorder), a hardening pass on 2026-11-04, and an
overhaul on 2026-11-10 that moved bot chats into Paseo's own chat view. The README is upstream's, with
a note about the fork and its install line.

## How bot chats work (since 2026-11-10)

A bot chat is an ordinary Paseo agent in the bot's workspace, opened in Paseo's own chat view. So
images, files, voice, the model picker, history and phones all work as in any other chat. The plugin
no longer has a chat view of its own (that view is where images, files and mobile attachments broke).

- **Which bot a chat belongs to** (`server/bot-chats.ts`): its `paseo-bots.bot` label, else the bot
  whose managed folder (`plugin-data/paseo-bots/shared/Bots/<id>`, symlinks resolved) it runs in.
  A bot with a working folder of your own only owns the chats the plugin starts there, since that
  folder is shared with your other agents.
- **Setup** (`agent.create` hook): any new agent in a bot's folder gets the bot's provider, model,
  mode, system prompt, MCP servers and tool grants, including chats made with Paseo's own "+" tab.
- **Plugin tools** (`bots` MCP server, `composio` for apps): chats the plugin starts carry them in
  their saved setup, so the quiet tools can be pre-approved. Chats started outside the plugin get
  them from the `agent.session_open` hook. Paseo refuses a session that adds a server the saved
  setup already has, so the hook skips labelled chats. Bots with **Bot tools** off (Access) get none.
- **New chat** reuses the bot's untouched new chat (label `paseo-bots.new`, no message yet) instead
  of piling up empty chats.
- **Cards** in Paseo's chat view: proposals, app sign-ins and routine runs, through timeline
  transformers and renderers. ACP providers (Hermes) report MCP tool calls by kind with the tool in
  `metadata.title`; `shared/tool-name.ts` reads it back.
- **Navigation**: sidebar Bots section → a bot's screen (chats + settings) → a chat opens natively.
  Each bot workspace has an avatar button in its header that goes back to the bot's screen.
  The grid button on the Bots section header opens the full Bots screen (new bot, teams, Skills & Tools).
- **Workspace names** follow the bot's name (renamed server-side a moment after the bots change).

## Where things live

| Area | Files |
|---|---|
| Recognising and starting bot chats | `server/bot-chats.ts`, `shared/chat.ts` (`startBotChat`), `shared/bot.ts` (`applyBotSetup`) |
| Chat lists in the app | `shared/chat-lists.ts` (group a host's agents by bot, apply agent updates), `client/data.ts` (one list per host, kept live from agent updates, saved copy for instant paint) |
| Opening and starting chats | `client/chats.ts` (`useBotChatActions`, `useChatBot`) |
| Bots screen | `client/BotsSurface.tsx` (list + settings), `client/BotSidebar.tsx` (the list), `client/BotShortcuts.tsx` (sidebar section) |
| Header buttons | `client/header-buttons.tsx` |
| Cards | `client/cards/*` |
| Durable server state | `server/json-file.ts` (atomic writes, queued edits, damaged files kept aside) |
| Fetching pasted links | `server/safe-fetch.ts` (https, public addresses only, size and time limits) |

## Tests

`npm test` (vitest) and `npx tsc --noEmit`. `tests/native-chats.test.ts` covers chat ownership,
setup, plugin tools, chat lists and ACP tool names.

The end-to-end check on 2026-11-10 ran a throwaway Paseo 0.14 daemon (its own `PASEO_HOME` and port)
driven by Playwright: New chat opened Paseo's chat view; a picture sent through Paseo's composer showed
and was answered; a chat started with Paseo's "+" tab became the bot's chat with its prompt and tools;
New chat twice made one chat; the phone layout opened chats natively; the Bots screen, settings and
the Bot tools switch rendered. `.claude/skills/verify` (from
[markahesketh's fork](https://github.com/markahesketh/paseo-bots)) is a harness for the same checks;
its recipes are updated for the native chat view.

## Known limits

- Plugin RPCs reach this host only, so for a bot on another host chats are started through that
  host's API without the plugin's tools, and Paseo's "+" tab there doesn't make bot chats.
- Turning **Bot tools** off or adding apps changes new chats; existing chats keep their saved setup.
- In a bot's workspace, Paseo's "+" tab always gives the bot's provider, whatever the picker says.
- Skill review hashes SKILL.md only, not the other files in a skill folder.

## Credits

- [oliexe/paseo-bots](https://github.com/oliexe/paseo-bots), the original plugin (MIT).
- [kiawin/paseo-bots](https://github.com/kiawin/paseo-bots) first opened bot chats in Paseo's chat view;
  `client/header-buttons.tsx` is adapted from it.
- [markahesketh/paseo-bots](https://github.com/markahesketh/paseo-bots) for the verify harness in `.claude/skills/verify`.
