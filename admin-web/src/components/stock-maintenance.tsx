"use client";

import { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode2,
  FileText,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Categoria, Produto } from "@/lib/types";

type Notify = (message: string) => void;
type ManualLine = {
  productCode: string;
  quantity: number;
  mode: "AJUSTE" | "INVENTARIO";
  product?: Produto;
  error?: string;
};
type FiscalNature =
  | "COMPRA_IMPORTACAO"
  | "VENDA"
  | "TRANSFERENCIA"
  | "DEVOLUCAO"
  | "CANCELAMENTO"
  | "NAO_RECONHECIDA";
type FiscalItem = {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  cfop: string;
  product?: Produto;
  currentBalance: number;
  projectedBalance: number;
  error?: string;
};
type FiscalDocument = {
  file: File;
  accessKey: string;
  eventId: string;
  number: string;
  series: string;
  issuedAt: string;
  issuer: Record<string, string>;
  recipient: Record<string, string>;
  purpose: string;
  operationNature: string;
  cfops: string[];
  nature: FiscalNature;
  authorized: boolean;
  classifiedManually?: boolean;
  items: FiscalItem[];
  storagePath?: string;
  manualClassificationReason?: string;
  errors: string[];
  orderMatch?: {
    orderId: string;
    orderNumber: number;
    clientName: string;
    comparison: { exact: boolean; differences: Array<{ code: string; orderQuantity?: number; invoiceQuantity?: number; result: string }> };
  } | null;
  orderMatchConfirmed?: boolean;
};
type HistoryRow = {
  movementId: string;
  createdAt: string;
  batchId: string;
  productId: string;
  productCode: string;
  productName: string;
  kind: string;
  quantity: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  accessKey?: string | null;
  documentNature?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
};
type HistoryMovement = {
  batchId: string;
  createdAt: string;
  kind: string;
  reason: string;
  actor: string;
  accessKeys: string[];
  rows: HistoryRow[];
};
type StockBalance = {
  productId: string;
  productCode: string;
  productName: string;
  physicalBalance: number;
  reservedBalance: number;
  availableBalance: number;
};
type StockReservationTrace = {
  reservationId: string;
  productId: string;
  productCode: string;
  productName: string;
  orderId: string;
  orderNumber: number;
  orderStatus: string;
  quantity: number;
  clientName: string;
  representativeName: string;
  submittedAt?: string | null;
  createdAt: string;
};
type ReservationReview = {
  reviewId: string; orderId: string; orderNumber: number; orderCreatedAt: string; invoiceNumber: string; invoiceIssuedAt: string; accessKey: string; clientName: string; productId: string; productCode: string; productName: string; orderedQuantity: number; invoicedQuantity: number; remainingQuantity: number; status: "PENDING" | "KEPT_RESERVED" | "RELEASED"; createdAt: string; resolutionComment?: string | null;
};

const normalizeCode = (value: string) =>
  value.trim().toLocaleUpperCase("pt-BR");
const isMissingProductError = (error?: string) =>
  Boolean(error?.startsWith("Não existe produto com o código "));
const localName = (element: Element, name: string) =>
  Array.from(element.getElementsByTagName("*"))
    .find((node) => node.localName === name)
    ?.textContent?.trim() || "";
const descendants = (element: Element, name: string) =>
  Array.from(element.getElementsByTagName("*")).filter(
    (node) => node.localName === name,
  );
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "-";
const orderStatusLabel: Record<string, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  RETURNED: "Devolvido",
  APPROVED: "Aprovado",
  PARTIALLY_INVOICED: "Faturado parcialmente",
  INVOICED: "Faturado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
};
function classifyNature(
  operation: string,
  cfops: string[],
  eventType: string,
): FiscalNature {
  if (eventType === "110111") return "CANCELAMENTO";
  const text = operation
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/devoluc|retorno/.test(text)) return "DEVOLUCAO";
  if (/transfer/.test(text)) return "TRANSFERENCIA";
  if (/import|compra|entrada/.test(text)) return "COMPRA_IMPORTACAO";
  if (/venda|saida/.test(text)) return "VENDA";
  if (
    cfops.some((value) =>
      /^(1202|1203|2202|2203|5201|5202|5208|5209|6201|6202|6208|6209)$/.test(
        value,
      ),
    )
  )
    return "DEVOLUCAO";
  if (cfops.some((value) => /^(5151|5152|6151|6152|6155|6156)/.test(value)))
    return "TRANSFERENCIA";
  if (cfops.some((value) => /^(3|1|2)/.test(value))) return "COMPRA_IMPORTACAO";
  if (cfops.some((value) => /^(5|6|7)/.test(value))) return "VENDA";
  return "NAO_RECONHECIDA";
}

