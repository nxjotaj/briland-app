import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderComposition } from "../src/template.mjs";
import { addSoundtrack } from "../src/soundtrack.mjs";

const directory = await mkdtemp(join(tmpdir(), "briland-video-smoke-"));
const silentOutput = join(directory, "silent.mp4");
const output = join(directory, "smoke.mp4");
const scene = join(directory, "ai-scene.mp4");
const cli = fileURLToPath(new URL("../node_modules/hyperframes/bin/hyperframes.mjs", import.meta.url));
const windowsChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH || (process.platform === "win32" && existsSync(windowsChromePath) ? windowsChromePath : "");
const renderEnvironment = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", ...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}) };

try {
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x175a9f:s=1080x1080:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", scene], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Cena sintética encerrou com código ${code}.`)));
  });
  await copyFile(fileURLToPath(new URL("../assets/briland-logo.png", import.meta.url)), join(directory, "briland-logo.png"));
  await writeFile(join(directory, "index.html"), renderComposition({
    id: "smoke",
    format: "square",
    durationSeconds: 1,
    templateKey: "commercial-offer",
    headline: "Produto Briland",
    subheadline: "Qualidade e confiança para o seu negócio.",
    cta: "Solicite uma cotação",
    inputPayload: { product: { name: "Produto Briland", code: "BRI-001", price: 199.9 } }
  }, null, "briland-logo.png", "ai-scene.mp4"), "utf8");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "lint", ".", "--verbose"], {
      cwd: directory,
      env: renderEnvironment,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Lint do template encerrou com código ${code}.`)));
  });

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "render", "-c", "./index.html", "-o", silentOutput], {
      cwd: directory,
      env: renderEnvironment,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Render de teste encerrou com código ${code}.`)));
  });
  await addSoundtrack(silentOutput, output, 1);
  const probe = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", output]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  });
  if (probe !== "aac") throw new Error(`Faixa de áudio AAC não encontrada (resultado: ${probe || "vazio"}).`);
  const meanVolume = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-i", output, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim()));
      const match = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
      return match ? resolve(Number(match[1])) : reject(new Error("Não foi possível medir o volume médio do áudio."));
    });
  });
  if (meanVolume < -22) throw new Error(`Áudio praticamente inaudível: ${meanVolume} dB de volume médio.`);
  const result = await stat(output);
  if (result.size < 1000) throw new Error("O MP4 de teste foi criado vazio ou incompleto.");
  console.log(`Smoke test concluído: ${result.size} bytes, áudio AAC audível (${meanVolume} dB).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
