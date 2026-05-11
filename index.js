// opencode-mimo-voice: Text-to-speech for OpenCode via MiMo TTS.
//
// TTS: Auto-speak assistant responses (or read on demand) via MiMo TTS API,
//      with LLM summarization for natural speech.
//
// Prerequisites:
//   TTS: MIMO_API_KEY environment variable, sox for playback
//
// Configuration via tui.json plugin options:
//   ["opencode-mimo-voice", { "endpoint": "...", "model": "...", "apiKeyEnv": "..." }]
//
// Runtime state (voice, tts mode) persisted via api.kv.
//
// Commands:
//   /tts-speak (leader+s) - read last response aloud
//   /tts-auto (leader+v)  - toggle auto TTS on/off
//   /tts-stop (escape)    - stop playback
//   /tts-summarization    - toggle TTS summarization
//   /tts-voice            - select TTS voice

import fs from "node:fs";
import os from "node:os";
import { registerTTS } from "./lib/tts.js";
import { createClient } from "./lib/llm-client.js";
import { registerTTSSidebar } from "./lib/tts-sidebar.tsx";

function loadPromptFile(filePath) {
  if (!filePath) return null;
  const resolved = filePath.replace(/^~(?=\/|$)/, os.homedir());
  try {
    return fs.readFileSync(resolved, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export default {
  id: "opencode-mimo-voice",
  tui: async (api, options) => {
    const { kv } = api;
    const { complete, synthesize } = createClient(kv, options);

    const prompts = {
      ttsAuto: loadPromptFile(options?.ttsAutoPrompt),
      ttsManual: loadPromptFile(options?.ttsManualPrompt),
    };

    const ttsCommands = registerTTS(api, kv, complete, synthesize, prompts, options);
    registerTTSSidebar(api, options);

    api.command.register(() => ttsCommands);
  },
};
