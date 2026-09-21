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
const cli = fileURLToPath(new URL("../node_modules/hyperframes/bin/hyperframes.mjs", import.meta.url));
const windowsChromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserPath = process.env.HYPERFRAMES_BROWSER_PATH || (process.platform === "win32" && existsSync(windowsChromePath) ? windowsChromePath : "");
const renderEnvironment = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", ...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}) };

try {
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
  }, null, "briland-logo.png"), "utf8");

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
  const result = await stat(output);
  if (result.size < 1000) throw new Error("O MP4 de teste foi criado vazio ou incompleto.");
  console.log(`Smoke test concluído: ${result.size} bytes, vídeo com áudio AAC.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
