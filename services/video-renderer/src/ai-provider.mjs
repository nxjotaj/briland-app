const MODELS = Object.freeze({
  "kling-3-turbo": { path: "kling-video/v3.0-turbo", audio: false },
  "kling-3-pro": { path: "kling-video/v3.0/pro", audio: true },
  "seedance-2-fast": { path: "bytedance/seedance-2.0/fast", audio: true },
  "seedance-2.5": { path: "bytedance/seedance-2.5", audio: true },
  "wan-2.7": { path: "wan-video/wan-2.7", audio: false },
  "minimax-hailuo-2.3": { path: "minimax/hailuo-2.3", audio: false }
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function hasAiProviderConfiguration() {
  return Boolean(process.env.AI_VIDEO_API_BASE_URL?.trim() && process.env.AI_VIDEO_API_KEY?.trim());
}

export async function generateAiScene(job, onRequestId) {
  const baseUrl = process.env.AI_VIDEO_API_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.AI_VIDEO_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error("O provedor de vídeo por IA ainda não foi configurado no worker.");
  const ai = job.inputPayload?.ai || {};
  const model = MODELS[ai.model];
  if (!model) throw new Error("Modelo de IA não autorizado.");
  const imageUrl = job.inputPayload?.product?.imageUrl;
  const aspectRatio = job.format === "square" ? "1:1" : "9:16";
  const endpoint = imageUrl ? `${model.path}/image-to-video` : `${model.path}/text-to-video`;
  const submitted = await request(baseUrl, apiKey, "POST", `/${endpoint}`, {
    prompt: ai.prompt,
    duration: Math.min(10, Number(job.durationSeconds) || 10),
    resolution: ai.resolution || "1080p",
    aspect_ratio: aspectRatio,
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(model.audio ? { generate_audio: ai.generateAudio !== false, sound: ai.generateAudio !== false ? "on" : "off" } : {})
  });
  const requestId = submitted?.request_id;
  if (typeof requestId !== "string" || !requestId) throw new Error("O provedor não retornou o identificador da geração.");
  await onRequestId(requestId);

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(4000);
    const status = await request(baseUrl, apiKey, "GET", `/requests/${encodeURIComponent(requestId)}/status`);
    const state = String(status?.status || "").toLowerCase();
    const videoUrl = status?.video?.url;
    if (["completed", "succeeded", "success"].includes(state) && typeof videoUrl === "string") return { requestId, videoUrl };
    if (["failed", "error", "cancelled", "canceled"].includes(state)) throw new Error(`A geração por IA falhou: ${JSON.stringify(status?.error || state).slice(0, 800)}`);
  }
  throw new Error("A geração por IA excedeu o limite de 10 minutos.");
}

async function request(baseUrl, apiKey, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Key ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`Provedor de IA respondeu ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`.slice(0, 1200));
  return payload;
}
