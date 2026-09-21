import { spawn } from "node:child_process";

export async function addSoundtrack(inputPath, outputPath, duration) {
  const fadeOutStart = Math.max(0, duration - 1.2);
  const filter = [
    "sine=frequency=196:sample_rate=48000[a0]",
    "sine=frequency=246.94:sample_rate=48000[a1]",
    "sine=frequency=293.66:sample_rate=48000[a2]",
    `[a0][a1][a2]amix=inputs=3:weights='0.50 0.32 0.22':normalize=0,tremolo=f=2:d=0.18,volume=0.10,afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart}:d=1.2`
  ].join(";");

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-i", inputPath, "-f", "lavfi", "-i", filter, "-t", String(duration),
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart", "-shortest", outputPath
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-5000); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg encerrou com código ${code}: ${stderr.trim()}`)));
  });
}