async function parseFiscalXml(
  file: File,
  products: Produto[],
  direction: "ENTRADA" | "SAIDA",
): Promise<FiscalDocument> {
  const source = await file.text();
  const xml = new DOMParser().parseFromString(source, "application/xml");
  if (xml.querySelector("parsererror"))
    throw new Error(`${file.name}: o arquivo não contém um XML válido.`);
  const root = xml.documentElement;
  const eventNode = descendants(root, "infEvento")[0];
  const eventType = eventNode ? localName(eventNode, "tpEvento") : "";
  const nfeInfo = descendants(root, "infNFe")[0];
  const accessKey = (
    eventNode
      ? localName(eventNode, "chNFe")
      : nfeInfo?.getAttribute("Id") || localName(root, "chNFe")
  )
    .replace(/^NFe/i, "")
    .replace(/\D/g, "");
  const eventId = eventNode?.getAttribute("Id") || localName(root, "Id");
  const operationNature = localName(root, "natOp");
  const cfops = Array.from(
    new Set(
      descendants(root, "CFOP")
        .map((node) => node.textContent?.trim() || "")
        .filter(Boolean),
    ),
  );
  const nature = classifyNature(operationNature, cfops, eventType);
  const statusCode = localName(root, "cStat");
  const authorized =
    eventType === "110111"
      ? ["135", "136", "155"].includes(statusCode)
      : ["100", "150"].includes(statusCode);
  const itemNodes = descendants(root, "det");
  const productIndex = new Map<string, Produto[]>();
  products.forEach((product) => {
    const key = normalizeCode(product.codigoInterno || "");
    if (key) productIndex.set(key, [...(productIndex.get(key) || []), product]);
  });
  const running = new Map<string, number>();
  const items: FiscalItem[] = itemNodes.map((node, index) => {
    const code = normalizeCode(localName(node, "cProd"));
    const quantity = Number(localName(node, "qCom").replace(",", "."));
    const matches = productIndex.get(code) || [];
    const product = matches.length === 1 ? matches[0] : undefined;
    const current = Number(product?.estoque || 0);
    const prior = running.get(product?.id || code) ?? current;
    const projected = prior + (direction === "ENTRADA" ? quantity : -quantity);
    running.set(product?.id || code, projected);
    let error = "";
    if (!code) error = "Item sem cProd.";
    else if (matches.length === 0)
      error = `Não existe produto com o código ${code}.`;
    else if (matches.length > 1)
      error = `Existem ${matches.length} produtos com o código ${code}.`;
    else if (!Number.isInteger(quantity) || quantity <= 0)
      error = `A quantidade de ${code} deve ser inteira e positiva.`;
    else if (projected < 0)
      error = `${code} ficaria com saldo negativo (${projected}).`;
    return {
      lineNumber: Number(node.getAttribute("nItem") || index + 1),
      productCode: code,
      description: localName(node, "xProd"),
      quantity,
      cfop: localName(node, "CFOP"),
      product,
      currentBalance: prior,
      projectedBalance: projected,
      error: error || undefined,
    };
  });
  const errors: string[] = [];
  if (accessKey.length !== 44)
    errors.push("Chave de acesso da NF-e ausente ou inválida.");
  if (!authorized)
    errors.push(
      `Documento não autorizado (cStat ${statusCode || "não informado"}).`,
    );
  if (nature === "NAO_RECONHECIDA")
    errors.push(
      "Natureza fiscal não reconhecida; selecione a classificação e justifique.",
    );
  if (
    (nature === "COMPRA_IMPORTACAO" && direction === "SAIDA") ||
    (nature === "VENDA" && direction === "ENTRADA")
  )
    errors.push(
      "A natureza fiscal contradiz a direção escolhida; revise e justifique a classificação.",
    );
  if (nature !== "CANCELAMENTO" && !items.length)
    errors.push("NF-e sem itens de produto.");
  errors.push(...items.flatMap((item) => (item.error ? [item.error] : [])));
  const emit = descendants(root, "emit")[0];
  const dest = descendants(root, "dest")[0];
  return {
    file,
    accessKey,
    eventId,
    number: localName(root, "nNF"),
    series: localName(root, "serie"),
    issuedAt: localName(root, "dhEmi") || localName(root, "dEmi"),
    issuer: {
      cnpj: emit ? localName(emit, "CNPJ") : "",
      name: emit ? localName(emit, "xNome") : "",
    },
    recipient: {
      cnpj: dest ? localName(dest, "CNPJ") : "",
      ie: dest ? localName(dest, "IE") : "",
      name: dest ? localName(dest, "xNome") : "",
    },
    purpose: localName(root, "finNFe"),
    operationNature,
    cfops,
    nature,
    authorized,
    items,
    errors,
  };
}

function recalculateFiscalBalances(
  documents: FiscalDocument[],
  direction: "ENTRADA" | "SAIDA",
) {
  const balances = new Map<string, number>();
  return documents.map((document) => ({
    ...document,
    items: document.items.map((item) => {
      const key = item.product?.id || item.productCode;
      const currentBalance =
        balances.get(key) ?? Number(item.product?.estoque || 0);
      const projectedBalance =
        currentBalance +
        (direction === "ENTRADA" ? item.quantity : -item.quantity);
      balances.set(key, projectedBalance);
      const priorErrors =
        item.error &&
        !item.error.includes("saldo negativo") &&
        !item.error.includes("ficaria com saldo negativo")
          ? item.error
          : undefined;
      const error =
        priorErrors ||
        (projectedBalance < 0
          ? `${item.productCode} ficaria com saldo negativo (${projectedBalance}).`
          : undefined);
      return { ...item, currentBalance, projectedBalance, error };
    }),
  }));
}

export function StockMaintenance({
  products,
  categories,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  categories: Categoria[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [section, setSection] = useState<"balances" | "manual" | "xml" | "reviews" | "history">(
    "balances",
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          ["balances", "Saldos dos produtos"],
          ["manual", "Manutenção rápida"],
          ["xml", "Entrada e saída por XML"],
          ["reviews", "Pendências de faturamento"],
          ["history", "Histórico"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id as typeof section)}
            className={section === id ? "btn-primary" : "btn-white"}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "balances" && <StockBalances notify={notify} />}{" "}
      {section === "manual" && (
        <ManualMaintenance
          products={products}
          categories={categories}
          notify={notify}
          reloadProducts={reloadProducts}
        />
      )}{" "}
      {section === "xml" && (
        <XmlMaintenance
          products={products}
          notify={notify}
          reloadProducts={reloadProducts}
        />
      )}{" "}
      {section === "reviews" && <ReservationReviews notify={notify} />}{" "}
      {section === "history" && <StockHistory notify={notify} />}
    </div>
  );
}

