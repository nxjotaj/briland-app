"use client";

import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, Loader2, Play, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Produto, VideoRenderJob, VideoRenderFormat, VideoTemplateKey } from "@/lib/types";
import brilandLogo from "../../../assets/briland-logo.png";

const templates: Array<{ key: VideoTemplateKey; name: string; description: string }> = [
  { key: "product-spotlight", name: "Destaque de produto", description: "Apresentação limpa com imagem, nome e chamada comercial." },
  { key: "commercial-offer", name: "Oferta comercial", description: "Preço em evidência e chamada direta para conversão." },
  { key: "new-arrival", name: "Lançamento", description: "Entrada dinâmica para novidades e produtos recém-chegados." }
];

const statusLabel: Record<VideoRenderJob["status"], string> = {
  QUEUED: "Na fila", PREPARING: "Preparando", RENDERING: "Renderizando", UPLOADING: "Enviando",
  COMPLETED: "Concluído", FAILED: "Falhou", CANCELLED: "Cancelado"
};

const statusTone: Record<VideoRenderJob["status"], string> = {
  QUEUED: "bg-amber-100 text-amber-800", PREPARING: "bg-blue-100 text-blue-800", RENDERING: "bg-blue-100 text-blue-800",
  UPLOADING: "bg-violet-100 text-violet-800", COMPLETED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800", CANCELLED: "bg-slate-100 text-slate-700"
};

