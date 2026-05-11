# opencode-mimo-voice

> **This is a fork of [opencode-voice](https://github.com/renjfk/opencode-voice) by Soner Koksal.** This fork uses MiMo TTS exclusively and does not support other TTS options.

Text-to-speech plugin for [OpenCode](https://opencode.ai/) using MiMo TTS. Hear assistant responses spoken aloud via MiMo, with LLM normalization for natural speech.

## Install

Add to your `tui.json` (create at `~/.config/opencode/tui.json` if it doesn't exist):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-mimo-voice"]
}
```

If running from a local clone (development), use the absolute path instead:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/path/to/opencode-mimo-voice"]
}
```

## Prerequisites

Create a MiMo API key in the Xiaomi MiMo API console and export it in your shell:

```bash
export MIMO_API_KEY="your-api-key"
```

TTS playback uses `play` from sox (install via `brew install sox`).

Optional MiMo TTS defaults can be set in `tui.json`:

```json
{
  "plugin": [
    [
      "opencode-mimo-voice",
      {
        "mimoApiKeyEnv": "MIMO_API_KEY",
        "mimoEndpoint": "https://api.xiaomimimo.com/v1",
        "mimoTTSModel": "mimo-v2.5-tts"
      }
    ]
  ]
}
```

The `/tts-voice` command stores the selected MiMo voice in OpenCode's `api.kv`.

### LLM endpoint

An OpenAI-compatible LLM endpoint is required for text normalization. It converts markdown into natural spoken text.

By default uses Xiaomi MiMo's OpenAI-compatible API with `mimo-v2.5`.
Requires `MIMO_API_KEY` in your environment.

Set defaults in `tui.json` via plugin options:

```json
{
  "plugin": [
    [
      "opencode-mimo-voice",
      {
        "endpoint": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5",
        "apiKeyEnv": "MIMO_API_KEY",
        "authHeader": "api-key",
        "maxTokensParam": "max_completion_tokens",
        "maxTokens": 2048,
        "ttsNormalize": true
      }
    ]
  ]
}
```

Any OpenAI-compatible endpoint works (Anthropic's OpenAI compatibility layer,
OpenAI, Ollama, vLLM, LM Studio, etc.). For bearer-token endpoints, set
`authHeader` to `authorization` and `maxTokensParam` to the token field expected
by that endpoint, usually `max_tokens`.

### Custom prompts

The LLM system prompts used for normalization can be fully replaced by pointing
to your own prompt files. This lets you fine-tune how responses are spoken.

```json
{
  "plugin": [
    [
      "opencode-mimo-voice",
      {
        "ttsAutoPrompt": "~/.config/opencode/tts-auto-prompt.md",
        "ttsManualPrompt": "~/.config/opencode/tts-manual-prompt.md"
      }
    ]
  ]
}
```

- `ttsAutoPrompt` - system prompt for auto-speaking assistant responses
- `ttsManualPrompt` - system prompt for manually reading responses aloud

If a path is not set, the built-in default prompt is used.

Set `ttsNormalize` to `false` to skip TTS speech normalization by default. The
`/tts-normalize` command can toggle it at runtime.

## Commands

### Text-to-speech

The `leader` key in OpenCode is `ctrl+x`. So `leader+s` means press `ctrl+x`
then `s`.

The sidebar shows the current TTS phase. Click the TTS header to expand or
collapse status details, auto mode, and normalization settings.

| Command          | Keybind    | Description              |
| ---------------- | ---------- | ------------------------ |
| `/tts-speak`     | `leader+s` | Read last response aloud |
| `/tts-auto`      | `leader+v` | Toggle auto TTS on/off   |
| `/tts-stop`      | `escape`   | Stop playback            |
| `/tts-normalize` |            | Toggle TTS normalization |
| `/tts-voice`     |            | Select TTS voice         |

## How it works

### TTS pipeline

1. When TTS normalization is enabled, the response text is sent to the LLM for
   speech normalization
2. The LLM decides how to handle it: narrate simple answers, summarize
   code-heavy responses, or briefly notify for confirmations
3. When TTS normalization is disabled, the raw response text is spoken directly
4. MiMo synthesizes WAV audio, piped through sox for playback

### Auto TTS

When enabled (`/tts-auto`), the plugin automatically speaks:

- Assistant responses when a session goes idle after work
- Permission requests
- Questions that need your answer

## Contributing

opencode-mimo-voice is open to contributions and ideas!

### Issue conventions

**Format:** `type: brief description`

- `feat:` new features or functionality
- `fix:` bug fixes
- `enhance:` improvements to existing features
- `chore:` maintenance tasks, dependencies, cleanup
- `docs:` documentation updates
- `build:` build system, CI/CD changes

### Development

```bash
bun run check        # lint + fmt
bun run lint         # oxlint
bun run fmt          # oxfmt --check
bun run fmt:fix      # oxfmt --write
```

### Release process

Manual releases via opencode; see [RELEASE_PROCESS.md](RELEASE_PROCESS.md).

## License

This project is licensed under the [MIT License](LICENSE).
