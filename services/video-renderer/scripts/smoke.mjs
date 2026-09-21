import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderComposition } from "../src/template.mjs";

const directory = await mkdtemp(join(tmpdir(), "briland-video-smoke-"));
const output = join(directory, "smoke.mp4");
const cli = fileURLToPath(new URL("../node_modules/hyperframes/bin/hyperframes.mjs", import.meta.url));

try {
  await writeFile(join(directory, "index.html"), renderComposition({
    id: "smoke",
    format: "square",
    durationSeconds: 1,
    templateKey: "commercial-offer",
    headline: "Produto Briland",
    subheadline: "Qualidade e confiança para o seu negócio.",
    cta: "Solicite uma cotação",
    inputPayload: { product: { name: "Produto Briland", code: "BRI-001", price: 199.9 } }
  }, null), "utf8");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "lint", ".", "--verbose"], {
      cwd: directory,
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Lint do template encerrou com código ${code}.`)));
  });

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "render", "-c", "./index.html", "-o", output], {
      cwd: directory,
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Render de teste encerrou com código ${code}.`)));
  });
  const result = await stat(output);
  if (result.size < 1000) throw new Error("O MP4 de teste foi criado vazio ou incompleto.");
  console.log(`Smoke test concluído: ${result.size} bytes.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