export function VideoStudio({ products, notify }: { products: Produto[]; notify: (message: string) => void }) {
  const availableProducts = useMemo(() => products.filter((product) => product.ativo !== false), [products]);
  const [jobs, setJobs] = useState<VideoRenderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [productId, setProductId] = useState(availableProducts[0]?.id || "");
  const [templateKey, setTemplateKey] = useState<VideoTemplateKey>("product-spotlight");
  const [format, setFormat] = useState<VideoRenderFormat>("vertical");
  const [duration, setDuration] = useState<10 | 15 | 30>(10);
  const selectedProduct = availableProducts.find((product) => product.id === productId);
  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [cta, setCta] = useState("Solicite uma cotação");

  useEffect(() => {
    if (!productId && availableProducts[0]) setProductId(availableProducts[0].id);
  }, [availableProducts, productId]);

  useEffect(() => {
    if (!selectedProduct) return;
    setHeadline(selectedProduct.nome);
    setSubheadline(selectedProduct.descricaoCurta || "Qualidade e confiança para o seu negócio.");
  }, [selectedProduct?.id]);

  const loadJobs = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("VideoRenderJob").select("*").order("createdAt", { ascending: false }).limit(50).returns<VideoRenderJob[]>();
    setLoading(false);
    if (error) return notify(`Não foi possível carregar os vídeos: ${error.message}`);
    setJobs(data || []);
  };

  useEffect(() => {
    void loadJobs();
    const channel = supabase.channel("admin-video-render-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "VideoRenderJob" }, () => void loadJobs())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const submit = async () => {
    if (!selectedProduct) return notify("Selecione um produto.");
    const request = {
      productId: selectedProduct.id,
      templateKey,
      format,
      durationSeconds: duration,
      headline: headline.trim(),
      subheadline: subheadline.trim(),
      cta: cta.trim()
    };
    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_video_render_job", {
      p_product_id: request.productId,
      p_template_key: request.templateKey,
      p_format: request.format,
      p_duration_seconds: request.durationSeconds,
      p_headline: request.headline,
      p_subheadline: request.subheadline,
      p_cta: request.cta
    });
    setSubmitting(false);
    if (error) return notify(`Não foi possível solicitar o vídeo: ${error.message}`);
    const created = (Array.isArray(data) ? data[0] : data) as VideoRenderJob | null;
    if (!created || created.format !== request.format || created.headline !== request.headline || (created.subheadline || "") !== request.subheadline || (created.cta || "") !== request.cta) {
      return notify("O servidor não confirmou as opções editadas. O vídeo não será tratado como válido.");
    }
    notify("Vídeo adicionado à fila de renderização.");
    await loadJobs();
  };

  const cancel = async (jobId: string) => {
    const { error } = await supabase.rpc("cancel_video_render_job", { p_job_id: jobId });
    if (error) return notify(error.message);
    notify("Renderização cancelada.");
    await loadJobs();
  };

  const download = async (job: VideoRenderJob) => {
    if (!job.outputStorageKey) return;
    const { data, error } = await supabase.storage.from("marketing-videos").createSignedUrl(job.outputStorageKey, 300, { download: true });
    if (error || !data?.signedUrl) return notify(`Não foi possível preparar o download: ${error?.message || "arquivo indisponível"}`);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (job: VideoRenderJob) => {
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return notify("Cancele ou aguarde a renderização antes de excluir.");
    if (!window.confirm("Excluir permanentemente este vídeo e seu arquivo?")) return;
    setDeletingId(job.id);
    try {
      if (job.outputStorageKey) {
        const { error: storageError } = await supabase.storage.from("marketing-videos").remove([job.outputStorageKey]);
        if (storageError) return notify(`Não foi possível excluir o arquivo: ${storageError.message}`);
      }
      const { error } = await supabase.rpc("delete_video_render_job", { p_job_id: job.id });
      if (error) return notify(`Não foi possível excluir o vídeo: ${error.message}`);
      notify("Vídeo excluído permanentemente.");
      await loadJobs();
    } finally {
      setDeletingId(null);
    }
  };

  const imageUrl = selectedProduct?.imagemDetalhe || selectedProduct?.imagemPrincipal || selectedProduct?.imagemOriginal || "";
  const price = selectedProduct?.preco != null ? Number(selectedProduct.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Consulte";

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-[30px] bg-navy p-6 text-white shadow-soft lg:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-black uppercase tracking-[.16em]"><Sparkles size={14} /> Marketing</div><h2 className="mt-4 text-3xl font-black">Estúdio de Vídeos</h2><p className="mt-2 max-w-2xl text-sm font-semibold text-white/65">Transforme os produtos do catálogo em vídeos padronizados da Briland. A renderização ocorre em um serviço isolado e o resultado fica protegido no Storage.</p></div>
        <div className="rounded-2xl bg-white/10 px-5 py-4"><div className="text-3xl font-black">{jobs.filter((job) => ["QUEUED", "PREPARING", "RENDERING", "UPLOADING"].includes(job.status)).length}</div><div className="text-xs font-bold text-white/60">em processamento</div></div>
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
      <section className="panel-card p-5 lg:p-6">
        <h3 className="text-lg font-black">Novo vídeo</h3>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Produto</span><select className="input" value={productId} onChange={(event) => { const next = availableProducts.find((item) => item.id === event.target.value); setProductId(event.target.value); setHeadline(next?.nome || ""); setSubheadline(next?.descricaoCurta || "Qualidade e confiança para o seu negócio."); }}><option value="">Selecione</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.codigoInterno ? `${product.codigoInterno} — ` : ""}{product.nome}</option>)}</select></label>
          <label><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Formato</span><select className="input" value={format} onChange={(event) => setFormat(event.target.value as VideoRenderFormat)}><option value="vertical">Vertical · Reels/Stories</option><option value="square">Quadrado · Feed</option></select></label>
          <label><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Duração</span><select className="input" value={duration} onChange={(event) => setDuration(Number(event.target.value) as 10 | 15 | 30)}><option value={10}>10 segundos</option><option value={15}>15 segundos</option><option value={30}>30 segundos</option></select></label>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{templates.map((template) => <button type="button" key={template.key} onClick={() => setTemplateKey(template.key)} className={`rounded-2xl border p-4 text-left transition ${templateKey === template.key ? "border-blue-700 bg-blue-50 ring-2 ring-blue-100" : "border-line bg-white hover:border-blue-300"}`}><div className="font-black">{template.name}</div><div className="mt-2 text-xs font-semibold text-muted">{template.description}</div></button>)}</div>
        <div className="mt-5 space-y-4">
          <label><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Título</span><input className="input" maxLength={100} value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
          <label><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Texto complementar</span><textarea className="input min-h-24" maxLength={180} value={subheadline} onChange={(event) => setSubheadline(event.target.value)} /></label>
          <label><span className="mb-2 block text-xs font-black uppercase tracking-wider text-muted">Chamada final</span><input className="input" maxLength={80} value={cta} onChange={(event) => setCta(event.target.value)} /></label>
        </div>
        <button type="button" className="btn-primary mt-6" disabled={submitting || !selectedProduct} onClick={() => void submit()}>{submitting ? <Loader2 className="animate-spin" size={17} /> : <Play size={17} />} Gerar vídeo</button>
      </section>

      <section className="panel-card p-5 lg:p-6"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-black">Prévia do layout</h3><span className="rounded-full bg-soft px-3 py-1 text-xs font-black">{format === "vertical" ? "9:16" : "1:1"}</span></div>
        <div className={`relative mx-auto overflow-hidden rounded-[28px] bg-gradient-to-br from-[#061a38] via-[#0a3971] to-[#1372c4] shadow-2xl ${format === "vertical" ? "aspect-[9/16] max-h-[620px]" : "aspect-square max-w-[560px]"}`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,210,0,.45),transparent_34%)]" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-[7%] text-white"><img src={brilandLogo.src} alt="Briland" className="h-auto w-[34%] max-w-[180px] brightness-0 invert" /><Clapperboard className="text-yellow" /></div>
          <div className={`absolute flex items-center justify-center overflow-hidden rounded-[24px] bg-white/95 p-[6%] ${format === "vertical" ? "inset-x-[7%] top-[18%] bottom-[34%]" : "left-[7%] top-[23%] bottom-[12%] w-[43%]"}`}>{imageUrl ? <img src={imageUrl} alt={selectedProduct?.nome || "Produto"} className="h-full w-full object-contain" /> : <div className="text-center text-sm font-black text-slate-400">Produto sem imagem</div>}</div>
          <div className={`absolute text-white ${format === "vertical" ? "inset-x-[7%] bottom-[7%]" : "bottom-[12%] left-[55%] right-[7%] top-[23%] flex flex-col justify-center"}`}>{headline && <div className="line-clamp-2 text-[clamp(20px,4vw,42px)] font-black leading-tight">{headline}</div>}{subheadline && <div className="mt-2 line-clamp-3 text-[clamp(11px,1.5vw,17px)] font-semibold text-white/70">{subheadline}</div>}{templateKey === "commercial-offer" && <div className="mt-3 text-[clamp(18px,3vw,34px)] font-black text-yellow">{price}</div>}{cta && <div className="mt-4 inline-flex self-start rounded-full bg-yellow px-4 py-2 text-xs font-black text-navy">{cta}</div>}</div>
        </div><p className="mt-4 text-center text-xs font-semibold text-muted">Prévia visual. Movimento, transições e qualidade final são aplicados pelo renderizador.</p>
      </section>
    </div>

    <section className="panel-card overflow-hidden"><div className="flex items-center justify-between border-b border-line p-5 lg:p-6"><div><h3 className="text-lg font-black">Histórico de renderizações</h3><p className="mt-1 text-xs font-semibold text-muted">Os arquivos concluídos são privados e baixados por link temporário.</p></div><button className="btn-white" onClick={() => void loadJobs()} disabled={loading}>{loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left"><thead className="bg-soft text-xs uppercase tracking-wider text-muted"><tr><th className="p-4">Solicitação</th><th className="p-4">Produto</th><th className="p-4">Formato</th><th className="p-4">Status</th><th className="p-4">Progresso</th><th className="p-4 text-right">Ações</th></tr></thead><tbody className="divide-y divide-line">{jobs.map((job) => { const product = products.find((item) => item.id === job.productId); const canDelete = ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status); return <tr key={job.id}><td className="p-4"><div className="font-black">{job.headline || "Sem título"}</div><div className="mt-1 max-w-xs text-xs font-semibold text-slate-600">{job.subheadline || "Sem texto complementar"} · {job.cta || "Sem chamada final"}</div><div className="mt-1 text-xs text-muted">{new Date(job.createdAt).toLocaleString("pt-BR")}</div></td><td className="p-4 text-sm font-bold">{product?.nome || String(job.inputPayload?.product?.name || "Produto")}</td><td className="p-4 text-sm font-bold">{job.format === "vertical" ? "9:16 · Story/Reels" : "1:1 · Feed"} · {job.durationSeconds}s</td><td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone[job.status]}`}>{statusLabel[job.status]}</span>{job.errorMessage && <div className="mt-2 max-w-sm text-xs font-semibold text-red-700">{job.errorMessage}</div>}</td><td className="p-4"><div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-1 text-xs font-bold text-muted">{job.progress}%</div></td><td className="p-4"><div className="flex justify-end gap-2">{job.status === "COMPLETED" && job.outputStorageKey && <button className="btn-white" onClick={() => void download(job)}><Download size={16} /> Baixar</button>}{job.status === "QUEUED" && <button className="icon-btn" aria-label="Cancelar renderização" onClick={() => void cancel(job.id)}><X size={16} /></button>}{canDelete && <button className="icon-btn text-red-700" aria-label="Excluir vídeo" title="Excluir vídeo" disabled={deletingId === job.id} onClick={() => void remove(job)}>{deletingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}</button>}</div></td></tr>; })}{!jobs.length && !loading && <tr><td colSpan={6} className="p-10 text-center text-sm font-semibold text-muted">Nenhum vídeo solicitado.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
