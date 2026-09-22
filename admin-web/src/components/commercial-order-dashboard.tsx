"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Download,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import type { SalesOrder } from "@/lib/types";

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value: number) => value.toLocaleString("pt-BR");
const percent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const statusLabels: Record<string, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Em análise",
  RETURNED: "Devolvido",
  APPROVED: "Aprovado",
  PARTIALLY_INVOICED: "Faturado parcial",
  INVOICED: "Faturado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
};
const realizedStatuses = new Set(["APPROVED", "PARTIALLY_INVOICED", "INVOICED"]);
const openStatuses = new Set(["SUBMITTED", "RETURNED", "APPROVED", "PARTIALLY_INVOICED"]);

type PeriodKey = "7" | "30" | "90" | "365" | "ALL";
type RankingRow = { id: string; label: string; secondary?: string; orders: number; quantity: number; value: number };

function orderDate(order: SalesOrder) {
  return new Date(order.submittedAt || order.createdAt);
}

function startOfPeriod(days: number, end: Date) {
  const result = new Date(end);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - days + 1);
  return result;
}

function summarize(orders: SalesOrder[]) {
  const realized = orders.filter((order) => realizedStatuses.has(order.status));
  const total = realized.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const submitted = orders.filter((order) => order.status !== "DRAFT");
  const quantities = submitted.reduce(
    (sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0),
    0,
  );
  const gross = submitted.reduce(
    (sum, order) => sum + Number(order.subtotal || 0),
    0,
  );
  const discount = submitted.reduce((sum, order) => sum + Number(order.discount || 0), 0);
  return {
    total,
    orders: submitted.length,
    realized: realized.length,
    ticket: realized.length ? total / realized.length : 0,
    quantities,
    discountRate: gross > 0 ? (discount / gross) * 100 : 0,
    openValue: orders.filter((order) => openStatuses.has(order.status)).reduce((sum, order) => sum + Number(order.total || 0), 0),
  };
}

