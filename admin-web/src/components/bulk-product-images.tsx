"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, Images, Loader2, Upload, X } from "lucide-react";
import { createId, csvEscape, downloadBlob } from "@/lib/helpers";
import { removeCatalogMediaUrls, supabase, uploadCatalogBlob, uploadCatalogMedia } from "@/lib/supabase";
import type { Produto, Usuario } from "@/lib/types";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export type BulkImageIssue = "invalid-name" | "unsupported" | "too-large" | "missing-product" | "duplicate-product" | "duplicate-position" | "sequence-gap";
export type BulkImageCandidate = {
  id: string;
  file: File;
  fileName: string;
  code: string;
  position: number;
  product: Produto | null;
  issue: BulkImageIssue | null;
  message: string;
  previewUrl?: string;
};
export type BulkImageResult = { fileName: string; code: string; position: number; status: "Enviada" | "Rejeitada" | "Falhou"; message: string };

const normalizeCode = (value?: string | null) => String(value || "").trim().toLocaleUpperCase("pt-BR");
const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() || "";

export function analyzeBulkImageFiles(files: File[], products: Produto[]): BulkImageCandidate[] {
  const productsByCode = new Map<string, Produto[]>();
  for (const product of products) {
    const code = normalizeCode(product.codigoInterno);
    if (!code) continue;
    productsByCode.set(code, [...(productsByCode.get(code) || []), product]);
  }

  const rows = files.map((file, index): BulkImageCandidate => {
    const baseName = file.name.replace(/\.[^.]+$/, "").trim();
    const match = baseName.match(/^(.*)-([1-9]\d*)$/);
    if (!match) return { id: `${index}-${file.name}`, file, fileName: file.name, code: "", position: 0, product: null, issue: "invalid-name", message: "Use o padrão CODIGO-1.jpg, CODIGO-2.jpg e assim por diante." };
    const code = match[1].trim();
    const position = Number(match[2]);
    if (!SUPPORTED_EXTENSIONS.has(extensionOf(file.name))) return { id: `${index}-${file.name}`, file, fileName: file.name, code, position, product: null, issue: "unsupported", message: "Formato não aceito. Use JPG, JPEG, PNG ou WebP." };
    if (file.size > MAX_FILE_BYTES) return { id: `${index}-${file.name}`, file, fileName: file.name, code, position, product: null, issue: "too-large", message: "A imagem ultrapassa o limite de 50 MB." };
    const matches = productsByCode.get(normalizeCode(code)) || [];
    if (!matches.length) return { id: `${index}-${file.name}`, file, fileName: file.name, code, position, product: null, issue: "missing-product", message: `Não existe produto com o código ${code}.` };
    if (matches.length > 1) return { id: `${index}-${file.name}`, file, fileName: file.name, code, position, product: null, issue: "duplicate-product", message: `Existem ${matches.length} produtos com o código ${code}; corrija o cadastro antes de importar.` };
    return { id: `${index}-${file.name}`, file, fileName: file.name, code, position, product: matches[0], issue: null, message: position === 1 ? "Substituirá a imagem principal." : `Substituirá a posição ${position - 1} das imagens extras.` };
  });

  const byPosition = new Map<string, BulkImageCandidate[]>();
  for (const row of rows.filter((item) => !item.issue && item.product)) {
    const key = `${row.product!.id}:${row.position}`;
    byPosition.set(key, [...(byPosition.get(key) || []), row]);
  }
  for (const duplicates of byPosition.values()) {
    if (duplicates.length < 2) continue;
    for (const row of duplicates) {
      row.issue = "duplicate-position";
      row.message = `Mais de um arquivo foi informado para a posição ${row.position} do produto ${row.code}.`;
    }
  }

  const byProduct = new Map<string, BulkImageCandidate[]>();
  for (const row of rows.filter((item) => !item.issue && item.product && item.position >= 2)) {
    byProduct.set(row.product!.id, [...(byProduct.get(row.product!.id) || []), row]);
  }
  for (const productRows of byProduct.values()) {
    const product = productRows[0].product!;
    const positions = new Set(productRows.map((row) => row.position));
    const firstNewPosition = (product.imagensExtras?.length || 0) + 2;
    const highest = Math.max(...positions);
    for (let position = firstNewPosition; position <= highest; position += 1) {
      if (positions.has(position)) continue;
      for (const row of productRows.filter((item) => item.position > position)) {
        row.issue = "sequence-gap";
        row.message = `Falta o arquivo ${row.code}-${position} antes desta posição.`;
      }
      break;
    }
  }
  return rows;
}

