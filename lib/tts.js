// Text-to-speech: LLM normalization, MiMo synthesis, sox playback.

import { spawn } from "node:child_process";
import { getSessionTitle } from "./session.js";
import { setTTSStatus } from "./tts-state.js";

export const TTS_VOICES = {
  chloe: { label: "Chloe (English, female)", id: "Chloe" },
  mia: { label: "Mia (English, female)", id: "Mia" },
  milo: { label: "Milo (English, male)", id: "Milo" },
  dean: { label: "Dean (English, male)", id: "Dean" },
  mimo_default: { label: "MiMo default", id: "mimo_default" },
};
export const DEFAULT_TTS_VOICE = "chloe";

// ---- System prompts ----

const SYSTEM_AUTO = `You are a text-to-speech narrator for a coding assistant CLI. Your job is to convert the assistant's markdown output into natural spoken text that is useful and pleasant to listen to.

You have three modes depending on the content complexity:

1. NARRATE - For simple explanations, short answers, and conversational responses. Convert to natural spoken text, normalizing code references for speech.
   - camelCase/PascalCase identifiers: split into words (parseConfig -> "parse config")
   - File paths: use just the filename (src/utils/helpers.ts -> "helpers dot ts")
   - Short code snippets in backticks: read them naturally
   - Keep the narrative flow intact

2. SUMMARIZE - For responses with significant code blocks, multiple file changes, or complex technical details. Provide a brief spoken summary of what was done and tell the user to check the screen.
   - Mention what was changed and why
   - Do not try to describe code blocks verbatim
   - End with something like "check the details on your screen" or "take a look at the output for the specifics"

3. NOTIFY - For very short confirmations, status updates, or acknowledgments. Keep it to one brief sentence.

Choose the appropriate mode based on the content. Most responses with code blocks should use SUMMARIZE mode. Simple Q&A or short explanations use NARRATE. Build results, "done", confirmations use NOTIFY.

Output ONLY the spoken text. Nothing else. No mode labels. No commentary.`;

const SYSTEM_MANUAL = `You are a text-to-speech reader for a coding assistant. The user has explicitly requested this text be read aloud. Read the prose content faithfully and in detail.

Rules:
- Read all prose text naturally and completely
- Code identifiers: split camelCase/PascalCase/snake_case into words (parseConfig -> "parse config", my_variable -> "my variable")
- File paths: read just the filename with extension (src/utils/helpers.ts -> "helpers dot ts")
- Line references: keep as is ("line 42")
- URLs: say "a link" or just the domain name
- Code blocks: skip entirely, just say "code block" or "code snippet"
- Error codes: expand naturally (ECONNREFUSED -> "connection refused")
- Shell commands: read them naturally (npm test -> "npm test")
- List items: read each item
- Remove markdown formatting but preserve all the informational content
- Do NOT summarize. Do NOT say "check the screen". Read everything that is prose.
- Output ONLY the spoken text`;

// ---- Session helpers ----

async function getTurnAssistantText(client, api) {
  const route = api.route.current;
  if (route.name !== "session") return null;

  const sessionID = route.params.sessionID;
  const stateMessages = api.state.session.messages(sessionID);
  if (!stateMessages || stateMessages.length === 0) return null;

  const assistantIDs = [];
  for (let i = stateMessages.length - 1; i >= 0; i--) {
    if (stateMessages[i].role === "user") break;
    if (stateMessages[i].role === "assistant") {
      assistantIDs.unshift(stateMessages[i].id);
    }
  }
  if (assistantIDs.length === 0) return null;

  const allText = [];
  for (const msgID of assistantIDs) {
    try {
      const fullMsg = await client.session
        .message({ sessionID, messageID: msgID }, { throwOnError: true })
        .then((r) => r.data);

      const textParts = (fullMsg?.parts || []).filter((p) => p.type === "text");
      const text = textParts
        .map((p) => p.text || "")
        .join("\n\n")
        .trim();
      if (text) allText.push(text);
    } catch {
      // Skip messages that fail to fetch
    }
  }

  if (allText.length === 0) return null;

  return {
    lastMessageID: assistantIDs[assistantIDs.length - 1],
    text: allText.join("\n\n"),
  };
}

// ---- Public API for TUI plugin ----