function change(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function downloadCsv(orders: SalesOrder[]) {
  const header = ["Pedido", "Data", "Cliente", "Representante", "Status", "Subtotal", "Desconto", "Total", "Itens"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = orders.map((order) => [
    String(order.orderNumber).padStart(6, "0"),
    orderDate(order).toLocaleDateString("pt-BR"),
    order.clientSnapshot?.company || order.clientSnapshot?.name || "Cliente",
    order.representativeSnapshot?.name || "Representante",
    statusLabels[order.status] || order.status,
    Number(order.subtotal || 0).toFixed(2),
    Number(order.discount || 0).toFixed(2),
    Number(order.total || 0).toFixed(2),
    (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  ]);
  const csv = [header, ...rows].map((row) => row.map(escape).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pedidos-briland-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CommercialOrderDashboard({ orders }: { orders: SalesOrder[] }) {
  const [period, setPeriod] = useState<PeriodKey>("30");
  const analytics = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const days = period === "ALL" ? null : Number(period);
    const start = days ? startOfPeriod(days, end) : new Date(0);
    const previousStart = days ? startOfPeriod(days, new Date(start.getTime() - 1)) : new Date(0);
    const current = orders.filter((order) => orderDate(order) >= start && orderDate(order) <= end);
    const previous = days
      ? orders.filter((order) => orderDate(order) >= previousStart && orderDate(order) < start)
      : [];
    const summary = summarize(current);
    const previousSummary = summarize(previous);

    const byStatus = Object.entries(statusLabels).map(([status, label]) => {
      const matching = current.filter((order) => order.status === status);
      return { status, label, count: matching.length, value: matching.reduce((sum, order) => sum + Number(order.total || 0), 0) };
    }).filter((item) => item.count > 0);

    const buildRanking = (kind: "client" | "representative" | "product") => {
      const map = new Map<string, RankingRow & { orderIds: Set<string> }>();
      for (const order of current.filter((item) => item.status !== "DRAFT" && item.status !== "CANCELLED" && item.status !== "REJECTED")) {
        if (kind === "product") {
          for (const item of order.items || []) {
            const key = item.productId || item.productCode;
            const row = map.get(key) || { id: key, label: item.productName, secondary: item.productCode, orders: 0, quantity: 0, value: 0, orderIds: new Set<string>() };
            row.orderIds.add(order.id);
            row.quantity += Number(item.quantity || 0);
            row.value += Number(item.lineTotal || 0);
            map.set(key, row);
          }
        } else {
          const isClient = kind === "client";
          const key = isClient ? order.clientId || String(order.clientSnapshot?.company || order.clientSnapshot?.name || "Cliente") : order.representativeId;
          const label = String(isClient ? order.clientSnapshot?.company || order.clientSnapshot?.name || "Cliente" : order.representativeSnapshot?.name || "Representante");
          const row = map.get(key) || { id: key, label, orders: 0, quantity: 0, value: 0, orderIds: new Set<string>() };
          row.orderIds.add(order.id);
          row.quantity += (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
          row.value += Number(order.total || 0);
          map.set(key, row);
        }
      }
      return [...map.values()].map(({ orderIds, ...row }) => ({ ...row, orders: orderIds.size })).sort((a, b) => b.value - a.value).slice(0, 10);
    };

    const bucketCount = days && days <= 31 ? Math.min(days, 14) : 12;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const bucketEnd = new Date(end);
      if (days && days <= 31) bucketEnd.setDate(bucketEnd.getDate() - (bucketCount - index - 1));
      else bucketEnd.setMonth(bucketEnd.getMonth() - (bucketCount - index - 1), 1);
      bucketEnd.setHours(23, 59, 59, 999);
      const bucketStart = new Date(bucketEnd);
      if (days && days <= 31) bucketStart.setHours(0, 0, 0, 0);
      else { bucketStart.setDate(1); bucketStart.setHours(0, 0, 0, 0); bucketEnd.setMonth(bucketEnd.getMonth() + 1, 0); }
      const bucketOrders = current.filter((order) => orderDate(order) >= bucketStart && orderDate(order) <= bucketEnd && realizedStatuses.has(order.status));
      return {
        label: days && days <= 31 ? bucketStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : bucketStart.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        value: bucketOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      };
    });

    return { current, summary, previousSummary, byStatus, buckets, clients: buildRanking("client"), representatives: buildRanking("representative"), products: buildRanking("product") };
  }, [orders, period]);

  const maxBucket = Math.max(...analytics.buckets.map((bucket) => bucket.value), 1);
  const totalChange = change(analytics.summary.total, analytics.previousSummary.total);
  const orderChange = change(analytics.summary.orders, analytics.previousSummary.orders);
  const periodLabel = period === "ALL" ? "Todo o histórico" : `Últimos ${period} dias`;
  const kpis = [
    { label: "Valor realizado", value: money(analytics.summary.total), helper: "Aprovados e faturados", icon: TrendingUp, change: totalChange },
    { label: "Pedidos recebidos", value: integer(analytics.summary.orders), helper: `${analytics.summary.realized} convertidos`, icon: ShoppingCart, change: orderChange },
    { label: "Ticket médio", value: money(analytics.summary.ticket), helper: "Sobre pedidos convertidos", icon: ReceiptText },
    { label: "Carteira em aberto", value: money(analytics.summary.openValue), helper: "Análise, aprovado e parcial", icon: PackageCheck },
    { label: "Itens negociados", value: integer(analytics.summary.quantities), helper: "Soma das quantidades", icon: Users },
    { label: "Desconto médio", value: percent(analytics.summary.discountRate), helper: "Sobre o valor bruto", icon: CalendarRange },
  ];

  return (
    <section className="mb-6 space-y-6" aria-label="Inteligência comercial de pedidos">
      <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div><div className="text-xs font-black uppercase tracking-[.18em] text-blue-700">Inteligência comercial</div><h3 className="mt-1 text-2xl font-black text-slate-950">Visão executiva de pedidos</h3><p className="mt-1 text-sm font-semibold text-slate-500">Indicadores, evolução e rankings calculados sobre a operação real.</p></div>
        <div className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Período</span><select className="input min-w-[190px]" value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option><option value="ALL">Todo o histórico</option></select></label><button className="btn-white h-12" onClick={() => downloadCsv(analytics.current)}><Download size={17}/> Exportar CSV</button></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => <article key={kpi.label} className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><kpi.icon size={19}/></div>{kpi.change !== undefined && period !== "ALL" && <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${kpi.change >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{kpi.change >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>} {percent(Math.abs(kpi.change))}</span>}</div><div className="mt-4 text-2xl font-black tracking-tight text-slate-950">{kpi.value}</div><div className="mt-1 text-xs font-black text-slate-700">{kpi.label}</div><div className="mt-1 text-[11px] font-semibold text-slate-500">{kpi.helper}</div></article>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><h3 className="font-black text-slate-950">Evolução comercial</h3><p className="mt-1 text-xs font-semibold text-slate-500">{periodLabel} · valor aprovado ou faturado</p></div><strong className="text-sm text-blue-800">{money(analytics.summary.total)}</strong></div><div className="mt-6 flex h-56 items-end gap-2 border-b border-slate-200 px-1">{analytics.buckets.map((bucket) => <div key={bucket.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><div className="relative w-full rounded-t-md bg-gradient-to-t from-blue-800 to-blue-500 transition hover:from-yellow-600 hover:to-yellow-400" style={{ height: `${Math.max((bucket.value / maxBucket) * 180, bucket.value ? 8 : 2)}px` }} title={`${bucket.label}: ${money(bucket.value)}`}/><span className="max-w-full truncate text-[9px] font-bold text-slate-500">{bucket.label}</span></div>)}</div></article>
        <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black text-slate-950">Distribuição por status</h3><p className="mt-1 text-xs font-semibold text-slate-500">Quantidade e valor no período</p><div className="mt-5 space-y-4">{analytics.byStatus.map((item) => { const share = analytics.summary.orders ? (item.count / analytics.summary.orders) * 100 : 0; return <div key={item.status}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-black text-slate-700">{item.label} <span className="text-slate-400">({item.count})</span></span><span className="font-black text-slate-950">{money(item.value)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-700" style={{ width: `${Math.min(share, 100)}%` }}/></div></div>})}{!analytics.byStatus.length && <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">Sem pedidos neste período.</div>}</div></article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Ranking title="Clientes por valor" rows={analytics.clients}/>
        <Ranking title="Representantes por valor" rows={analytics.representatives}/>
        <Ranking title="Produtos por valor" rows={analytics.products}/>
      </div>
    </section>
  );
}

function Ranking({ title, rows }: { title: string; rows: RankingRow[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return <article className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h3 className="font-black text-slate-950">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">Top 10 do período selecionado</p></div><div className="divide-y divide-slate-100">{rows.map((row, index) => <div key={row.id} className="px-5 py-4"><div className="flex items-start gap-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${index < 3 ? "bg-yellow-100 text-yellow-800" : "bg-slate-100 text-slate-600"}`}>{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900" title={row.label}>{row.label}</div><div className="mt-0.5 text-[10px] font-semibold text-slate-500">{row.secondary ? `${row.secondary} · ` : ""}{row.orders} pedido(s) · {integer(row.quantity)} unidade(s)</div></div><strong className="whitespace-nowrap text-xs text-slate-950">{money(row.value)}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-700" style={{ width: `${(row.value / max) * 100}%` }}/></div></div></div></div>)}{!rows.length && <div className="p-6 text-center text-sm font-semibold text-slate-500">Sem dados para o ranking.</div>}</div></article>;
}