function StockBalances({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<StockBalance[]>([]);
  const [reservations, setReservations] = useState<StockReservationTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "reserved" | "unavailable">("all");
  const [selectedProduct, setSelectedProduct] = useState<StockBalance | null>(null);
  const load = async () => {
    setLoading(true);
    const [balancesResult, reservationsResult] = await Promise.all([supabase.rpc("get_admin_stock_balances"), supabase.rpc("get_admin_stock_reservations", { p_product_code: null })]);
    if (balancesResult.error) notify(stockError(balancesResult.error)); else setRows((balancesResult.data || []) as StockBalance[]);
    if (reservationsResult.error) notify(stockError(reservationsResult.error)); else setReservations((reservationsResult.data || []) as StockReservationTrace[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = !query || `${row.productCode} ${row.productName}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const matchesView = view === "all" || (view === "reserved" ? row.reservedBalance > 0 : row.availableBalance <= 0);
    return matchesQuery && matchesView;
  }), [rows, query, view]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    physical: sum.physical + row.physicalBalance,
    reserved: sum.reserved + row.reservedBalance,
    available: sum.available + row.availableBalance,
  }), { physical: 0, reserved: 0, available: 0 }), [rows]);
  const selectedReservations = selectedProduct ? reservations.filter((row) => row.productId === selectedProduct.productId) : [];
  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><span className="text-xs font-black uppercase tracking-wide text-blue-700">Estoque físico</span><strong className="mt-2 block text-3xl text-blue-950">{totals.physical.toLocaleString("pt-BR")}</strong><small className="font-semibold text-blue-700">Total atualmente armazenado</small></div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><span className="text-xs font-black uppercase tracking-wide text-amber-700">Reservado</span><strong className="mt-2 block text-3xl text-amber-950">{totals.reserved.toLocaleString("pt-BR")}</strong><small className="font-semibold text-amber-700">Comprometido em pedidos enviados</small></div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><span className="text-xs font-black uppercase tracking-wide text-emerald-700">Disponível</span><strong className="mt-2 block text-3xl text-emerald-950">{totals.available.toLocaleString("pt-BR")}</strong><small className="font-semibold text-emerald-700">Liberado para novos pedidos</small></div>
    </div>
    <Card title="Consulta de saldos por produto">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Label text="Buscar produto"><input className="input min-w-[280px]" placeholder="Código ou descrição" value={query} onChange={(event) => setQuery(event.target.value)} /></Label>
        <Label text="Exibir"><select className="input min-w-[210px]" value={view} onChange={(event) => setView(event.target.value as typeof view)}><option value="all">Todos os produtos</option><option value="reserved">Somente com reserva</option><option value="unavailable">Sem saldo disponível</option></select></Label>
        <button className="btn-white" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />} Atualizar saldos</button>
      </div>
      <div className="max-h-[650px] overflow-auto rounded-2xl border border-slate-200">
        <table className="admin-table min-w-[980px] table-fixed"><colgroup><col className="w-[19%]"/><col className="w-[21%]"/><col className="w-[12%]"/><col className="w-[12%]"/><col className="w-[12%]"/><col className="w-[14%]"/><col className="w-[10%]"/></colgroup><thead><tr><th className="whitespace-nowrap">Código</th><th>Produto</th><th className="text-center">Estoque físico</th><th className="text-center">Reservado</th><th className="text-center">Disponível</th><th className="text-center">Situação</th><th/></tr></thead><tbody>
          {filtered.map((row) => <tr key={row.productId}><td className="whitespace-nowrap font-black text-slate-950">{row.productCode || "-"}</td><td><div className="truncate" title={row.productName}>{row.productName}</div></td><td className="text-center font-bold tabular-nums">{row.physicalBalance.toLocaleString("pt-BR")}</td><td className={`text-center font-black tabular-nums ${row.reservedBalance > 0 ? "text-amber-700" : "text-slate-400"}`}>{row.reservedBalance.toLocaleString("pt-BR")}</td><td className={`text-center font-black tabular-nums ${row.availableBalance <= 0 ? "text-red-700" : "text-emerald-700"}`}>{row.availableBalance.toLocaleString("pt-BR")}</td><td className="text-center">{row.availableBalance <= 0 ? <span className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2.5 py-1 text-xs font-black text-red-800">Indisponível</span> : row.reservedBalance > 0 ? <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">Com reserva</span> : <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">Disponível</span>}</td><td className="text-center">{row.reservedBalance > 0 && <button className="btn-white whitespace-nowrap px-3 py-2 text-xs" onClick={() => setSelectedProduct(row)}>Ver pedidos</button>}</td></tr>)}
        </tbody></table>
        {!loading && !filtered.length && <div className="p-8 text-center font-bold text-slate-500">Nenhum produto encontrado.</div>}
      </div>
      <p className="mt-3 text-xs font-semibold text-slate-500">Disponível = estoque físico menos as reservas ativas. A aprovação mantém a reserva; a baixa física acontece na conciliação da NF-e de saída.</p>
    </Card>
    {selectedProduct && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onMouseDown={() => setSelectedProduct(null)}>
      <div className="flex max-h-[88vh] w-[96vw] max-w-[1180px] flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 bg-[#061a34] p-5 text-white"><div><small className="font-black uppercase tracking-[.16em] text-yellow">Reservas de estoque</small><h2 className="mt-1 text-2xl font-black">Referência {selectedProduct.productCode}</h2><p className="mt-1 max-w-2xl truncate text-sm font-semibold text-slate-300" title={selectedProduct.productName}>{selectedProduct.productName}</p></div><button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 text-white hover:bg-white/10" onClick={() => setSelectedProduct(null)} aria-label="Fechar"><X size={20}/></button></header>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-4"><Info label="Estoque físico" value={String(selectedProduct.physicalBalance)}/><Info label="Reservado" value={String(selectedProduct.reservedBalance)}/><Info label="Disponível" value={String(selectedProduct.availableBalance)}/><Info label="Pedidos" value={String(selectedReservations.length)}/></div>
        <div className="overflow-x-hidden overflow-y-auto p-4"><table className="admin-table w-full table-fixed text-xs"><colgroup><col className="w-[10%]"/><col className="w-[13%]"/><col className="w-[25%]"/><col className="w-[18%]"/><col className="w-[14%]"/><col className="w-[20%]"/></colgroup><thead><tr><th className="px-3">Pedido</th><th className="px-3">Status</th><th className="px-3">Cliente</th><th className="px-3">Representante</th><th className="px-3 text-center">Qtd. reservada</th><th className="px-3">Data do envio</th></tr></thead><tbody>{selectedReservations.map((reservation) => <tr key={reservation.reservationId}><td className="whitespace-nowrap px-3 font-black">{String(reservation.orderNumber).padStart(6,"0")}</td><td className="px-3"><span className="inline-flex whitespace-nowrap rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-800">{orderStatusLabel[reservation.orderStatus] || "Em processamento"}</span></td><td className="px-3"><div className="truncate" title={reservation.clientName}>{reservation.clientName}</div></td><td className="px-3"><div className="truncate" title={reservation.representativeName}>{reservation.representativeName}</div></td><td className="px-3 text-center font-black text-amber-700">{reservation.quantity}</td><td className="whitespace-nowrap px-3 text-[11px]">{formatDate(reservation.submittedAt || reservation.createdAt)}</td></tr>)}</tbody></table>
          {!selectedReservations.length && <div className="rounded-2xl bg-red-50 p-5 text-center font-bold text-red-800">Não existe reserva ativa vinculada a pedido para esta referência. Atualize os saldos; se o número reservado continuar diferente de zero, existe uma inconsistência que precisa ser investigada.</div>}
        </div>
        <footer className="flex justify-end border-t border-slate-200 bg-slate-50 p-4"><button className="btn-primary" onClick={() => setSelectedProduct(null)}>Fechar</button></footer>
      </div>
    </div>}
  </div>;
}

function ReservationReviews({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<ReservationReview[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_stock_reservation_reviews", { p_status: null });
    if (error) notify(stockError(error)); else setRows((data || []) as ReservationReview[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const decide = async (row: ReservationReview, action: "KEEP" | "RELEASE") => {
    const verb = action === "KEEP" ? "manter reservadas" : "liberar para novos pedidos";
    if (!confirm(`${verb.charAt(0).toUpperCase()}${verb.slice(1)} as ${row.remainingQuantity} unidade(s) de ${row.productCode}?`)) return;
    const comment = prompt("Observação da decisão administrativa (opcional):") || "";
    const { error } = await supabase.rpc("resolve_stock_reservation_review", { p_review_id: row.reviewId, p_action: action, p_comment: comment || null });
    if (error) notify(stockError(error)); else { notify(action === "KEEP" ? "Reserva residual mantida." : "Reserva residual liberada para novos pedidos."); await load(); }
  };
  const pending = rows.filter((row) => row.status === "PENDING");
  return <div className="space-y-4">
    <Card title={`${pending.length} pendência(s) aguardando ação`}>
      <p className="text-sm font-semibold text-slate-600">Diferenças entre o pedido aprovado e a quantidade efetivamente faturada. Enquanto estiver pendente, o saldo restante continua reservado e indisponível para novos pedidos.</p>
    </Card>
    {loading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : rows.map((row) => <Card key={row.reviewId} title={`Pedido ${String(row.orderNumber).padStart(6,"0")} — NF-e ${row.invoiceNumber || "sem número"}`}>
      <div className="grid gap-3 md:grid-cols-4"><Info label="Cliente" value={row.clientName || "-"}/><Info label="Produto" value={`${row.productCode} — ${row.productName}`}/><Info label="Data do pedido" value={formatDate(row.orderCreatedAt)}/><Info label="Data da NF-e" value={formatDate(row.invoiceIssuedAt)}/></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><Info label="Pedido" value={`${row.orderedQuantity} un.`}/><Info label="Faturado" value={`${row.invoicedQuantity} un.`}/><Info label="Ainda reservado" value={`${row.remainingQuantity} un.`}/></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className={`rounded-full px-3 py-1 text-xs font-black ${row.status === "PENDING" ? "bg-amber-100 text-amber-900" : row.status === "KEPT_RESERVED" ? "bg-blue-100 text-blue-900" : "bg-emerald-100 text-emerald-900"}`}>{row.status === "PENDING" ? "Aguardando decisão" : row.status === "KEPT_RESERVED" ? "Reserva mantida" : "Reserva liberada"}</span>{row.status !== "RELEASED" && <div className="flex gap-2">{row.status === "PENDING" && <button className="btn-white" onClick={() => void decide(row,"KEEP")}>Manter reservado</button>}<button className="btn-primary" onClick={() => void decide(row,"RELEASE")}>Liberar saldo</button></div>}</div>
      {row.resolutionComment && <p className="mt-3 text-sm text-slate-600"><b>Decisão:</b> {row.resolutionComment}</p>}
    </Card>)}
    {!loading && !rows.length && <div className="rounded-2xl bg-emerald-50 p-6 text-center font-bold text-emerald-900">Nenhuma divergência de faturamento registrada.</div>}
  </div>;
}

function ManualMaintenance({
  products,
  categories,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  categories: Categoria[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"AJUSTE" | "INVENTARIO">("AJUSTE");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            (!category || p.categoriaId === category) &&
            (!query ||
              `${p.codigoInterno} ${p.nome}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .slice(0, 300),
    [products, category, query],
  );
  const lines = useMemo<ManualLine[]>(
    () =>
      Object.entries(values)
        .filter(([, v]) => v.trim() !== "")
        .map(([id, v]) => {
          const product = products.find((p) => p.id === id);
          const quantity = Number(v.replace(",", "."));
          let error = "";
          const projected =
            mode === "INVENTARIO"
              ? quantity
              : Number(product?.estoque || 0) + quantity;
          if (!Number.isInteger(quantity))
            error = "Use somente números inteiros.";
          else if (projected < 0)
            error = `Saldo projetado negativo (${projected}).`;
          return {
            productCode: product?.codigoInterno || "",
            quantity,
            mode,
            product,
            error: error || undefined,
          };
        }),
    [values, products, mode],
  );
  const importPaste = () => {
    const next = { ...values };
    const index = new Map(
      products.map((p) => [normalizeCode(p.codigoInterno || ""), p]),
    );
    const errors: string[] = [];
    paste
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((row, i) => {
        const [code, value] = row.split(/[;\t]/);
        const product = index.get(normalizeCode(code || ""));
        if (!product)
          errors.push(
            `Linha ${i + 1}: produto ${code || "sem código"} não encontrado.`,
          );
        else next[product.id] = String(value || "").trim();
      });
    setValues(next);
    notify(
      errors.length
        ? errors.slice(0, 4).join(" ")
        : "Linhas adicionadas à conferência.",
    );
  };
  const apply = async () => {
    if (!reason.trim()) {
      notify("Informe o motivo da manutenção de saldo.");
      return;
    }
    if (!lines.length) {
      notify("Informe ao menos uma alteração de saldo.");
      return;
    }
    if (lines.some((l) => l.error)) {
      notify("Corrija as linhas inválidas antes de confirmar.");
      return;
    }
    if (!confirm(`Confirmar ${lines.length} alteração(ões) de saldo?`)) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("apply_manual_stock_batch", {
        p_reason: reason.trim(),
        p_items: lines.map((l) => ({
          productCode: l.productCode,
          quantity: l.quantity,
          mode: l.mode,
        })),
      });
      if (error) throw error;
      notify(
        `Saldo atualizado. ${(data as { productsChanged?: number })?.productsChanged || 0} produto(s) alterado(s).`,
      );
      setValues({});
      setPaste("");
      setReason("");
      await reloadProducts();
    } catch (e) {
      notify(stockError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Card title="Manutenção manual em massa">
        <div className="grid gap-4 lg:grid-cols-4">
          <Label text="Modo">
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="AJUSTE">Somar ou subtrair</option>
              <option value="INVENTARIO">Definir saldo absoluto</option>
            </select>
          </Label>
          <Label text="Buscar">
            <div className="relative">
              <Search
                className="absolute left-3 top-3 text-slate-400"
                size={17}
              />
              <input
                className="input pl-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Código ou nome"
              />
            </div>
          </Label>
          <Label text="Categoria">
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Motivo obrigatório">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: inventário de agosto"
            />
          </Label>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <textarea
            className="textarea min-h-24"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"Cole do Excel: código + quantidade\nBRMG4401\t10"}
          />
          <button className="btn-white self-end" onClick={importPaste}>
            Adicionar linhas coladas
          </button>
        </div>
      </Card>
      <Card title={`${lines.length} produto(s) na conferência`}>
        <div className="max-h-[560px] overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Saldo atual</th>
                <th>{mode === "AJUSTE" ? "Ajuste (+/-)" : "Novo saldo"}</th>
                <th>Saldo projetado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const value = values[p.id] || "";
                const numeric = Number(value.replace(",", "."));
                const projected =
                  value === ""
                    ? Number(p.estoque || 0)
                    : mode === "INVENTARIO"
                      ? numeric
                      : Number(p.estoque || 0) + numeric;
                const line = lines.find((l) => l.product?.id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-black">{p.codigoInterno || "-"}</td>
                    <td>{p.nome}</td>
                    <td>{p.estoque ?? 0}</td>
                    <td>
                      <input
                        className={`input w-32 ${line?.error ? "border-red-500" : ""}`}
                        inputMode="numeric"
                        value={value}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [p.id]: e.target.value }))
                        }
                      />
                      {line?.error && (
                        <div className="mt-1 text-xs font-bold text-red-700">
                          {line.error}
                        </div>
                      )}
                    </td>
                    <td
                      className={
                        projected < 0 ? "font-black text-red-700" : "font-black"
                      }
                    >
                      {Number.isFinite(projected) ? projected : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            disabled={saving}
            className="btn-primary"
            onClick={() => void apply()}
          >
            {saving ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <PackageCheck size={17} />
            )}{" "}
            Conferir e aplicar lote
          </button>
        </div>
      </Card>
    </>
  );
}

