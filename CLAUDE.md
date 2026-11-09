# Speakeasy: rules for Claude Code

Read README.md and DESIGN.md before each step. They are the source of truth.

## Process
- Do only the step in the prompt. List other ideas under "Noticed but not built".
- If a fix needs a new event, a protocol change or a design change, stop and report the options instead of building it.
- Small commits on a branch. Do not push.
- Never commit env files or secrets.
- Use only the Neon dev branch for testing.
- Report how you verified each definition-of-done item, then stop.

## Code style
- Concise and direct, with clear named variables and modern ES6+ patterns.
- Function declarations for top-level functions. Arrow functions only for inner callbacks.
- Explicit loops instead of one-line chained comprehensions.
- No unearned abstraction.
- No em dashes in comments, docs or commit messages.

## Privacy
- Never log message content, room names, display names, keys or tokens.
- The room key never leaves the browser and is never stored.
- Local storage holds only the display name, the browser token and the theme choice ("light" or "dark"). Session storage is not used.