async function compressImage(file: File, maxWidth: number, maxHeight: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("O navegador não conseguiu preparar a imagem."); }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("O navegador não conseguiu compactar a imagem.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
}

async function uploadMainVariants(file: File, productId: string) {
  const safeKey = productId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const version = `${Date.now()}-${safeKey}`;
  const [cardFile, detailFile] = await Promise.all([compressImage(file, 640, 480, 0.8), compressImage(file, 1600, 1200, 0.88)]);
  const uploads = await Promise.allSettled([
    uploadCatalogMedia(file, "produtos/original"),
    uploadCatalogBlob(`produtos/card/${version}.webp`, cardFile, "image/webp"),
    uploadCatalogBlob(`produtos/detalhe/${version}.webp`, detailFile, "image/webp")
  ]);
  const completedUrls = uploads.filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled").map((result) => result.value);
  const failed = uploads.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    try { await removeCatalogMediaUrls(completedUrls); } catch { /* Preserva o erro original do upload. */ }
    throw failed.reason;
  }
  const [original, card, detail] = completedUrls;
  return { original, card, detail };
}

function productImageUrls(product: Produto) {
  return [product.imagemOriginal, product.imagemPrincipal, product.imagemCard, product.imagemDetalhe, ...(product.imagensExtras || [])].filter((url): url is string => Boolean(url));
}

function referencedByAnotherProduct(url: string, productId: string, products: Produto[]) {
  return products.some((product) => product.id !== productId && productImageUrls(product).includes(url));
}

function readableUploadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/payload too large|maximum.*size|file size|413/i.test(message)) return "A imagem ultrapassa o limite permitido.";
  if (/mime|content.?type|unsupported|image/i.test(message)) return "O arquivo não pôde ser reconhecido como uma imagem válida.";
  if (/network|fetch|timeout|failed to connect/i.test(message)) return "A conexão foi interrompida durante o envio. Tente novamente.";
  if (/permission|policy|row-level|forbidden|unauthorized/i.test(message)) return "Sua conta não possui autorização para atualizar estas imagens.";
  return "Não foi possível concluir as imagens deste produto. As fotos anteriores foram preservadas.";
}