function XmlMaintenance({
  products,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [direction, setDirection] = useState<"ENTRADA" | "SAIDA">("ENTRADA");
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const max = direction === "ENTRADA" ? 10 : 50;
  const blockingInvalid = documents.some(
    (d) =>
      d.errors.some((error) => !isMissingProductError(error)) ||
      d.items.some((item) => item.error && !isMissingProductError(item.error)) ||
      (d.classifiedManually && !d.manualClassificationReason?.trim()),
  );
  const missingItems = documents.flatMap((document) =>
    document.items.filter((item) => isMissingProductError(item.error)),
  );
  const importableItems = documents.flatMap((document) =>
    document.items.filter((item) => !isMissingProductError(item.error)),
  );
  const selectFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length > max) {
      notify(`Selecione no máximo ${max} XMLs neste lote.`);
      return;
    }
    setWorking(true);
    try {
      const parsed = [] as FiscalDocument[];
      for (const file of selected) {
        if (!/\.xml$/i.test(file.name)) {
          notify(`${file.name}: formato não aceito.`);
          continue;
        }
        try {
          const document = await parseFiscalXml(file, products, direction);
          if (direction === "SAIDA" && document.nature === "VENDA" && document.recipient.cnpj) {
            const { data, error } = await supabase.rpc("match_sales_order_for_invoice", {
              p_recipient_cnpj: document.recipient.cnpj,
              p_recipient_ie: document.recipient.ie || null,
              p_items: document.items.map(({ productCode, quantity }) => ({ productCode, quantity })),
            });
            if (error) throw error;
            document.orderMatch = data as FiscalDocument["orderMatch"];
          }
          parsed.push(document);
        } catch (e) {
          notify(stockError(e));
        }
      }
      setDocuments(recalculateFiscalBalances(parsed, direction));
    } finally {
      setWorking(false);
    }
  };
  const reclassify = (index: number, nature: FiscalNature) =>
    setDocuments((current) =>
      current.map((doc, i) =>
        i !== index
          ? doc
          : {
              ...doc,
              nature,
              classifiedManually: true,
              errors: doc.errors.filter(
                (e) =>
                  !e.startsWith("Natureza fiscal") &&
                  !e.startsWith("A natureza fiscal contradiz"),
              ),
            },
      ),
    );
  const apply = async (partial = false) => {
    if (!documents.length) {
      notify("Selecione os XMLs do lote.");
      return;
    }
    if (blockingInvalid) {
      notify(
        "O lote possui pendências. Corrija ou remova os documentos indicados.",
      );
      return;
    }
    if (missingItems.length && !partial) {
      notify(
        "Existem produtos sem cadastro. Use a opção de importação parcial para continuar apenas com os itens encontrados.",
      );
      return;
    }
    if (partial && !importableItems.length) {
      notify("Nenhum item cadastrado no catálogo pode ser importado neste lote.");
      return;
    }
    if (documents.some((d) => d.nature === "NAO_RECONHECIDA")) {
      notify("Classifique todos os documentos antes de confirmar.");
      return;
    }
    if (documents.some((d) => d.orderMatch && !d.orderMatchConfirmed)) {
      notify("Confirme ou descarte a sugestão de pedido de cada NF-e antes de aplicar o lote.");
      return;
    }
    if (
      !confirm(
        partial
          ? `Importar somente os ${importableItems.length} item(ns) encontrado(s) e ignorar ${missingItems.length} item(ns) sem cadastro?`
          : `Aplicar ${documents.length} documento(s) como ${direction.toLowerCase()}?`,
      )
    )
      return;
    setWorking(true);
    const uploaded: string[] = [];
    try {
      const payload = [];
      const documentsToApply = documents
        .map((doc) => ({
          ...doc,
          items: partial
            ? doc.items.filter((item) => !isMissingProductError(item.error))
            : doc.items,
        }))
        .filter((doc) => doc.nature === "CANCELAMENTO" || doc.items.length > 0);
      for (const doc of documentsToApply) {
        const safe = doc.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
        const { error: uploadError } = await supabase.storage
          .from("fiscal-xml")
          .upload(path, doc.file, {
            contentType: doc.file.type || "application/xml",
            upsert: false,
          });
        if (uploadError)
          throw new Error(
            `${doc.file.name}: falha ao guardar o XML com segurança. ${uploadError.message}`,
          );
        uploaded.push(path);
        payload.push({
          ...doc,
          salesOrderId: doc.orderMatchConfirmed ? doc.orderMatch?.orderId : null,
          orderMatch: undefined,
          orderMatchConfirmed: undefined,
          file: undefined,
          storagePath: path,
          items: doc.items.map(
            ({ product, currentBalance, projectedBalance, error, ...item }) =>
              item,
          ),
        });
      }
      const { data, error } = await supabase.rpc("apply_fiscal_stock_batch", {
        p_direction: direction,
        p_reason: reason.trim() || null,
        p_documents: payload,
      });
      if (error) throw error;
      notify(
        partial
          ? `Importação parcial concluída: ${importableItems.length} item(ns) importado(s) e ${missingItems.length} sem cadastro ignorado(s).`
          : `Lote aplicado: ${(data as { documentsProcessed?: number })?.documentsProcessed || documents.length} documento(s).`,
      );
      setDocuments([]);
      setReason("");
      await reloadProducts();
    } catch (e) {
      if (uploaded.length)
        await supabase.storage.from("fiscal-xml").remove(uploaded);
      notify(stockError(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <Card title="Processar XML fiscal">
        <div className="grid gap-4 lg:grid-cols-3">
          <Label text="Direção relativa ao estoque Briland">
            <select
              className="input"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as typeof direction);
                setDocuments([]);
              }}
            >
              <option value="ENTRADA">Entrada — aumenta saldo</option>
              <option value="SAIDA">Saída — reduz saldo</option>
            </select>
          </Label>
          <Label text="Observação do lote">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Opcional quando a natureza é reconhecida"
            />
          </Label>
          <Label text={`XMLs — máximo ${max}`}>
            <label className="btn-white cursor-pointer">
              <Upload size={17} />
              {working ? "Lendo arquivos..." : "Selecionar XMLs"}
              <input
                hidden
                type="file"
                multiple
                accept=".xml,application/xml,text/xml"
                onChange={(e) => void selectFiles(e.target.files)}
              />
            </label>
          </Label>
        </div>
        <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-950">
          O sistema usa exclusivamente o cProd do XML para localizar o código
          interno. Nenhum saldo muda antes da sua confirmação.
        </div>
      </Card>
      <div className="space-y-4">
        {documents.map((doc, index) => (
          <Card
            key={`${doc.file.name}-${index}`}
            title={`${doc.file.name} — NF-e ${doc.number || "sem número"}`}
          >
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <Info label="Chave" value={doc.accessKey || "Não informada"} />
              <Info label="Natureza" value={doc.nature.replaceAll("_", " ")} />
              <Info
                label="Emitente"
                value={doc.issuer.name || doc.issuer.cnpj || "-"}
              />
              <Info
                label="Situação"
                value={doc.authorized ? "Autorizada" : "Não autorizada"}
              />
            </div>
            {direction === "SAIDA" && doc.nature === "VENDA" && (
              doc.orderMatch ? (
                <div className={`mb-4 rounded-2xl border p-4 ${doc.orderMatch.comparison.exact ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black">Pedido sugerido {String(doc.orderMatch.orderNumber).padStart(6, "0")} — {doc.orderMatch.clientName}</p>
                      <p className="mt-1 text-sm font-semibold">CNPJ/IE do cliente conferidos. {doc.orderMatch.comparison.exact ? "Produtos e quantidades coincidem integralmente." : "Existem diferenças entre o pedido e a nota fiscal."}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={doc.orderMatchConfirmed ? "btn-primary" : "btn-white"} onClick={() => setDocuments((current) => current.map((item, i) => i === index ? { ...item, orderMatchConfirmed: true } : item))}>Sim, vincular pedido</button>
                      <button type="button" className="btn-white" onClick={() => setDocuments((current) => current.map((item, i) => i === index ? { ...item, orderMatchConfirmed: false, orderMatch: null } : item))}>Não é este pedido</button>
                    </div>
                  </div>
                  {!doc.orderMatch.comparison.exact && <div className="mt-3 space-y-1 text-sm font-bold">{doc.orderMatch.comparison.differences.map((difference) => <div key={difference.code}>• {difference.code}: pedido {difference.orderQuantity ?? 0}, NF-e {difference.invoiceQuantity ?? 0}</div>)}</div>}
                </div>
              ) : (
                <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-950">Nenhum pedido aprovado foi encontrado para o CNPJ/IE desta NF-e. A saída de estoque continuará normalmente e ficará registrada como venda sem pedido vinculado.</div>
              )
            )}
            {(doc.nature === "NAO_RECONHECIDA" ||
              doc.classifiedManually ||
              doc.errors.some((e) =>
                e.startsWith("A natureza fiscal contradiz"),
              )) && (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <Label text="Classificação manual">
                  <select
                    className="input"
                    value={doc.nature}
                    onChange={(e) =>
                      reclassify(index, e.target.value as FiscalNature)
                    }
                  >
                    <option value="NAO_RECONHECIDA">Selecione</option>
                    <option value="COMPRA_IMPORTACAO">Compra/importação</option>
                    <option value="VENDA">Venda</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                    <option value="DEVOLUCAO">Devolução</option>
                  </select>
                </Label>
                <Label text="Justificativa obrigatória">
                  <input
                    className="input"
                    value={doc.manualClassificationReason || ""}
                    onChange={(e) =>
                      setDocuments((ds) =>
                        ds.map((d, i) =>
                          i === index
                            ? {
                                ...d,
                                classifiedManually: true,
                                manualClassificationReason: e.target.value,
                                errors: d.errors.filter(
                                  (x) =>
                                    !x.startsWith(
                                      "A natureza fiscal contradiz",
                                    ),
                                ),
                              }
                            : d,
                        ),
                      )
                    }
                  />
                </Label>
              </div>
            )}
            {doc.errors.length > 0 && (
              <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
                {doc.errors.map((e) => (
                  <div key={e}>• {e}</div>
                ))}
              </div>
            )}
            <div className="overflow-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>cProd</th>
                    <th>Produto</th>
                    <th>Quantidade</th>
                    <th>Saldo atual</th>
                    <th>Projetado</th>
                    <th>Validação</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((item) => (
                    <tr key={item.lineNumber}>
                      <td>{item.lineNumber}</td>
                      <td className="font-black">{item.productCode}</td>
                      <td>{item.product?.nome || "Não encontrado"}</td>
                      <td>{item.quantity}</td>
                      <td>{item.currentBalance}</td>
                      <td>{item.projectedBalance}</td>
                      <td>
                        {item.error ? (
                          <span className="font-bold text-red-700">
                            {item.error}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                            <CheckCircle2 size={15} />
                            Pronto
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="mt-4 text-sm font-black text-red-700"
              onClick={() =>
                setDocuments((ds) =>
                  recalculateFiscalBalances(
                    ds.filter((_, i) => i !== index),
                    direction,
                  ),
                )
              }
            >
              Retirar documento do lote
            </button>
          </Card>
        ))}
      </div>
      {missingItems.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0" size={21} />
            <div>
              <p className="font-black">
                {missingItems.length} item(ns) não possuem cadastro no catálogo
              </p>
              <p className="mt-1 text-sm font-semibold">
                Eles não serão importados. Você pode revisar o XML ou continuar
                somente com os {importableItems.length} item(ns) reconhecido(s).
              </p>
              <p className="mt-2 text-sm">
                Códigos ignorados: {Array.from(new Set(missingItems.map((item) => item.productCode))).join(", ")}
              </p>
            </div>
          </div>
        </div>
      )}
      {documents.length > 0 && (
        <div className="flex flex-wrap justify-end gap-3">
          {missingItems.length > 0 && (
            <button
              disabled={working || blockingInvalid || !importableItems.length}
              className="btn-primary"
              onClick={() => void apply(true)}
            >
              {working ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <PackageCheck size={17} />
              )}{" "}
              Importar somente itens encontrados
            </button>
          )}
          <button
            disabled={working || blockingInvalid || missingItems.length > 0}
            className="btn-primary"
            onClick={() => void apply(false)}
          >
            {working ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <FileCode2 size={17} />
            )}{" "}
            Confirmar lote completo
          </button>
        </div>
      )}
    </>
  );
}

function StockHistory({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [code, setCode] = useState("");
  const [direction, setDirection] = useState("");
  const [key, setKey] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_stock_maintenance_history",
        {
          p_from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
          p_to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
          p_product_code: code || null,
          p_direction: direction || null,
          p_access_key: key || null,
        },
      );
      if (error) throw error;
      setRows((data || []) as HistoryRow[]);
    } catch (e) {
      notify(stockError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    void (async () => {
      const { data } = await supabase.rpc("get_expired_fiscal_xml_paths");
      const paths = ((data || []) as Array<{ path: string }>)
        .map((row) => row.path)
        .filter(Boolean);
      if (!paths.length) return;
      const { error } = await supabase.storage.from("fiscal-xml").remove(paths);
      if (!error) {
        await supabase.rpc("confirm_fiscal_xml_cleanup", { p_paths: paths });
      }
    })();
  }, []);
  const movements = useMemo<HistoryMovement[]>(() => {
    const grouped = new Map<string, HistoryRow[]>();
    rows.forEach((row) => grouped.set(row.batchId, [...(grouped.get(row.batchId) || []), row]));
    return Array.from(grouped.entries()).map(([batchId, items]) => {
      const kinds = Array.from(new Set(items.map((item) => item.kind)));
      return {
        batchId,
        createdAt: items[0].createdAt,
        kind: kinds.length === 1 ? kinds[0] : "MISTO",
        reason: items[0].reason,
        actor: items[0].actorEmail || items[0].actorName || "-",
        accessKeys: Array.from(new Set(items.map((item) => item.accessKey).filter(Boolean) as string[])),
        rows: items,
      };
    });
  }, [rows]);
  const toggleMovement = (batchId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
    return next;
  });
  const exportXlsx = async (items: HistoryRow[], filename: string) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Movimentações");
    ws.addRow([
      "Data",
      "Lote",
      "Código",
      "Produto",
      "Tipo",
      "Quantidade",
      "Saldo anterior",
      "Novo saldo",
      "Chave NF-e",
      "Natureza",
      "Responsável",
      "Motivo",
    ]);
    items.forEach((r) =>
      ws.addRow([
        r.createdAt,
        r.batchId,
        r.productCode,
        r.productName,
        r.kind,
        r.quantity,
        r.previousBalance,
        r.newBalance,
        r.accessKey,
        r.documentNature,
        r.actorEmail || r.actorName,
        r.reason,
      ]),
    );
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((column) => { column.width = 18; });
    ws.getColumn(4).width = 42;
    ws.getColumn(9).width = 48;
    ws.getColumn(12).width = 42;
    const buffer = await wb.xlsx.writeBuffer();
    download(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${filename}.xlsx`,
    );
  };
  const exportPdf = async (movement: HistoryMovement) => {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pageSize: [number, number] = [841.89, 595.28];
    const columns = [45, 125, 365, 445, 505, 575, 650, 735];
    let page = pdf.addPage(pageSize);
    let y = 535;
    const header = () => {
      page.drawRectangle({ x: 0, y: 522, width: pageSize[0], height: 74, color: rgb(0.01, 0.08, 0.16) });
      page.drawText("BRILAND | MOVIMENTO DE ESTOQUE", { x: 40, y: 558, size: 17, font: bold, color: rgb(1, 1, 1) });
      page.drawText(`${movement.kind}  |  ${formatDate(movement.createdAt)}  |  ${movement.rows.length} produto(s)`, { x: 40, y: 538, size: 10, font: regular, color: rgb(0.92, 0.95, 1) });
      y = 500;
      ["Codigo", "Produto", "Tipo", "Qtd.", "Anterior", "Novo", "NF-e", "Responsavel"].forEach((label, index) => page.drawText(label, { x: columns[index], y, size: 8, font: bold, color: rgb(0.08, 0.12, 0.18) }));
      y -= 15;
    };
    header();
    movement.rows.forEach((item) => {
      if (y < 55) { page = pdf.addPage(pageSize); header(); }
      const values = [item.productCode, item.productName.slice(0, 36), item.kind, String(item.quantity), String(item.previousBalance), String(item.newBalance), (item.accessKey || "-").slice(-12), (item.actorEmail || item.actorName || "-").slice(0, 20)];
      values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.5, font: regular, color: rgb(0.16, 0.2, 0.27) }));
      page.drawLine({ start: { x: 40, y: y - 5 }, end: { x: 805, y: y - 5 }, thickness: 0.4, color: rgb(0.86, 0.88, 0.91) });
      y -= 21;
    });
    const bytes = await pdf.save();
    download(new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }), `movimento-${movement.batchId.replace("stock_batch_", "").slice(0, 8)}.pdf`);
  };
  const movementTone = (kind: string) => kind === "ENTRADA" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : kind === "SAIDA" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <>
      <Card title="Filtros do histórico">
        <div className="grid gap-3 lg:grid-cols-5">
          <Label text="De">
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Label>
          <Label text="Até">
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Label>
          <Label text="Código">
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Label>
          <Label text="Movimento">
            <select
              className="input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="">Todos os movimentos</option>
              <option value="ENTRADA">Somente entradas</option>
              <option value="SAIDA">Somente saídas</option>
              <option value="AJUSTE">Ajustes</option>
              <option value="INVENTARIO">Inventários</option>
              <option value="REVERSAO">Reversões</option>
            </select>
          </Label>
          <Label text="Chave NF-e">
            <input
              className="input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => void load()}>
            {loading ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <Search size={17} />
            )}
            Consultar
          </button>
          <button className="btn-white" onClick={() => void exportXlsx(rows, "historico-saldo-filtrado")} disabled={!rows.length}>
            <Download size={17} />
            Excel do resultado
          </button>
        </div>
      </Card>
      <Card title={`${movements.length} movimento(s) · ${rows.length} produto(s) alterado(s)`}>
        <div className="space-y-3">
          {!loading && !movements.length && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center font-bold text-slate-500">Nenhum movimento encontrado para os filtros informados.</div>}
          {movements.map((movement) => {
            const isOpen = expanded.has(movement.batchId);
            return <section key={movement.batchId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="grid items-center gap-3 p-4 md:grid-cols-[minmax(150px,0.8fr)_minmax(180px,1fr)_minmax(120px,0.7fr)_auto]">
                <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => toggleMovement(movement.batchId)} aria-expanded={isOpen}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${movementTone(movement.kind)}`}><ChevronDown size={19} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} /></span>
                  <span><b className="block text-sm text-slate-950">{formatDate(movement.createdAt)}</b><small className="text-slate-500">{movement.rows.length} produto(s)</small></span>
                </button>
                <div className="min-w-0"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${movementTone(movement.kind)}`}>{movement.kind}</span><div className="mt-1 truncate text-xs font-semibold text-slate-600" title={movement.reason}>{movement.reason}</div></div>
                <div className="text-xs text-slate-600"><b className="block text-slate-900">{movement.actor}</b>{movement.accessKeys.length ? `${movement.accessKeys.length} NF-e(s)` : "Movimento manual"}</div>
                <div className="flex flex-wrap justify-end gap-2"><button className="btn-white" onClick={() => void exportXlsx(movement.rows, `movimento-${movement.batchId.slice(-8)}`)}><Download size={15} /> Excel</button><button className="btn-white" onClick={() => void exportPdf(movement)}><FileText size={15} /> PDF</button><button className="btn-primary" onClick={() => toggleMovement(movement.batchId)}>{isOpen ? "Ocultar" : "Ver itens"}</button></div>
              </div>
              {isOpen && <div className="overflow-auto border-t border-slate-200 bg-slate-50 p-3"><table className="admin-table"><thead><tr><th>Código</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Saldo anterior</th><th>Novo saldo</th><th>NF-e</th></tr></thead><tbody>{movement.rows.map((item) => <tr key={item.movementId}><td className="font-black">{item.productCode}</td><td>{item.productName}</td><td>{item.kind}</td><td className={item.quantity < 0 ? "font-black text-red-700" : "font-black text-emerald-700"}>{item.quantity > 0 ? "+" : ""}{item.quantity}</td><td>{item.previousBalance}</td><td className="font-black">{item.newBalance}</td><td className="max-w-[260px] break-all text-xs">{item.accessKey || "-"}</td></tr>)}</tbody></table></div>}
            </section>;
          })}
        </div>
      </Card>
    </>
  );
}

function stockError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error
        ? String(
            (error as { message?: string }).message || JSON.stringify(error),
          )
        : String(error);
  if (/duplicate|23505/i.test(raw))
    return `Este documento já foi processado. ${raw}`;
  if (/negative|negativo|23514/i.test(raw))
    return `O lote foi bloqueado para evitar saldo negativo. ${raw}`;
  if (/permission|42501/i.test(raw))
    return "Seu usuário não possui autorização para movimentar o estoque.";
  return raw || "Não foi possível processar o lote.";
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-5 text-lg font-black text-navy">{title}</h3>
      {children}
    </section>
  );
}
function Label({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">
        {text}
      </span>
      {children}
    </label>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[10px] font-black uppercase text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm font-bold">{value}</div>
    </div>
  );
}
