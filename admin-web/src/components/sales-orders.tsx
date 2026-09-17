"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  Filter,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Produto, SalesOrder, SalesOrderItem, Usuario } from "@/lib/types";
import { orderPdfFile } from "@/lib/order-pdf";

const statusLabel: Record<string, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  RETURNED: "Devolvido",
  APPROVED: "Aprovado",
  INVOICED: "Faturado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
};
const statusStyle: Record<string, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  SUBMITTED: "border-blue-200 bg-blue-100 text-blue-800",
  RETURNED: "border-amber-200 bg-amber-100 text-amber-800",
  APPROVED: "border-emerald-200 bg-emerald-100 text-emerald-800",
  INVOICED: "border-cyan-200 bg-cyan-100 text-cyan-800",
  REJECTED: "border-red-200 bg-red-100 text-red-800",
  CANCELLED: "border-slate-300 bg-slate-200 text-slate-600",
};
const number = (value: number) => String(value).padStart(6, "0");
const money = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "-";

export function SalesOrders({
  products,
  users,
  notify,
  newOrderIds = [],
  canMarkSeen = false,
  onOrderSeen,
}: {
  products: Produto[];
  users: Usuario[];
  notify: (message: string) => void;
  newOrderIds?: string[];
  canMarkSeen?: boolean;
  onOrderSeen?: (orderId: string) => void;
}) {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [stock, setStock] = useState<
    Array<{ productId: string; availableBalance: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("SUBMITTED");
  const [clientFilter, setClientFilter] = useState("ALL");
  const [representativeFilter, setRepresentativeFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("OLDEST");
  const load = async () => {
    setLoading(true);
    const [o, s] = await Promise.all([
      supabase
        .from("SalesOrder")
        .select(
          "*,items:SalesOrderItem(*),history:SalesOrderHistory(*),reservations:StockReservation(*)",
        )
        .order("submittedAt", { ascending: true, nullsFirst: false }),
      supabase.rpc("get_sales_stock"),
    ]);
    if (o.error) notify(o.error.message);
    else {
      setOrders((o.data || []) as SalesOrder[]);
      if (selected)
        setSelected(
          ((o.data || []).find(
            (item) => item.id === selected.id,
          ) as SalesOrder) || null,
        );
    }
    if (!s.error) setStock(s.data || []);
    setLoading(false);
  };
  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-sales-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "SalesOrder" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
  const clientOptions = useMemo(() => Array.from(new Map(orders.map((order) => [order.clientId || String(order.clientSnapshot?.company || ""), { id: order.clientId || String(order.clientSnapshot?.company || ""), name: String(order.clientSnapshot?.company || order.clientSnapshot?.name || "Cliente") }])).values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [orders]);
  const representativeOptions = useMemo(() => Array.from(new Map(orders.map((order) => [order.representativeId, { id: order.representativeId, name: String(order.representativeSnapshot?.name || "Representante") }])).values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [orders]);
  const filtered = useMemo(() => {
    const result = orders.filter(
        (o) =>
          (status === "ALL" || o.status === status) &&
          (clientFilter === "ALL" || (o.clientId || String(o.clientSnapshot?.company || "")) === clientFilter) &&
          (representativeFilter === "ALL" || o.representativeId === representativeFilter) &&
          (!dateFrom || new Date(o.submittedAt || o.createdAt).getTime() >= new Date(`${dateFrom}T00:00:00`).getTime()) &&
          (!dateTo || new Date(o.submittedAt || o.createdAt).getTime() <= new Date(`${dateTo}T23:59:59`).getTime()) &&
          `${number(o.orderNumber)} ${o.clientSnapshot?.company || ""} ${o.representativeSnapshot?.name || ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      );
    return result.sort((a, b) => {
      if (sort === "HIGHEST") return Number(b.total) - Number(a.total);
      if (sort === "LOWEST") return Number(a.total) - Number(b.total);
      const left = new Date(a.submittedAt || a.createdAt).getTime();
      const right = new Date(b.submittedAt || b.createdAt).getTime();
      return sort === "NEWEST" ? right - left : left - right;
    });
  }, [orders, status, clientFilter, representativeFilter, dateFrom, dateTo, query, sort]);
  const newOrderIdSet = useMemo(() => new Set(newOrderIds), [newOrderIds]);
  const newFiltered = filtered.filter(
    (order) => order.status === "SUBMITTED" && newOrderIdSet.has(order.id),
  );
  const reviewedFiltered = filtered.filter(
    (order) => !newOrderIdSet.has(order.id),
  );
  const openOrder = async (order: SalesOrder) => {
    setSelected(order);
    if (!canMarkSeen || order.status !== "SUBMITTED" || !newOrderIdSet.has(order.id)) return;
    const { data, error } = await supabase.rpc("mark_sales_order_admin_seen", {
      p_order_id: order.id,
    });
    if (error) {
      notify(error.message);
      return;
    }
    const seenAt = (data as SalesOrder | null)?.adminSeenAt || new Date().toISOString();
    setOrders((current) =>
      current.map((item) =>
        item.id === order.id ? { ...item, adminSeenAt: seenAt } : item,
      ),
    );
    setSelected((current) =>
      current?.id === order.id ? { ...current, adminSeenAt: seenAt } : current,
    );
    onOrderSeen?.(order.id);
  };
  const orderRow = (o: SalesOrder, isNewOrder: boolean) => (
    <tr key={o.id} className={`border-b border-slate-100 transition hover:bg-blue-50/50 ${isNewOrder ? "bg-amber-50/70" : "bg-white"}`}>
      <td className="px-5 py-4 align-middle font-black">
        <div className="flex items-center gap-2">
          {number(o.orderNumber)}
          {isNewOrder && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
              NOVO
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-4 align-middle text-sm font-semibold text-slate-600">{date(o.submittedAt || o.createdAt)}</td>
      <td className="px-4 py-4 align-middle">
        <b>{String(o.clientSnapshot?.company || "Não definido")}</b>
        <div className="text-xs text-muted">
          {String(o.clientSnapshot?.cnpj || "")}
          {o.clientSnapshot?.stateRegistration
            ? ` | IE ${String(o.clientSnapshot.stateRegistration)}`
            : " | IE não informada"}
        </div>
      </td>
      <td className="px-4 py-4 align-middle text-sm font-bold">{String(o.representativeSnapshot?.name || "-")}</td>
      <td className="px-4 py-4 align-middle"><span className={`inline-flex rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${statusStyle[o.status]}`}>{statusLabel[o.status]}</span></td>
      <td className="px-4 py-4 text-right align-middle font-black tabular-nums">{money(o.total)}</td>
      <td className="px-4 py-4 text-center align-middle">
        <button className="icon-btn" title="Abrir pedido" onClick={() => void openOrder(o)}>
          <Eye size={16} />
        </button>
      </td>
    </tr>
  );
  const activeFilterCount = [query, clientFilter !== "ALL", representativeFilter !== "ALL", dateFrom, dateTo, status !== "ALL", sort !== "OLDEST"].filter(Boolean).length;
  const clearFilters = () => {
    setQuery("");
    setStatus("ALL");
    setClientFilter("ALL");
    setRepresentativeFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setSort("OLDEST");
  };
  return (
    <>
      <div className="mb-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#03162f] via-[#06264b] to-[#0b4a7d] p-6 text-white shadow-xl lg:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[.2em] text-yellow">Central comercial</div><h2 className="mt-2 text-3xl font-black tracking-tight">Gestão de pedidos</h2><p className="mt-2 max-w-2xl text-sm font-semibold text-white/65">Acompanhe os pedidos recebidos, priorize os novos e tome decisões comerciais com todas as informações organizadas.</p></div><div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur"><div className="text-xs font-bold text-white/60">Volume aguardando decisão</div><div className="mt-1 text-2xl font-black text-yellow">{money(orders.filter((o) => o.status === "SUBMITTED").reduce((a, o) => a + Number(o.total), 0))}</div></div></div>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setStatus("SUBMITTED")} className="rounded-[22px] border border-red-100 bg-gradient-to-br from-white to-red-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700"><Eye size={19} /></div><span className="rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black text-white">URGENTE</span></div><div className="mt-5 text-3xl font-black">{newOrderIds.length}</div><div className="mt-1 text-sm font-black">Novos pedidos</div><div className="mt-1 text-xs font-semibold text-slate-500">Ainda não visualizados</div></button>
        <button onClick={() => setStatus("SUBMITTED")} className="rounded-[22px] border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><RefreshCw size={19} /></div><div className="mt-5 text-3xl font-black">{orders.filter((o) => o.status === "SUBMITTED").length}</div><div className="mt-1 text-sm font-black">Aguardando análise</div><div className="mt-1 text-xs font-semibold text-slate-500">Fila comercial ativa</div></button>
        <button onClick={() => setStatus("APPROVED")} className="rounded-[22px] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><CheckCircle2 size={19} /></div><div className="mt-5 text-3xl font-black">{orders.filter((o) => o.status === "APPROVED").length}</div><div className="mt-1 text-sm font-black">Aprovados</div><div className="mt-1 text-xs font-semibold text-slate-500">Aguardando faturamento</div></button>
        <button onClick={() => setStatus("INVOICED")} className="rounded-[22px] border border-cyan-100 bg-gradient-to-br from-white to-cyan-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><PackageCheck size={19} /></div><div className="mt-5 text-3xl font-black">{orders.filter((o) => o.status === "INVOICED").length}</div><div className="mt-1 text-sm font-black">Faturados</div><div className="mt-1 text-xs font-semibold text-slate-500">NF-e conciliada e estoque baixado</div></button>
      </div>
      <div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-base font-black"><Filter size={18} className="text-blue-700" /> Filtros comerciais</div><div className="mt-1 text-xs font-semibold text-slate-500">Refine a fila por cliente, representante, período, status ou valor.</div></div>{activeFilterCount > 0 && <button className="text-xs font-black text-blue-700 hover:underline" onClick={clearFilters}>Limpar {activeFilterCount} filtro(s)</button>}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="xl:col-span-2"><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Buscar pedido</span><div className="search-control flex h-12 items-center gap-2 px-4"><Search size={17} />
            <input
              className="w-full bg-transparent outline-none"
              placeholder="Pedido, cliente ou representante"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            /></div></label>
          <label className="relative"><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Cliente</span><select className="input appearance-none pr-10" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}><option value="ALL">Todos os clientes</option>{clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><ChevronDown className="pointer-events-none absolute bottom-4 right-3 text-slate-400" size={16} /></label>
          <label className="relative"><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Representante</span><select className="input appearance-none pr-10" value={representativeFilter} onChange={(e) => setRepresentativeFilter(e.target.value)}><option value="ALL">Todos os representantes</option>{representativeOptions.map((representative) => <option key={representative.id} value={representative.id}>{representative.name}</option>)}</select><ChevronDown className="pointer-events-none absolute bottom-4 right-3 text-slate-400" size={16} /></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">De</span><input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Até</span><input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
          <label className="relative"><span className="mb-1 block text-[10px] font-black uppercase text-slate-500">Ordenação</span><select className="input appearance-none pr-10" value={sort} onChange={(e) => setSort(e.target.value)}><option value="OLDEST">Mais antigos primeiro</option><option value="NEWEST">Mais recentes primeiro</option><option value="HIGHEST">Maior valor primeiro</option><option value="LOWEST">Menor valor primeiro</option></select><ChevronDown className="pointer-events-none absolute bottom-4 right-3 text-slate-400" size={16} /></label>
          <button className="btn-white mt-[15px]" onClick={() => void load()}>
            {loading ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <RefreshCw size={17} />
            )}
            Atualizar
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setStatus("ALL")} className={`rounded-full border px-3 py-2 text-xs font-black transition ${status === "ALL" ? "border-navy bg-navy text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>Todos ({orders.length})</button>{Object.entries(statusLabel).map(([key, label]) => <button key={key} onClick={() => setStatus(key)} className={`rounded-full border px-3 py-2 text-xs font-black transition ${status === key ? statusStyle[key] : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{label} ({orders.filter((order) => order.status === key).length})</button>)}</div>
      </div>
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h3 className="font-black">Fila de pedidos</h3><p className="mt-1 text-xs font-semibold text-slate-500">{filtered.length} pedido(s) encontrado(s)</p></div><PackageCheck className="text-blue-700" size={22} /></div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse">
            <colgroup><col className="w-[13%]" /><col className="w-[16%]" /><col className="w-[24%]" /><col className="w-[17%]" /><col className="w-[13%]" /><col className="w-[12%]" /><col className="w-[5%]" /></colgroup>
            <thead className="bg-[#061a34] text-white">
              <tr className="text-left text-[10px] font-black uppercase tracking-[.13em]">
                <th className="px-5 py-4">Pedido</th>
                <th className="px-4 py-4">Enviado em</th>
                <th className="px-4 py-4">Cliente</th>
                <th className="px-4 py-4">Representante</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4 text-right">Total</th>
                <th className="px-4 py-4 text-center">Abrir</th>
              </tr>
            </thead>
            <tbody>
              {newFiltered.length > 0 && (
                <tr className="bg-red-50">
                  <td colSpan={7} className="border-b border-red-200 px-4 py-3 text-xs font-black uppercase tracking-wider text-red-700">
                    Novos pedidos - prioridade ({newFiltered.length})
                  </td>
                </tr>
              )}
              {newFiltered.map((order) => orderRow(order, true))}
              {reviewedFiltered.length > 0 && newFiltered.length > 0 && (
                <tr className="bg-slate-50">
                  <td colSpan={7} className="border-b px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">
                    Pedidos já visualizados
                  </td>
                </tr>
              )}
              {reviewedFiltered.map((order) => orderRow(order, false))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <div className="px-5 py-16 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Search size={24} /></div><div className="mt-4 font-black">Nenhum pedido encontrado</div><div className="mt-1 text-sm font-semibold text-slate-500">Ajuste os filtros para ampliar o resultado da consulta.</div>
          </div>
        )}
      </div>
      {selected && (
        <OrderModal
          order={selected}
          products={products}
          clients={users.filter(
            (u) =>
              u.role === "CLIENTE" &&
              u.representanteId === selected.representativeId,
          )}
          stock={stock}
          notify={notify}
          reload={load}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function OrderModal({
  order,
  products,
  clients,
  stock,
  notify,
  reload,
  onClose,
}: {
  order: SalesOrder;
  products: Produto[];
  clients: Usuario[];
  stock: Array<{ productId: string; availableBalance: number }>;
  notify: (m: string) => void;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const editable = order.status === "SUBMITTED";
  const [clientId, setClientId] = useState(order.clientId || "");
  const [freight, setFreight] = useState(order.freightType || "CIF");
  const [redispatchName, setRedispatchName] = useState(
    order.redispatchName || "",
  );
  const [redispatchPhone, setRedispatchPhone] = useState(
    order.redispatchPhone || "",
  );
  const [payment, setPayment] = useState(order.paymentType || "INSTALLMENTS");
  const [terms, setTerms] = useState(order.paymentTerms || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [items, setItems] = useState<SalesOrderItem[]>(
    (order.items || []).sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [busy, setBusy] = useState(false);
  const [pq, setPq] = useState("");
  const calculate = (item: SalesOrderItem) => {
    const extra = payment === "UPFRONT" ? 5 : 0;
    const manual = Number(item.manualDiscountPercent || 0);
    const effective =
      Math.round(
        (100 - (1 - manual / 100) * (1 - extra / 100) * 100) * 100,
      ) / 100;
    const unit =
      Math.round(
        item.listPrice * (1 - manual / 100) * (1 - extra / 100) * 100,
      ) / 100;
    return {
      ...item,
      paymentDiscountPercent: extra,
      effectiveDiscountPercent: effective,
      unitPrice: unit,
      lineTotal: unit * item.quantity,
    };
  };
  const calculated = items.map(calculate);
  const totals = calculated.reduce(
    (a, i) => ({
      sub: a.sub + i.listPrice * i.quantity,
      total: a.total + i.lineTotal,
    }),
    { sub: 0, total: 0 },
  );
  const suggestions = products
    .filter(
      (p) =>
        p.preco != null &&
        !items.some((i) => i.productId === p.id) &&
        `${p.codigoInterno} ${p.nome}`.toLowerCase().includes(pq.toLowerCase()),
    )
    .slice(0, 6);
  const save = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("save_sales_order", {
      p_order_id: order.id,
      p_client_id: clientId,
      p_freight_type: freight,
      p_redispatch_name: redispatchName,
      p_redispatch_phone: redispatchPhone,
      p_payment_type: payment,
      p_payment_terms: terms,
      p_notes: notes,
      p_items: calculated.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        manualDiscountPercent: i.manualDiscountPercent,
      })),
      p_submit: false,
    });
    if (error) notify(error.message);
    else {
      await uploadAdminPdf({ ...data, items: calculated } as SalesOrder);
      notify("Pedido atualizado e alteração registrada no histórico.");
      await reload();
    }
    setBusy(false);
  };
  const transition = async (action: string) => {
    const verb =
      action === "APPROVE"
        ? "aprovar"
        : action === "RETURN"
          ? "devolver"
          : "rejeitar";
    const comment = window.prompt(
      `Informe a observação para ${verb} o pedido:`,
    );
    if (comment === null) return;
    if (action !== "APPROVE" && !comment.trim()) {
      notify("Informe uma justificativa.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("transition_sales_order", {
      p_order_id: order.id,
      p_action: action,
      p_comment: comment,
    });
    if (error) notify(error.message);
    else {
      notify(`Pedido ${verb} concluído.`);
      await reload();
      if (action !== "RETURN") onClose();
    }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-navy/70 p-4 backdrop-blur-sm">
      <div className="mx-auto my-5 max-w-6xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between bg-gradient-to-r from-[#03162f] to-[#0b4a7d] p-6 text-white">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-yellow">
              Pedido recebido
            </div>
            <h2 className="text-3xl font-black">{number(order.orderNumber)}</h2>
            <span className={`mt-2 inline-flex rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${statusStyle[order.status]}`}>{statusLabel[order.status]}</span>
          </div>
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="p-6">
        <div className="mb-5 grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm md:grid-cols-3">
          <div>
            <small className="font-bold text-muted">Razão social</small>
            <div className="font-black">{String(order.clientSnapshot?.company || order.clientSnapshot?.name || "-")}</div>
          </div>
          <div>
            <small className="font-bold text-muted">CNPJ</small>
            <div className="font-black">{String(order.clientSnapshot?.cnpj || "-")}</div>
          </div>
          <div>
            <small className="font-bold text-muted">Inscrição estadual</small>
            <div className="font-black">{String(order.clientSnapshot?.stateRegistration || "Não informada")}</div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="field-label">
            Cliente
            <select
              className="input"
              disabled={!editable}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Frete
            <select
              className="input"
              disabled={!editable}
              value={freight}
              onChange={(e) => setFreight(e.target.value as "CIF" | "FOB")}
            >
              <option>CIF</option>
              <option>FOB</option>
            </select>
          </label>
          <label className="field-label">
            Pagamento
            <select
              className="input"
              disabled={!editable}
              value={payment}
              onChange={(e) =>
                setPayment(e.target.value as "UPFRONT" | "INSTALLMENTS")
              }
            >
              <option value="INSTALLMENTS">Parcelado</option>
              <option value="UPFRONT">À vista antecipado</option>
            </select>
          </label>
          <label className="field-label">
            Redespacho
            <input
              className="input"
              disabled={!editable}
              value={redispatchName}
              onChange={(e) => setRedispatchName(e.target.value)}
            />
          </label>
          <label className="field-label">
            Telefone redespacho
            <input
              className="input"
              disabled={!editable}
              value={redispatchPhone}
              onChange={(e) => setRedispatchPhone(e.target.value)}
            />
          </label>
          {payment === "INSTALLMENTS" && (
            <label className="field-label">
              Prazo
              <input
                className="input"
                disabled={!editable}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </label>
          )}
        </div>
        {payment === "UPFRONT" && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-200 font-black">5%</div>
            <div><div className="font-black">Desconto adicional por pagamento à vista</div><div className="text-xs font-semibold text-amber-800">Os 5% são aplicados sobre o valor já reduzido pelo desconto comercial, sem somar os percentuais.</div></div>
          </div>
        )}
        {editable && (
          <div className="relative my-5">
            <input
              className="input"
              placeholder="Adicionar produto por código ou nome"
              value={pq}
              onChange={(e) => setPq(e.target.value)}
            />
            {pq && (
              <div className="absolute z-10 w-full rounded-xl border bg-white shadow-xl">
                {suggestions.map((p) => (
                  <button
                    className="block w-full border-b p-3 text-left"
                    key={p.id}
                    onClick={() => {
                      setItems([
                        ...items,
                        {
                          productId: p.id,
                          productCode: p.codigoInterno || p.id,
                          productName: p.nome,
                          quantity: 1,
                          listPrice: Number(p.preco),
                          manualDiscountPercent: 0,
                          paymentDiscountPercent: 0,
                          effectiveDiscountPercent: 0,
                          unitPrice: Number(p.preco),
                          lineTotal: Number(p.preco),
                          sortOrder: items.length,
                        },
                      ]);
                      setPq("");
                    }}
                  >
                    {p.codigoInterno} - {p.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse">
            <colgroup><col className="w-[9%]" /><col className="w-[23%]" /><col className="w-[8%]" /><col className="w-[8%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[4%]" /></colgroup>
            <thead className="bg-[#061a34] text-white">
              <tr className="text-[10px] font-black uppercase tracking-[.08em]">
                <th className="px-3 py-4 text-left">Código</th>
                <th className="px-3 py-4 text-left">Descrição</th>
                <th className="px-3 py-4 text-center">Disponível</th>
                <th className="px-3 py-4 text-center">Quantidade</th>
                <th className="px-3 py-4 text-right">Tabela</th>
                <th className="px-3 py-4 text-center">Desc. comercial</th>
                <th className="px-3 py-4 text-center">Desc. à vista</th>
                <th className="px-3 py-4 text-right">Unitário final</th>
                <th className="px-3 py-4 text-right">Total</th>
                <th className="px-2 py-4 text-center" />
              </tr>
            </thead>
            <tbody>
              {calculated.map((i, index) => (
                <tr key={i.productId} className="border-b border-slate-100 bg-white transition last:border-0 hover:bg-blue-50/40">
                  <td className="px-3 py-4 align-middle text-sm font-black">{i.productCode}</td>
                  <td className="px-3 py-4 align-middle text-sm font-bold leading-snug text-slate-700">{i.productName}</td>
                  <td className="px-3 py-4 text-center align-middle font-black tabular-nums">
                    {stock.find((s) => s.productId === i.productId)
                      ?.availableBalance ?? 0}
                  </td>
                  <td className="px-3 py-4 text-center align-middle">
                    <input
                      className="input h-10 w-full px-2 text-center tabular-nums"
                      type="number"
                      min="1"
                      disabled={!editable}
                      value={i.quantity}
                      onChange={(e) =>
                        setItems(
                          items.map((v, n) =>
                            n === index
                              ? { ...v, quantity: Number(e.target.value) }
                              : v,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-4 text-right align-middle text-sm font-bold tabular-nums">{money(i.listPrice)}</td>
                  <td className="px-3 py-4 text-center align-middle">
                    <div className="relative">
                    <input
                      className="input h-10 w-full px-2 pr-7 text-center tabular-nums"
                      type="number"
                      min="0"
                      max="100"
                      step=".01"
                      disabled={!editable}
                      value={i.manualDiscountPercent}
                      onChange={(e) =>
                        setItems(
                          items.map((v, n) =>
                            n === index
                              ? {
                                  ...v,
                                  manualDiscountPercent: Number(e.target.value),
                                }
                              : v,
                          ),
                        )
                      }
                    /><span className="pointer-events-none absolute right-2 top-2.5 text-xs font-black text-slate-400">%</span></div>
                  </td>
                  <td className="px-3 py-4 text-center align-middle">
                    {i.paymentDiscountPercent > 0 ? <div><span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">+ {i.paymentDiscountPercent}%</span><div className="mt-1 text-[9px] font-bold text-amber-700">após comercial</div></div> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-4 text-right align-middle text-sm font-bold tabular-nums">{money(i.unitPrice)}</td>
                  <td className="px-3 py-4 text-right align-middle text-sm font-black tabular-nums">{money(i.lineTotal)}</td>
                  <td className="px-2 py-4 text-center align-middle">
                    {editable && (
                      <button
                        className="icon-btn"
                        onClick={() =>
                          setItems(items.filter((_, n) => n !== index))
                        }
                      >
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <label className="field-label mt-5">
          Observações
          <textarea
            className="input min-h-20"
            disabled={!editable}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="ml-auto mt-5 max-w-sm rounded-2xl bg-soft p-5">
          <div className="flex justify-between">
            Subtotal <b>{money(totals.sub)}</b>
          </div>
          <div className="mt-2 flex justify-between">
            Desconto <b>- {money(totals.sub - totals.total)}</b>
          </div>
          <div className="mt-3 flex justify-between border-t pt-3 text-xl font-black">
            Total <span>{money(totals.total)}</span>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="btn-white"
            onClick={() => void downloadPdf({ ...order, items: calculated })}
          >
            <Download size={17} />
            PDF
          </button>
          {editable && (
            <>
              <button
                className="btn-white"
                disabled={busy}
                onClick={() => void save()}
              >
                <Save size={17} />
                Salvar alterações
              </button>
              <button
                className="btn-white border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                disabled={busy}
                onClick={() => void transition("RETURN")}
              >
                <RotateCcw size={17} />
                Devolver
              </button>
              <button
                className="btn-white border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                disabled={busy}
                onClick={() => void transition("REJECT")}
              >
                <XCircle size={17} />
                Rejeitar
              </button>
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-emerald-700"
                disabled={busy}
                onClick={() => void transition("APPROVE")}
              >
                <CheckCircle2 size={17} />
                Aprovar e baixar saldo
              </button>
            </>
          )}
        </div>
        <div className="mt-7 border-t pt-5">
          <h3 className="font-black">Histórico</h3>
          {(order.history || [])
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((h) => (
              <div key={h.id} className="border-b py-3 text-sm">
                <b>{statusLabel[h.action] || h.action}</b> -{" "}
                {h.actorName || "Sistema"} - {date(h.createdAt)}
                {h.comment && <p className="mt-1 text-muted">{h.comment}</p>}
              </div>
            ))}
        </div>
        </div>
      </div>
    </div>
  );
}

async function uploadAdminPdf(order: SalesOrder) {
  const file = await orderPdfFile(order, "/catalog-assets/briland-logo.png");
  await supabase.storage
    .from("sales-orders")
    .upload(`${order.id}/${file.name}`, file, {
      contentType: "application/pdf",
      upsert: true,
    });
}
async function downloadPdf(order: SalesOrder) {
  const file = await orderPdfFile(order, "/catalog-assets/briland-logo.png");
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}
