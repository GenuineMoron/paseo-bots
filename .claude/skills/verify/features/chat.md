# Chat

Bot chats open in Paseo's own chat view (since 2026-11-10): composer, attachments, model picker and history are Paseo's. The plugin starts the chat, gives it the bot's setup, lists it under the bot, and adds a line to the bot's daily log.

## Sub-features

- `chat-new` pressing `New chat` (under the bot, or `New chat with <Bot>` on its row) starts a chat and opens Paseo's chat view in the bot's workspace. Pressing it again before sending anything reopens the same chat.
- `chat-send` sends from Paseo's composer, the textbox `Message agent...`, with Enter.
- `chat-image` attaches a picture with `Add attachment` → `Add image`; the bot answers about it.
- `chat-reply` streams the reply and ends with `Worked for <n>s`.
- `chat-thread` lists the chat under the bot, titled from the first message, with a status such as `Done`.
- `chat-agent` runs as a Paseo agent with the bot's provider and model, in `shared/Bots/<bot-id>/`.
- `chat-native` a chat started with Paseo's own `New tab` in the bot's workspace becomes the bot's chat: the bot's system prompt, and the `bots` tools when the bot has Bot tools on.
- `chat-back` the bot's avatar button in the workspace header (`Open <Bot>`) goes back to the bot's screen.
- `chat-log` appends `- HH:MM · from chat "<title>" · <reply>` to `memory/log/<YYYY-MM-DD>.md`.

## How to get to it (user POV)

- Choose the bot in the sidebar's Bots section, then `New chat` or one of its chats.
- Or open the grid button `All bots` on the Bots section header, then a bot.

## Driving it with pbv

Preconditions:

- A bot named `Verify Bot` with `provider: "claude"` and `model: "claude-haiku-5-5"`. Use the `bot-create-blank`, `bot-rename` and `bot-model` steps in [Bots](./bots.md).
- `eval "$($V env | sed 's/^/export /')"` has run, so `$PASEO_HOME` and `$EVIDENCE` are set.

- **Open.** Run `$V act button "New chat"`. The page moves to `/workspace/<id>` and shows Paseo's composer `Message agent...` with `Haiku 5.5` selected. Run `$V shot chat-1-before-send`.
- **Send.** Run `$V act textbox "Message agent..." fill "Reply with exactly the word PONG and nothing else."` and `$V browser press Enter`. The message bubble appears.
- **Agent.** Run `$V paseo ls`. One agent named after the message runs `claude/claude-haiku-5-5`, with CWD `…/plugin-data/paseo-bots/shared/Bots/<bot-id>`. Run `$V paseo wait <agent-id> --timeout 120`.
- **Reply.** Run `$V browser wait --text "Worked for"` and `$V shot chat-2-reply`. The chat shows `PONG` under the message. `$V act button "Open Verify Bot"` returns to the bot's screen, where the thread button's name starts `Reply with exactly the word PONG`.
- **Transcript.** Run `$V paseo logs <agent-id> > "$EVIDENCE/chat-transcript.txt"`. It contains `[User] Reply with exactly the word PONG and nothing else.` followed by `PONG`.
- **Daily log.** Run `cp "$PASEO_HOME"/plugin-data/paseo-bots/shared/Bots/<bot-id>/memory/log/*.md "$EVIDENCE/chat-daily-log.md"`. It holds one line: `- HH:MM · from chat "Reply with exactly the word PONG and nothing else." · PONG`.

## Gotchas

- With `provider: ""` New chat shows the toast `Couldn't start a chat with <Bot>: … has no models available`. Without a model the chat can't run, and that is a failed precondition, not a chat bug.
- `Add attachment` opens a menu; the file chooser comes from `Add image` or `Upload file`.
- Paseo's `New tab` opens a draft with `Select model`; pick any model, the bot's provider is used regardless.
- A Paseo agent in the run's daemon carries the chat, so `$V paseo ls` shows it in Paseo's own list too. Under `Workspaces` in Paseo's sidebar, the project `Bots` appears with the bot under it.
- Replies run with the bot's approval mode (`auto` on a fresh bot), so the bot can read and write files in its folder without a permission prompt.
- `$V paseo wait` returns when the agent is idle. The UI can lag by a moment, so wait for `Worked for` before the shot.
- A follow-up in the same thread reuses the same agent ID.
