"use client";

import { useRef, useState } from "react";
import { Check, Download, FileText } from "lucide-react";

type Progress = number | null;
type Props = { label: string; filename: string; prepare: (report: (progress: Progress) => void) => Promise<Blob>; className?: string; onComplete?: () => void; onError?: (error: unknown) => void };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fileSize = (bytes: number) => !bytes ? "PDF" : bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export async function remotePdf(url: string, report: (progress: Progress) => void) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("O PDF não está disponível.");
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) { report(null); return response.blob(); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let received = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); received += value.length; report(Math.min(99, Math.round(received / total * 100))); }
  return new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/pdf" });
}

export function AnimatedPdfDownload({ label, filename, prepare, className = "", onComplete, onError }: Props) {
  const [phase, setPhase] = useState<"idle" | "loading" | "launch" | "done">("idle");
  const [progress, setProgress] = useState<Progress>(0); const [size, setSize] = useState(""); const busy = useRef(false);
  const run = async () => {
    if (busy.current) return; busy.current = true; setProgress(null); setSize(""); setPhase("loading");
    try {
      const blob = await prepare(setProgress); setSize(fileSize(blob.size)); setProgress(100); setPhase("launch"); await wait(620);
      const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setPhase("done"); onComplete?.(); await wait(1250);
    } catch (error) { onError?.(error); }
    finally { busy.current = false; setPhase("idle"); setProgress(0); }
  };
  const percentage = progress == null ? null : Math.max(0, Math.min(100, progress));
  return <button type="button" className={`pdf-flight ${phase} ${className}`} onClick={() => void run()} disabled={phase !== "idle"} aria-live="polite">
    <span className="pdf-flight-stage"><span className="pdf-flight-ring"><Download size={18} strokeWidth={2.2}/></span><span className="pdf-flight-line"><i style={{width:percentage==null?"38%":`${percentage}%`}}/></span><span className="pdf-flight-file"><FileText size={17}/></span><span className="pdf-flight-check"><Check size={18} strokeWidth={3}/></span></span>
    <span className="pdf-flight-copy"><strong>{phase === "done" ? "Download iniciado" : label}</strong><small>{phase === "idle" ? filename : phase === "loading" ? (percentage == null ? "Preparando PDF…" : `${percentage}% · ${filename}`) : phase === "launch" ? `100% · ${size}` : `${size} · pronto`}</small></span>
    <style jsx>{`.pdf-flight{--ink:#101114;--paper:#fffdf7;display:inline-flex;min-height:54px;align-items:center;gap:12px;border:1px solid #d9d7cf;border-radius:18px;background:var(--paper);color:var(--ink);padding:7px 15px 7px 8px;text-align:left;cursor:pointer;box-shadow:0 5px 18px #1111;transition:transform .2s,box-shadow .2s}.pdf-flight:hover{transform:translateY(-1px);box-shadow:0 8px 22px #1112}.pdf-flight:disabled{cursor:default}.pdf-flight-stage{position:relative;display:block;width:42px;height:40px;flex:0 0 auto;transition:width .42s cubic-bezier(.65,0,.2,1)}.pdf-flight-ring{position:absolute;inset:1px;width:38px;height:38px;border:2px solid var(--ink);border-radius:50%;display:grid;place-items:center;background:var(--paper);z-index:2;transition:opacity .16s,transform .4s}.pdf-flight-line{position:absolute;left:19px;right:2px;top:18px;height:4px;border:2px solid var(--ink);border-radius:99px;opacity:0;overflow:hidden;background:var(--paper)}.pdf-flight-line i{display:block;height:100%;background:var(--ink);transition:width .18s linear}.pdf-flight-file,.pdf-flight-check{position:absolute;right:-1px;top:10px;opacity:0}.pdf-flight-copy{display:flex;flex-direction:column;min-width:112px;line-height:1.15}.pdf-flight-copy strong{font-size:13px;font-weight:800}.pdf-flight-copy small{margin-top:4px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#68665f;font-size:10px}.loading .pdf-flight-stage,.launch .pdf-flight-stage{width:142px}.loading .pdf-flight-ring,.launch .pdf-flight-ring{opacity:0;transform:translateX(-7px) scale(.72)}.loading .pdf-flight-line,.launch .pdf-flight-line{opacity:1;animation:unroll .46s cubic-bezier(.65,0,.2,1) both}.loading .pdf-flight-line i{animation:seeking 1.1s ease-in-out infinite}.launch .pdf-flight-file{opacity:1;animation:throw-file .62s cubic-bezier(.2,.8,.25,1) both}.launch .pdf-flight-line{animation:rope-snap .62s ease-out both}.done .pdf-flight-ring{border-color:#16834b;color:#16834b}.done .pdf-flight-ring> :global(svg){display:none}.done .pdf-flight-check{opacity:1;left:11px;top:11px;color:#16834b}.done .pdf-flight-copy strong{color:#16834b}@keyframes unroll{from{right:102px}to{right:2px}}@keyframes seeking{0%,100%{opacity:.45}50%{opacity:1}}@keyframes rope-snap{0%{transform:scaleX(1)}55%{transform:scaleX(.95) rotate(-2deg)}100%{transform:scaleX(0);opacity:0}}@keyframes throw-file{0%{transform:translate(0,0)}55%{transform:translate(8px,-25px) rotate(8deg);opacity:1}100%{transform:translate(26px,-39px) rotate(16deg);opacity:0}}@media(prefers-reduced-motion:reduce){.pdf-flight,.pdf-flight-stage,.pdf-flight-ring,.pdf-flight-line,.pdf-flight-file{animation:none!important;transition:none!important}}`}</style>
  </button>;
}
