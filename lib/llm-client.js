// OpenAI-compatible API client for text normalization and MiMo TTS.
//
// Works with any OpenAI-compatible endpoint:
//   - Xiaomi MiMo API (default)
//   - Anthropic's OpenAI compatibility layer
//   - OpenAI directly
//   - Ollama, vLLM, LM Studio, etc.
//
// Configuration is passed from plugin options (tui.json):
//   ["opencode-mimo-voice", {
//     "endpoint": "https://api.xiaomimimo.com/v1",
//     "model": "mimo-v2.5",
//     "apiKeyEnv": "MIMO_API_KEY",
//     "maxTokens": 2048
//   }]

const DEFAULTS = {
  endpoint: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.5",
  apiKeyEnv: "MIMO_API_KEY",
  maxTokens: 2048,
  reasoningEffort: null,
  retries: 2,
};

const TTS_DEFAULTS = {
  endpoint: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.5-tts",
  apiKeyEnv: "MIMO_API_KEY",
  authHeader: "api-key",
};

function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/+$/, "");
}

function inferAuthHeader(endpoint, authHeader) {
  if (authHeader) return authHeader;
  return endpoint.includes("xiaomimimo.com") ? "api-key" : "authorization";
}

function inferMaxTokensParam(endpoint, maxTokensParam) {
  if (maxTokensParam) return maxTokensParam;
  return endpoint.includes("xiaomimimo.com") ? "max_completion_tokens" : "max_tokens";
}

function buildHeaders(apiKey, authHeader) {
  const headers = { "Content-Type": "application/json" };
  if (authHeader === "api-key") {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = "Bearer " + apiKey;
  }
  return headers;
}

async function postChatCompletions(cfg, body, signal) {
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) return { data: null, error: `${cfg.apiKeyEnv} not set` };

  const endpoint = normalizeEndpoint(cfg.endpoint) + "/chat/completions";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(apiKey, inferAuthHeader(cfg.endpoint, cfg.authHeader)),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const suffix = detail ? `: ${detail.slice(0, 200)}` : "";
      return { data: null, error: `API request failed (${response.status})${suffix}` };
    }

    return { data: await response.json() };
  } catch (err) {
    if (err.name === "AbortError") return { data: null, error: "Request cancelled" };
    return { data: null, error: `API error: ${err.message}` };
  }
}

/**
 * Create API functions bound to a kv store for config persistence.
 *
 * @param {object} kv - OpenCode TUI kv store (api.kv)
 * @param {object} [pluginOptions] - Static config from tui.json plugin options
 * @returns {{ complete: (opts: { system?: string, prompt: string, config?: object }) => Promise<{ text: string | null, error?: string }>, synthesize: (opts: { text: string, voice?: string, config?: object, signal?: AbortSignal }) => Promise<{ audioData: string | null, error?: string }> }}
 */
export function createClient(kv, pluginOptions) {
  function getConfig() {
    const endpoint = kv.get("llm.endpoint") ?? pluginOptions?.endpoint ?? DEFAULTS.endpoint;
    return {
      endpoint,
      model: kv.get("llm.model") ?? pluginOptions?.model ?? DEFAULTS.model,
      apiKeyEnv: kv.get("llm.apiKeyEnv") ?? pluginOptions?.apiKeyEnv ?? DEFAULTS.apiKeyEnv,
      authHeader: inferAuthHeader(endpoint, kv.get("llm.authHeader") ?? pluginOptions?.authHeader),
      maxTokensParam: inferMaxTokensParam(
        endpoint,
        kv.get("llm.maxTokensParam") ?? pluginOptions?.maxTokensParam,
      ),
      maxTokens: kv.get("llm.maxTokens") ?? pluginOptions?.maxTokens ?? DEFAULTS.maxTokens,
      reasoningEffort:
        kv.get("llm.reasoningEffort") ?? pluginOptions?.reasoningEffort ?? DEFAULTS.reasoningEffort,
      retries: normalizeRetries(
        kv.get("llm.retries") ?? pluginOptions?.retries ?? DEFAULTS.retries,
      ),
    };
  }

  function getTTSConfig() {
    return {
      endpoint: kv.get("mimo.endpoint") ?? pluginOptions?.mimoEndpoint ?? TTS_DEFAULTS.endpoint,
      model: kv.get("mimo.ttsModel") ?? pluginOptions?.mimoTTSModel ?? TTS_DEFAULTS.model,
      apiKeyEnv: kv.get("mimo.apiKeyEnv") ?? pluginOptions?.mimoApiKeyEnv ?? TTS_DEFAULTS.apiKeyEnv,
      authHeader: TTS_DEFAULTS.authHeader,
    };
  }

  /**
   * Send a chat completion request to an OpenAI-compatible endpoint.
   *
   * @param {object} opts
   * @param {string} [opts.system]  - System prompt
   * @param {string} opts.prompt    - User message
   * @param {object} [opts.config]  - Per-call overrides (e.g. { maxTokens: 4096 })
   * @returns {Promise<{ text: string | null, error?: string }>}
   */
  async function complete({ system, prompt, config: overrides }) {
    const cfg = { ...getConfig(), ...overrides };

    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const body = {
      model: cfg.model,
      messages,
      [cfg.maxTokensParam]: cfg.maxTokens,
    };

    const result = await postChatCompletions(cfg, body);
    if (result.error) return { text: null, error: result.error };

    const text = result.data?.choices?.[0]?.message?.content || null;
    return { text, error: text ? undefined : "Empty LLM response" };
  }

  /**
   * Send a MiMo TTS request and return base64-encoded audio data.
   *
   * @param {object} opts
   * @param {string} opts.text       - Text to synthesize
   * @param {string} [opts.voice]    - MiMo built-in voice ID
   * @param {object} [opts.config]   - Per-call overrides
   * @param {AbortSignal} [opts.signal] - Optional cancellation signal
   * @returns {Promise<{ audioData: string | null, error?: string }>}
   */
  async function synthesize({ text, voice, config: overrides, signal }) {
    const cfg = { ...getTTSConfig(), ...overrides };
    const body = {
      model: cfg.model,
      messages: [{ role: "assistant", content: text }],
      audio: { format: "wav", voice },
    };

    const result = await postChatCompletions(cfg, body, signal);
    if (result.error) return { audioData: null, error: result.error };

    const audioData = result.data?.choices?.[0]?.message?.audio?.data || null;
    return { audioData, error: audioData ? undefined : "Empty TTS audio response" };
  }

  return { complete, synthesize };
}
