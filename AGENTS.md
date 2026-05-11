# AGENTS.md - opencode-mimo-voice

## Architecture

- `index.js` - entry point, registers TTS commands
- `lib/tts.js` - MiMo/sox audio pipeline, auto/manual speech, event handlers
- `lib/llm-client.js` - OpenAI-compatible completion + MiMo TTS client (`createClient(kv, options)`)
- `lib/session.js` - shared helpers for reading OpenCode session titles

### Key invariants

- Single default export: `{ id, tui }`. OpenCode TUI loader requires this shape.
- No server-side plugin. `server` property must never be added.
- `registerTTS(api, kv, complete, synthesize, prompts, options)` returns command arrays. TTS also registers event handlers via `api.event.on()` as side effect.
- LLM calls use OpenAI chat completions API, not Anthropic messages API. Keeps client provider-agnostic.
- Config uses two mechanisms:
  - **`options`** (from `tui.json` plugin tuple) for static LLM endpoint config
  - **`api.kv`** for runtime state (TTS mode, voice)
- No dotfile I/O for config. All persistence through `api.kv`.
- No build step. Plain ESM JavaScript plus TUI TSX slot components, shipped as-is.

## Scripts

```bash
bun run check        # lint + fmt
bun run lint         # oxlint .
bun run fmt          # oxfmt --check .
bun run fmt:fix      # oxfmt --write .
```

## Code style

- **ESM only** - `import`/`export`, `"type": "module"` in package.json
- **No dependencies** - only peer dep on `@opencode-ai/plugin`
- **Formatting** - enforced by oxfmt
- **Linting** - enforced by oxlint