async function runWorkers<T>(items: T[], worker: (item: T) => Promise<void>, concurrency = 3) {
  let cursor = 0;
  const run = async () => { while (cursor < items.length) await worker(items[cursor++]); };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function statusTone(row: BulkImageCandidate) {
  return row.issue ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800";
}

export function BulkProductImages({ products, adminUser, reload, notify }: { products: Produto[]; adminUser: Usuario; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [rows, setRows] = useState<BulkImageCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: "" });
  const [results, setResults] = useState<BulkImageResult[]>([]);
  const previewUrls = useRef<string[]>([]);
  const validRows = useMemo(() => rows.filter((row) => !row.issue && row.product), [rows]);
  const productCount = useMemo(() => new Set(validRows.map((row) => row.product!.id)).size, [validRows]);

  useEffect(() => () => { previewUrls.current.forEach(URL.revokeObjectURL); }, []);

  const selectFiles = (selected: FileList | null) => {
    if (!selected?.length || running) return;
    previewUrls.current.forEach(URL.revokeObjectURL);
    previewUrls.current = [];
    setRows(analyzeBulkImageFiles(Array.from(selected), products).map((row) => {
      const previewUrl = URL.createObjectURL(row.file);
      previewUrls.current.push(previewUrl);
      return { ...row, previewUrl };
    }));
    setResults([]);
    setProgress({ completed: 0, total: 0, current: "" });
    setOpen(true);
  };

  const processBatch = async () => {
    if (!validRows.length || running) return;
    setRunning(true);
    setResults(rows.filter((row) => row.issue).map((row) => ({ fileName: row.fileName, code: row.code, position: row.position, status: "Rejeitada", message: row.message })));
    setProgress({ completed: 0, total: validRows.length, current: "Preparando imagens" });
    let completed = 0;
    const productGroups = Array.from(validRows.reduce<Map<string, BulkImageCandidate[]>>((map, row) => map.set(row.product!.id, [...(map.get(row.product!.id) || []), row]), new Map()).values());
    const successfulProducts = new Set<string>();
    const operationResults: BulkImageResult[] = [];

    await runWorkers(productGroups, async (group) => {
      const product = group[0].product!;
      const uploadedUrls: string[] = [];
      const replacedUrls: string[] = [];
      let processedInGroup = 0;
      const payload: Partial<Produto> = { imagensExtras: [...(product.imagensExtras || [])], updatedAt: new Date().toISOString() };
      try {
        for (const row of group.sort((a, b) => a.position - b.position)) {
          setProgress((current) => ({ ...current, current: `${row.code} · foto ${row.position}` }));
          if (row.position === 1) {
            replacedUrls.push(...[product.imagemOriginal, product.imagemPrincipal, product.imagemCard, product.imagemDetalhe].filter((url): url is string => Boolean(url)));
            const variants = await uploadMainVariants(row.file, product.id);
            uploadedUrls.push(variants.original, variants.card, variants.detail);
            payload.imagemOriginal = variants.original;
            payload.imagemPrincipal = variants.detail;
            payload.imagemCard = variants.card;
            payload.imagemDetalhe = variants.detail;
          } else {
            const index = row.position - 2;
            const extras = payload.imagensExtras as string[];
            if (extras[index]) replacedUrls.push(extras[index]);
            const compressed = await compressImage(row.file, 1600, 1200, 0.88);
            const url = await uploadCatalogMedia(compressed, "produtos/extras");
            uploadedUrls.push(url);
            extras[index] = url;
          }
          completed += 1;
          processedInGroup += 1;
          setProgress({ completed, total: validRows.length, current: `${row.code} · foto ${row.position}` });
        }
        const { error } = await supabase.from("Produto").update(payload).eq("id", product.id);
        if (error) throw error;
        successfulProducts.add(product.id);
        operationResults.push(...group.map((row) => ({ fileName: row.fileName, code: row.code, position: row.position, status: "Enviada" as const, message: "Imagem vinculada ao produto." })));
        const updatedProduct = { ...product, ...payload } as Produto;
        const safeToRemove = Array.from(new Set(replacedUrls)).filter((url) => !uploadedUrls.includes(url) && !productImageUrls(updatedProduct).includes(url) && !referencedByAnotherProduct(url, product.id, products));
        try { await removeCatalogMediaUrls(safeToRemove); } catch { /* A limpeza não pode desfazer uma atualização concluída. */ }
      } catch (error) {
        try { await removeCatalogMediaUrls(uploadedUrls); } catch { /* Mantém o erro original no relatório. */ }
        const message = readableUploadError(error);
        operationResults.push(...group.map((row) => ({ fileName: row.fileName, code: row.code, position: row.position, status: "Falhou" as const, message })));
        completed += group.length - processedInGroup;
        setProgress((current) => ({ ...current, completed }));
      }
      setResults([...rows.filter((row) => row.issue).map((row) => ({ fileName: row.fileName, code: row.code, position: row.position, status: "Rejeitada" as const, message: row.message })), ...operationResults]);
    });

    const rejected = rows.length - validRows.length;
    const failures = operationResults.filter((row) => row.status === "Falhou").length;
    await supabase.from("AuditLog").insert({
      id: createId("audit"), actorUserId: adminUser.id, actorEmail: adminUser.email,
      action: "bulk_product_image_upload", entityType: "Produto", entityId: null,
      metadata: { source: "admin-web", selectedFiles: rows.length, processedImages: validRows.length, updatedProducts: successfulProducts.size, rejectedImages: rejected, failedImages: failures }
    });
    setRunning(false);
    setProgress((current) => ({ ...current, completed: validRows.length, current: "Processamento concluído" }));
    notify(`${successfulProducts.size} produto(s) atualizado(s); ${rejected + failures} imagem(ns) precisam de revisão.`);
    await reload();
  };

  const exportReport = () => {
    const reportRows = results.length ? results : rows.map((row) => ({ fileName: row.fileName, code: row.code, position: row.position, status: row.issue ? "Rejeitada" as const : "Aprovada", message: row.message }));
    const csv = ["Arquivo,Código,Posição,Status,Mensagem", ...reportRows.map((row) => [row.fileName, row.code, row.position, row.status, row.message].map(csvEscape).join(","))].join("\n");
    downloadBlob(`relatorio-fotos-produtos-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  };

  const close = () => { if (!running) { previewUrls.current.forEach(URL.revokeObjectURL); previewUrls.current = []; setOpen(false); setRows([]); setResults([]); } };
  const folderAttributes = { webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>;

  return <>
    <label className={`btn-white cursor-pointer ${running ? "pointer-events-none opacity-60" : ""}`}><Images size={17} /> Enviar fotos em massa<input className="hidden" type="file" accept=".jpg,.jpeg,.png,.webp" multiple onChange={(event) => { selectFiles(event.target.files); event.target.value = ""; }} /></label>
    <label className={`btn-white cursor-pointer ${running ? "pointer-events-none opacity-60" : ""}`}><FolderOpen size={17} /> Selecionar pasta<input className="hidden" type="file" accept=".jpg,.jpeg,.png,.webp" multiple {...folderAttributes} onChange={(event) => { selectFiles(event.target.files); event.target.value = ""; }} /></label>
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/55 p-4 backdrop-blur-sm"><div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-line p-5 lg:p-6"><div><div className="text-xs font-black uppercase tracking-[.18em] text-blue-800">Fotos de produtos</div><h2 className="mt-1 text-2xl font-black">Conferência do envio em massa</h2><p className="mt-2 text-sm font-semibold text-muted">{rows.length} arquivo(s) selecionado(s) · {validRows.length} aprovado(s) · {productCount} produto(s)</p></div><button onClick={close} disabled={running} className="icon-btn disabled:opacity-40" aria-label="Fechar"><X size={18} /></button></div>
      {running && <div className="border-b border-line bg-blue-50 px-6 py-4"><div className="mb-2 flex justify-between text-sm font-black"><span>{progress.current}</span><span>{progress.completed}/{progress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></div></div>}
      <div className="min-h-0 flex-1 overflow-auto p-5 lg:p-6"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="p-3">Prévia</th><th className="p-3">Arquivo</th><th className="p-3">Produto</th><th className="p-3">Posição</th><th className="p-3">Situação</th><th className="p-3">Foto atual</th></tr></thead><tbody>{rows.map((row) => { const current = row.product ? row.position === 1 ? (row.product.imagemCard || row.product.imagemPrincipal) : row.product.imagensExtras?.[row.position - 2] : ""; return <tr key={row.id} className="border-b border-line/70 align-top"><td className="p-3"><img src={row.previewUrl} alt="" className="h-14 w-16 rounded-lg bg-soft object-contain" /></td><td className="max-w-56 break-all p-3 font-bold">{row.fileName}</td><td className="p-3"><div className="font-black">{row.product?.codigoInterno || row.code || "Não identificado"}</div><div className="max-w-56 truncate text-xs text-muted">{row.product?.nome || "Produto não encontrado"}</div></td><td className="p-3 font-black">{row.position || "-"}</td><td className="p-3"><span className={`status-pill ${statusTone(row)}`}>{row.issue ? "Revisar" : "Aprovada"}</span><div className="mt-2 max-w-72 text-xs font-semibold text-muted">{row.message}</div></td><td className="p-3">{current ? <img src={current} alt="" className="h-14 w-16 rounded-lg bg-soft object-contain" /> : <span className="text-xs font-semibold text-muted">Sem foto nesta posição</span>}</td></tr>; })}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50 p-4 lg:px-6"><button onClick={exportReport} className="btn-white"><Download size={16} /> Baixar relatório CSV</button><div className="flex gap-3"><button onClick={close} disabled={running} className="btn-white disabled:opacity-40">Fechar</button><button onClick={() => void processBatch()} disabled={running || !validRows.length || results.length > 0} className="btn-yellow disabled:pointer-events-none disabled:opacity-50">{running ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />} {running ? "Enviando..." : results.length ? "Processamento concluído" : `Confirmar ${validRows.length} imagem(ns)`}</button></div></div>
    </div></div>}
  </>;
}
