import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderComposition } from "./template.mjs";
import { addSoundtrack } from "./soundtrack.mjs";
import { generateAiScene } from "./ai-provider.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
};

const supabaseUrl = required("SUPABASE_URL");
const supabase = createClient(supabaseUrl, required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false }
});
const workerId = process.env.VIDEO_WORKER_ID?.trim() || `video-worker-${process.pid}`;
const pollInterval = Math.max(1000, Number(process.env.VIDEO_POLL_INTERVAL_MS) || 5000);
const allowedHosts = new Set([
  new URL(supabaseUrl).hostname,
  ...String(process.env.VIDEO_ALLOWED_MEDIA_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean)
]);
const cliPath = fileURLToPath(new URL("../node_modules/hyperframes/bin/hyperframes.mjs", import.meta.url));
const logoPath = fileURLToPath(new URL("../assets/briland-logo.png", import.meta.url));
const windowsChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH || (process.platform === "win32" && existsSync(windowsChromePath) ? windowsChromePath : "");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function updateJob(id, values) {
  const { error } = await supabase.from("VideoRenderJob").update({ ...values, updatedAt: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

async function downloadProductImage(urlValue, directory) {
  if (!urlValue) return null;
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error("A imagem do produto está em um host não autorizado.");
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error(`Não foi possível baixar a imagem do produto (${response.status}).`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error("O arquivo do produto não é uma imagem válida.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error("A imagem do produto ultrapassa 15 MB.");
  const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  const fileName = `product${extension}`;
  await writeFile(join(directory, fileName), bytes);
  return fileName;
}

async function downloadGeneratedVideo(urlValue, directory) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:") throw new Error("O provedor retornou uma URL de vídeo insegura.");
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Não foi possível baixar a cena gerada (${response.status}).`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("video/") && !url.pathname.toLowerCase().endsWith(".mp4")) throw new Error("O provedor não retornou um vídeo válido.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 300 * 1024 * 1024) throw new Error("A cena gerada ultrapassa 300 MB.");
  const fileName = "ai-scene.mp4";
  await writeFile(join(directory, fileName), bytes);
  return fileName;
}

async function runRender(directory, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "render", "-c", "./index.html", "-o", outputPath], {
      cwd: directory,
      env: { ...process.env, CI: "1", HYPERFRAMES_NO_TELEMETRY: "1", ...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-5000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`HyperFrames encerrou com código ${code}: ${stderr.trim()}`)));
  });
}

async function processJob(job) {
  const directory = await mkdtemp(join(tmpdir(), "briland-video-"));
  try {
    const imageFileName = await downloadProductImage(job.inputPayload?.product?.imageUrl, directory);
    let sceneVideoFileName = null;
    if (job.generationMode === "ai" || job.inputPayload?.ai) {
      await updateJob(job.id, { status: "PREPARING", progress: 10 });
      const generated = await generateAiScene(job, async (requestId) => {
        await updateJob(job.id, { providerRequestId: requestId, progress: 15 });
      });
      sceneVideoFileName = await downloadGeneratedVideo(generated.videoUrl, directory);
      await updateJob(job.id, { progress: 22 });
    }
    const logoFileName = "briland-logo.png";
    await copyFile(logoPath, join(directory, logoFileName));
    await writeFile(join(directory, "index.html"), renderComposition(job, imageFileName, logoFileName, sceneVideoFileName), "utf8");
    await updateJob(job.id, { status: "RENDERING", progress: 25 });
    const silentOutputPath = join(directory, "silent.mp4");
    const outputPath = join(directory, "output.mp4");
    await runRender(directory, silentOutputPath);
    await addSoundtrack(silentOutputPath, outputPath, job.durationSeconds);
    await updateJob(job.id, { status: "UPLOADING", progress: 90 });
    const video = await readFile(outputPath);
    const storageKey = `products/${job.productId}/${job.id}.mp4`;
    const { error: uploadError } = await supabase.storage.from("marketing-videos").upload(storageKey, video, {
      contentType: "video/mp4", cacheControl: "31536000", upsert: false
    });
    if (uploadError) throw uploadError;
    await updateJob(job.id, {
      status: "COMPLETED", progress: 100, outputStorageKey: storageKey,
      finishedAt: new Date().toISOString(), errorMessage: null
    });
    console.log(`[${job.id}] vídeo concluído: ${basename(storageKey)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na renderização.";
    await updateJob(job.id, { status: "FAILED", progress: 100, errorMessage: message.slice(0, 2000), finishedAt: new Date().toISOString() });
    console.error(`[${job.id}] ${message}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function claimJob() {
  const { data, error } = await supabase.rpc("claim_next_video_render_job", { p_worker_id: workerId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

console.log(`Worker ${workerId} iniciado; aguardando jobs.`);
for (;;) {
  try {
    const job = await claimJob();
    if (job) await processJob(job);
    else await wait(pollInterval);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await wait(pollInterval);
  }
}
