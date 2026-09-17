"use client";

import { useRef, useState } from "react";
import { Check, Download, FileText } from "lucide-react";

type Props = { filename: string; prepare: () => Promise<Blob>; onComplete?: () => void; onError?: (error: unknown) => void };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readableSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export function AnimatedPdfDownload({ filename, prepare, onComplete, onError }: Props) {
  const [phase, setPhase] = useState<"idle" | "loading" | "launch" | "done">("idle");
  const [size, setSize] = useState(""); const busy = useRef(false);
  const run = async () => {
    if (busy.current) return; busy.current = true; setPhase("loading");
    try {
      const blob = await prepare(); setSize(readableSize(blob.size)); setPhase("launch"); await pause(620);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      setPhase("done"); onComplete?.(); await pause(1250);
    } catch (error) { onError?.(error); }
    finally { busy.current = false; setPhase("idle"); }
  };
  return <button type="button" className={`pdf-flight ${phase}`} onClick={() => void run()} disabled={phase !== "idle"} aria-live="polite">
    <span className="stage"><span className="ring"><Download size={17}/></span><span className="line"><i/></span><span className="file"><FileText size={16}/></span><span className="check"><Check size={17}/></span></span>
    <span className="copy"><strong>{phase === "done" ? "Download iniciado" : "PDF"}</strong><small>{phase === "idle" ? filename : phase === "loading" ? "Preparando PDF…" : phase === "launch" ? `100% · ${size}` : `${size} · pronto`}</small></span>
    <style jsx>{`.pdf-flight{--ink:#101114;--paper:#fffdf7;display:inline-flex;min-height:44px;align-items:center;gap:9px;border:1px solid #d9d7cf;border-radius:999px;background:var(--paper);color:var(--ink);padding:4px 13px 4px 5px;text-align:left;cursor:pointer;box-shadow:0 4px 14px #1111}.pdf-flight:disabled{cursor:default}.stage{position:relative;width:34px;height:34px;flex:none;transition:width .42s cubic-bezier(.65,0,.2,1)}.ring{position:absolute;inset:0;width:34px;height:34px;border:2px solid var(--ink);border-radius:50%;display:grid;place-items:center;background:var(--paper);z-index:2;transition:.4s}.line{position:absolute;left:17px;right:1px;top:15px;height:4px;border:2px solid var(--ink);border-radius:99px;opacity:0;overflow:hidden}.line i{display:block;width:42%;height:100%;background:var(--ink);animation:pulse 1s ease-in-out infinite}.file,.check{position:absolute;right:0;top:8px;opacity:0}.copy{display:flex;flex-direction:column;line-height:1.05}.copy strong{font-size:12px;font-weight:900}.copy small{max-width:130px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#666;font-size:9px}.loading .stage,.launch .stage{width:104px}.loading .ring,.launch .ring{opacity:0;transform:translateX(-6px) scale(.7)}.loading .line,.launch .line{opacity:1;animation:unroll .45s ease-out both}.launch .line{animation:snap .62s ease-out both}.launch .file{opacity:1;animation:throw .62s ease-out both}.done .ring{color:#16834b;border-color:#16834b}.done .ring> :global(svg){display:none}.done .check{opacity:1;left:9px;top:9px;color:#16834b}.done strong{color:#16834b}@keyframes unroll{from{right:75px}to{right:1px}}@keyframes pulse{50%{opacity:.35}}@keyframes snap{to{transform:scaleX(0);opacity:0}}@keyframes throw{0%{transform:none}55%{transform:translate(7px,-23px) rotate(8deg);opacity:1}100%{transform:translate(22px,-34px) rotate(15deg);opacity:0}}@media(prefers-reduced-motion:reduce){.stage,.ring,.line,.file{animation:none!important;transition:none!important}}`}</style>
  </button>;
}
