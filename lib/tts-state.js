const DEFAULT_STATUS = {
  phase: "idle",
  detail: "Ready",
  updatedAt: Date.now(),
};

let status = DEFAULT_STATUS;
const listeners = new Set();

export function getTTSStatus() {
  return status;
}

export function setTTSStatus(next) {
  status = {
    ...status,
    ...next,
    updatedAt: Date.now(),
  };
  for (const listener of listeners) listener(status);
}

export function subscribeTTSStatus(listener) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}