export function registerTTS(api, kv, complete, synthesize, prompts, options = {}) {
  const client = api.client;
  const systemAuto = prompts?.ttsAuto || SYSTEM_AUTO;
  const systemManual = prompts?.ttsManual || SYSTEM_MANUAL;

  function toast(message, variant = "info") {
    api.ui.toast({ message, variant, duration: 3000 });
  }

  function getVoiceID() {
    const voice = kv.get("tts.voice", DEFAULT_TTS_VOICE);
    const entry = TTS_VOICES[voice] || TTS_VOICES[DEFAULT_TTS_VOICE];
    return entry.id;
  }

  function shouldNormalize() {
    return kv.get("tts.normalize") ?? options.ttsNormalize ?? true;
  }

  async function normalizeForSpeech(text, systemPrompt) {
    if (!shouldNormalize()) return { text };
    return complete({
      system: systemPrompt,
      prompt: `Convert for text-to-speech:\n\n${text}`,
      config: { maxTokens: 4096 },
    });
  }

  // ---- Audio pipeline ----

  let playProc = null;
  let ttsController = null;

  function killProcs() {
    if (ttsController) {
      try {
        ttsController.abort();
      } catch {}
      ttsController = null;
    }
    if (playProc) {
      try {
        playProc.kill("SIGKILL");
      } catch {}
      playProc = null;
    }
  }

  async function speak(text) {
    if (!text) return;
    const line = text.replace(/\n/g, " ").trim();
    if (!line) return;

    killProcs();

    const controller = new AbortController();
    ttsController = controller;
    setTTSStatus({ phase: "processing", detail: "Requesting MiMo audio" });

    const result = await synthesize({
      text: line,
      voice: getVoiceID(),
      signal: controller.signal,
    });

    if (ttsController === controller) ttsController = null;
    if (controller.signal.aborted) {
      setTTSStatus({ phase: "idle", detail: "Stopped" });
      return;
    }
    if (!result.audioData) {
      toast(`TTS failed: ${result.error}`, "warning");
      setTTSStatus({ phase: "error", detail: result.error || "TTS failed" });
      return;
    }

    const audioBuffer = Buffer.from(result.audioData, "base64");
    setTTSStatus({ phase: "playing", detail: "Playing speech" });

    return new Promise((resolve) => {
      playProc = spawn("play", ["-q", "-t", "wav", "-"], {
        stdio: ["pipe", "ignore", "ignore"],
      });

      playProc.on("close", () => {
        playProc = null;
        setTTSStatus({ phase: "idle", detail: "Ready" });
        resolve();
      });

      playProc.on("error", () => {
        killProcs();
        setTTSStatus({ phase: "error", detail: "Playback failed" });
        resolve();
      });

      if (playProc?.stdin && !playProc.stdin.destroyed) {
        playProc.stdin.end(audioBuffer);
      }
    });
  }

  // ---- Session-prefixed announcements ----

  async function speakWithSessionPrefix(sessionID, message, suffix) {
    const sessionTitle = await getSessionTitle(client, sessionID);
    const parts = [];
    if (sessionTitle) parts.push(`Session: ${sessionTitle}.`);
    parts.push(message);
    if (suffix) parts.push(suffix);
    await speak(parts.join(" "));
  }

  function stopSpeech() {
    const wasPlaying = ttsController !== null || playProc !== null;
    killProcs();
    if (wasPlaying) setTTSStatus({ phase: "idle", detail: "Stopped" });
    return wasPlaying;
  }

  // ---- Auto mode ----

  let lastSpokenMessageID = null;
  let wasBusy = false;

  api.event.on("session.status", (event) => {
    if (event.properties?.status?.type === "busy") {
      wasBusy = true;
      stopSpeech();
    }
  });

  api.event.on("session.idle", async (event) => {
    if (kv.get("tts.mode", "off") !== "on") return;
    if (!wasBusy) return;
    wasBusy = false;

    const sessionID = event.properties?.sessionID;
    const result = await getTurnAssistantText(client, api);
    if (!result || !result.text) return;

    if (result.lastMessageID === lastSpokenMessageID) return;
    lastSpokenMessageID = result.lastMessageID;

    if (shouldNormalize()) {
      toast("Normalizing response...");
      setTTSStatus({ phase: "normalizing", detail: "Preparing spoken summary" });
    }
    const llmResult = await normalizeForSpeech(result.text, systemAuto);
    if (!llmResult.text) {
      toast(`TTS normalization failed: ${llmResult.error}`, "warning");
      setTTSStatus({ phase: "error", detail: llmResult.error || "Normalization failed" });
      return;
    }

    await speakWithSessionPrefix(sessionID, llmResult.text);
  });

  api.event.on("permission.asked", async (event) => {
    if (kv.get("tts.mode", "off") !== "on") return;
    await speakWithSessionPrefix(event.properties?.sessionID, "Permission requested.");
  });

  api.event.on("question.asked", async (event) => {
    if (kv.get("tts.mode", "off") !== "on") return;
    await speakWithSessionPrefix(event.properties?.sessionID, "A question needs your answer.");
  });

  // ---- Manual mode ----

  async function speakLastResponse() {
    const result = await getTurnAssistantText(client, api);
    if (!result || !result.text) {
      toast("No assistant response to speak", "warning");
      return;
    }

    if (shouldNormalize()) {
      toast("Normalizing response...");
      setTTSStatus({ phase: "normalizing", detail: "Preparing last response" });
    }
    const llmResult = await normalizeForSpeech(result.text, systemManual);
    if (!llmResult.text) {
      toast(`TTS normalization failed: ${llmResult.error}`, "warning");
      setTTSStatus({ phase: "error", detail: llmResult.error || "Normalization failed" });
      return;
    }

    toast("Speaking last response");
    await speak(llmResult.text);
  }

  // ---- Commands ----

  return [
    {
      title: "TTS: speak last response",
      value: "tts.speak-last",
      description: "Read the last assistant response aloud (detailed)",
      keybind: "<leader>s",
      slash: { name: "tts-speak" },
      onSelect() {
        speakLastResponse();
      },
    },
    {
      title: "TTS: toggle auto-speak",
      value: "tts.mode",
      description: "Toggle auto text-to-speech on/off",
      keybind: "<leader>v",
      slash: { name: "tts-auto" },
      onSelect() {
        const current = kv.get("tts.mode", "off");
        const next = current === "on" ? "off" : "on";
        kv.set("tts.mode", next);
        if (next === "off") stopSpeech();
        const voice =
          TTS_VOICES[kv.get("tts.voice", DEFAULT_TTS_VOICE)] || TTS_VOICES[DEFAULT_TTS_VOICE];
        toast(next === "on" ? `TTS on (${voice.label})` : "TTS off");
        setTTSStatus({
          phase: "idle",
          detail: next === "on" ? "Auto TTS enabled" : "Auto TTS disabled",
        });
      },
    },
    {
      title: "TTS: stop playback",
      value: "tts.stop",
      description: "Stop current TTS playback",
      keybind: "escape",
      slash: { name: "tts-stop" },
      onSelect() {
        if (stopSpeech()) toast("TTS stopped");
      },
    },
    {
      title: "TTS: toggle normalization",
      value: "tts.normalize",
      description: "Toggle LLM normalization before text-to-speech",
      slash: { name: "tts-normalize" },
      onSelect() {
        const next = !shouldNormalize();
        kv.set("tts.normalize", next);
        toast(next ? "TTS normalization on" : "TTS normalization off");
        setTTSStatus({
          phase: "idle",
          detail: next ? "Normalization enabled" : "Normalization disabled",
        });
      },
    },
    {
      title: "TTS: select voice",
      value: "tts.voice",
      description: "Choose TTS voice",
      slash: { name: "tts-voice" },
      onSelect() {
        const current = kv.get("tts.voice", DEFAULT_TTS_VOICE);
        api.ui.dialog.replace(() =>
          api.ui.DialogSelect({
            title: "Select voice",
            current,
            options: Object.entries(TTS_VOICES).map(([key, v]) => ({
              title: v.label,
              value: key,
              onSelect() {
                kv.set("tts.voice", key);
                toast(`Voice: ${v.label}`);
                setTTSStatus({ phase: "idle", detail: `Voice set to ${v.label}` });
                api.ui.dialog.clear();
              },
            })),
          }),
        );
      },
    },
  ];
}
