/** @jsxImportSource @opentui/solid */

import { Show, createMemo, createSignal, onCleanup } from "solid-js";
import { getTTSStatus, subscribeTTSStatus } from "./tts-state.js";

function statusColor(theme, phase) {
  if (phase === "playing") return theme.success;
  if (phase === "normalizing" || phase === "processing") return theme.warning;
  if (phase === "error") return theme.error;
  return theme.textMuted;
}

function statusLabel(phase) {
  if (phase === "normalizing") return "Normalizing";
  if (phase === "processing") return "Processing";
  if (phase === "playing") return "Playing";
  if (phase === "error") return "Error";
  return "Idle";
}

function TTSStatusView(props) {
  const [status, setStatus] = createSignal(getTTSStatus());
  const [detailsOpen, setDetailsOpen] = createSignal(props.api.kv.get("tts.sidebarDetails", true));
  const unsubscribe = subscribeTTSStatus(setStatus);
  onCleanup(unsubscribe);

  const theme = () => props.api.theme.current;
  const mode = createMemo(() => {
    status();
    return props.api.kv.get("tts.mode", "off");
  });
  const normalize = createMemo(() => {
    status();
    return props.api.kv.get("tts.normalize") ?? props.options?.ttsNormalize ?? true;
  });

  function toggleDetails() {
    setDetailsOpen((open) => {
      const next = !open;
      props.api.kv.set("tts.sidebarDetails", next);
      return next;
    });
  }

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={toggleDetails}>
        <text fg={theme().textMuted}>{detailsOpen() ? "▼" : "▶"}</text>
        <text fg={theme().text}>
          <b>TTS</b>
        </text>
        <text fg={statusColor(theme(), status().phase)}>• {statusLabel(status().phase)}</text>
      </box>
      <Show when={detailsOpen()}>
        <text fg={theme().textMuted} wrapMode="word">
          {status().detail}
        </text>
        <text fg={theme().textMuted}>Mode: {mode() === "on" ? "auto" : "manual"}</text>
        <text fg={theme().textMuted}>Normalize: {normalize() ? "on" : "off"}</text>
      </Show>
    </box>
  );
}

export function registerTTSSidebar(api, options = {}) {
  api.slots.register({
    order: 120,
    slots: {
      sidebar_content() {
        return <TTSStatusView api={api} options={options} />;
      },
    },
  });
}
