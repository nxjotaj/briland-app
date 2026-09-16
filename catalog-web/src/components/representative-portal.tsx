"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  Download,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Plus,
  Save,
  Search,
  Send,
  Share2,
  ShoppingBag,
  UserRound,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { orderPdfFile, stockPdfFile } from "@/lib/order-pdf";
import { maskCep, maskCnpj, maskPhone } from "@/lib/input-masks";
import { supabase } from "@/lib/supabase";
import type {
  Product,
  SalesOrder,
  SalesOrderItem,
  SalesStock,
  UserProfile,
} from "@/lib/types";

const labels: Record<string, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Enviado",
  RETURNED: "Devolvido",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
};
const cash = (value: number) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const orderNo = (value: number) => String(value).padStart(6, "0");
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "-";
type Props = {
  segments: string[];
  profile: UserProfile;
  products: Product[];
  navigate: (path: string) => void;
  logout: () => Promise<void>;
};

export function RepresentativePortal({
  segments,
  profile,
  products,
  navigate,
  logout,
}: Props) {
  const section = segments[1] || "dashboard";
  const number = segments[2];
  const [clients, setClients] = useState<UserProfile[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [stock, setStock] = useState<SalesStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const openingDraft = useRef(false);
  const [, setClock] = useState(0);
  const load = async () => {
    setLoading(true);
    await supabase.rpc("expire_abandoned_sales_order_drafts");
    const [c, o, s] = await Promise.all([
      supabase
        .from("User")
        .select("*")
        .eq("representanteId", profile.id)
        .eq("role", "CLIENTE")
        .order("company"),
      supabase
        .from("SalesOrder")
        .select("*,items:SalesOrderItem(*),history:SalesOrderHistory(*)")
        .order("createdAt", { ascending: false }),
      supabase.rpc("get_sales_stock"),
    ]);
    const first = [c, o, s].find((result) => result.error)?.error;
    if (first) setError(first.message);
    else {
      setClients((c.data || []) as UserProfile[]);
      setOrders((o.data || []) as SalesOrder[]);
      setStock((s.data || []) as SalesStock[]);
      setError("");
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`rep-orders-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "SalesOrder",
          filter: `representativeId=eq.${profile.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile.id]);
  const openOrder = async () => {
    const { data, error } = await supabase.rpc("open_sales_order_draft");
    if (error) {
      setError(error.message);
      return;
    }
    await load();
    navigate(
      `/representante/pedidos/${orderNo((data as SalesOrder).orderNumber)}`,
    );
  };
  useEffect(() => {
    const timer = setInterval(() => setClock((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (section === "pedidos" && number === "novo" && !openingDraft.current) {
      openingDraft.current = true;
      void openOrder();
    }
  }, [section, number]);
  const selected = number
    ? orders.find((item) => orderNo(item.orderNumber) === number)
    : undefined;
  const nav = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["saldo", "Saldo", Warehouse],
    ["clientes", "Clientes", Users],
    ["pedidos", "Pedidos", ShoppingBag],
    ["meus-dados", "Meus dados", UserRound],
  ] as const;
  if (profile.role !== "REPRESENTANTE")
    return (
      <div className="rep-denied">Acesso exclusivo para representantes.</div>
    );
  return (
    <div className="rep-shell">
      <aside className="rep-sidebar">
        <img src="/briland-logo.png" alt="Briland" />
        <small>PAINEL COMERCIAL</small>
        <button
          className="rep-catalog-link"
          onClick={() => navigate("/produtos")}
        >
          <ArrowLeft />
          Voltar ao catálogo
        </button>
        {nav.map(([id, label, Icon]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            onClick={() => navigate(`/representante/${id}`)}
          >
            <Icon />
            {label}
          </button>
        ))}
        <button className="rep-logout" onClick={() => void logout()}>
          <LogOut />
          Sair
        </button>
      </aside>
      <main className="rep-main">
        <header>
          <div>
            <span>REPRESENTANTE</span>
            <h1>{nav.find(([id]) => id === section)?.[1] || "Painel"}</h1>
          </div>
          <div className="rep-user">
            <b>{profile.name}</b>
            <small>
              Limite de desconto: {profile.orderDiscountLimit ?? 15}%
            </small>
          </div>
        </header>
        {error && <div className="rep-error">{error}</div>}
        {loading ? (
          <div className="rep-loading">Carregando...</div>
        ) : (
          <>
            {section === "dashboard" && (
              <Dashboard
                clients={clients}
                orders={orders}
                stock={stock}
                navigate={navigate}
              />
            )}
            {section === "saldo" && <StockPage rows={stock} />}
            {section === "clientes" && (
              <ClientsPage clients={clients} reload={load} />
            )}
            {section === "pedidos" && !number && (
              <OrdersPage
                orders={orders}
                clients={clients}
                openOrder={openOrder}
                navigate={navigate}
              />
            )}
            {section === "pedidos" && number && selected && (
              <OrderEditor
                order={selected}
                clients={clients}
                products={products}
                stock={stock}
                profile={profile}
                reload={load}
                navigate={navigate}
              />
            )}
            {section === "pedidos" && number && !selected && (
              <div className="rep-empty">Pedido não encontrado.</div>
            )}
            {section === "meus-dados" && <MyData profile={profile} />}
          </>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  clients,
  orders,
  stock,
  navigate,
}: {
  clients: UserProfile[];
  orders: SalesOrder[];
  stock: SalesStock[];
  navigate: (p: string) => void;
}) {
  const [client, setClient] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("recent");
  const filtered = orders
    .filter(
      (o) =>
        (client === "ALL" || o.clientId === client) &&
        (!from || new Date(o.createdAt) >= new Date(`${from}T00:00:00`)) &&
        (!to || new Date(o.createdAt) <= new Date(`${to}T23:59:59`)),
    )
    .sort((a, b) =>
      sort === "high"
        ? Number(b.total) - Number(a.total)
        : sort === "low"
          ? Number(a.total) - Number(b.total)
          : String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  const expiring = filtered.filter(
    (o) =>
      o.status === "DRAFT" &&
      new Date(o.expiresAt).getTime() - Date.now() < 86400000,
  );
  const cards = [
    ["Clientes", clients.length, Users, "/representante/clientes"],
    [
      "Rascunhos",
      filtered.filter((o) => o.status === "DRAFT").length,
      Clock3,
      "/representante/pedidos",
    ],
    [
      "Enviados",
      filtered.filter((o) => o.status === "SUBMITTED").length,
      Send,
      "/representante/pedidos",
    ],
    [
      "Aprovados",
      filtered.filter((o) => o.status === "APPROVED").length,
      PackageCheck,
      "/representante/pedidos",
    ],
    [
      "Itens sem saldo",
      stock.filter((s) => s.availableBalance <= 0).length,
      Warehouse,
      "/representante/saldo",
    ],
    [
      "Valor dos pedidos",
      cash(
        filtered
          .filter((o) => o.status !== "CANCELLED")
          .reduce((a, o) => a + Number(o.total), 0),
      ),
      BarChart3,
      "/representante/pedidos",
    ],
  ] as const;
  return (
    <>
      <div className="rep-dashboard-filters">
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="ALL">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company || c.name}
            </option>
          ))}
        </select>
        <label>
          De
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Mais recentes</option>
          <option value="high">Maior valor</option>
          <option value="low">Menor valor</option>
        </select>
      </div>
      <div className="rep-cards">
        {cards.map(([label, value, Icon, path]) => (
          <button key={label} onClick={() => navigate(path)}>
            <Icon />
            <small>{label}</small>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <section className="rep-panel">
        <h2>Pedidos do período</h2>
        {filtered.slice(0, 6).map((o) => (
          <button
            className="rep-order-row"
            key={o.id}
            onClick={() =>
              navigate(`/representante/pedidos/${orderNo(o.orderNumber)}`)
            }
          >
            <b>{orderNo(o.orderNumber)}</b>
            <span>{String(o.clientSnapshot?.company || "Sem cliente")}</span>
            <em className={`order-status ${o.status.toLowerCase()}`}>
              {labels[o.status]}
            </em>
            <strong>{cash(o.total)}</strong>
          </button>
        ))}
        {!filtered.length && <p>Nenhum pedido encontrado com esses filtros.</p>}
      </section>
      {(expiring.length > 0 || stock.some((s) => s.availableBalance <= 0)) && (
        <section className="rep-panel">
          <h2>Alertas</h2>
          {expiring.map((o) => (
            <p key={o.id}>
              Pedido {orderNo(o.orderNumber)} expira em {countdown(o.expiresAt)}
              .
            </p>
          ))}
          {stock
            .filter((s) => s.availableBalance <= 0)
            .slice(0, 10)
            .map((s) => (
              <p key={s.productId}>
                {s.productCode} - {s.productName}: sem saldo disponível.
              </p>
            ))}
        </section>
      )}
    </>
  );
}
function countdown(value: string) {
  const ms = Math.max(0, new Date(value).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function StockPage({ rows }: { rows: SalesStock[] }) {
  const [q, setQ] = useState("");
  const filtered = rows.filter((r) =>
    `${r.productCode} ${r.productName}`.toLowerCase().includes(q.toLowerCase()),
  );
  const download = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const excel = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Saldo disponível");
    sheet.columns = [
      { header: "Código", key: "code", width: 18 },
      { header: "Produto", key: "name", width: 55 },
      { header: "Saldo disponível", key: "available", width: 18 },
      { header: "Preço", key: "price", width: 16 },
    ];
    filtered.forEach((r) =>
      sheet.addRow({
        code: r.productCode,
        name: r.productName,
        available: r.availableBalance,
        price: r.listPrice,
      }),
    );
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF021126" },
    };
    const buffer = await book.xlsx.writeBuffer();
    download(
      new File([buffer], "saldo-disponivel-briland.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  };
  return (
    <section className="rep-panel">
      <div className="rep-toolbar">
        <label>
          <Search />
          <input
            placeholder="Buscar produto ou código"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button onClick={() => void excel()}>
          <FileSpreadsheet />
          Excel
        </button>
        <button onClick={() => void stockPdfFile(filtered).then(download)}>
          <Download />
          PDF
        </button>
      </div>
      <div className="rep-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>Saldo disponível</th>
              <th>Preço</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.productId}>
                <td>
                  <b>{r.productCode}</b>
                </td>
                <td>{r.productName}</td>
                <td className={r.availableBalance <= 0 ? "danger" : "good"}>
                  {r.availableBalance}
                </td>
                <td>{r.listPrice == null ? "-" : cash(r.listPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const blankClient = {
  name: "",
  company: "",
  cnpj: "",
  stateRegistration: "",
  address: "",
  zipCode: "",
  neighborhood: "",
  city: "",
  state: "",
  email: "",
  phone: "",
};
function ClientsPage({
  clients,
  reload,
}: {
  clients: UserProfile[];
  reload: () => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const filtered = clients.filter((c) =>
    `${c.company} ${c.name} ${c.cnpj} ${c.stateRegistration} ${c.email}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <section className="rep-panel">
      <div className="rep-toolbar">
        <label>
          <Search />
          <input
            placeholder="Buscar cliente"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus />
          Novo cliente
        </button>
      </div>
      <div className="rep-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Razão social</th>
              <th>CNPJ</th>
              <th>Inscrição estadual</th>
              <th>Responsável</th>
              <th>Cidade/UF</th>
              <th>Contato</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.company}</b>
                </td>
                <td>{maskCnpj(c.cnpj || "")}</td>
                <td>{c.stateRegistration || "-"}</td>
                <td>{c.name}</td>
                <td>
                  {c.city}/{c.state}
                </td>
                <td>
                  {c.email}
                  <br />
                  {maskPhone(c.phone || "")}
                </td>
                <td>
                  <button onClick={() => setEditing(c)}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(creating || editing) && (
        <ClientModal
          client={editing || blankClient}
          creating={creating}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          reload={reload}
        />
      )}
    </section>
  );
}
function ClientModal({
  client,
  creating,
  onClose,
  reload,
}: {
  client: Partial<UserProfile>;
  creating: boolean;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    ...blankClient,
    ...client,
    cnpj: maskCnpj(client.cnpj || ""),
    phone: maskPhone(client.phone || ""),
    zipCode: maskCep(client.zipCode || ""),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { error } = creating
        ? await supabase.rpc("create_representative_client", {
            p_payload: form,
          })
        : await supabase.rpc("update_representative_client", {
            p_client_id: client.id,
            p_payload: form,
          });
      if (error) throw error;
      await reload();
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  const list = [
    ["company", "Razão social"],
    ["cnpj", "CNPJ"],
    ["stateRegistration", "Inscrição estadual"],
    ["name", "Responsável"],
    ["email", "E-mail"],
    ["phone", "Telefone"],
    ["address", "Endereço completo"],
    ["zipCode", "CEP"],
    ["neighborhood", "Bairro"],
    ["city", "Cidade"],
    ["state", "Estado"],
  ] as Array<[keyof typeof blankClient, string]>;
  const change = (key: keyof typeof blankClient, value: string) =>
    setForm({
      ...form,
      [key]:
        key === "cnpj"
          ? maskCnpj(value)
          : key === "phone"
            ? maskPhone(value)
            : key === "zipCode"
              ? maskCep(value)
              : key === "state"
                ? value.toUpperCase().slice(0, 2)
                : value,
    });
  return (
    <div className="rep-modal">
      <div>
        <button className="close" onClick={onClose}>
          <X />
        </button>
        <h2>{creating ? "Cadastrar cliente" : "Editar cliente"}</h2>
        <div className="rep-form-grid">
          {list.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                disabled={!creating && key === "email"}
                inputMode={
                  key === "phone"
                    ? "tel"
                    : ["cnpj", "zipCode"].includes(key)
                      ? "numeric"
                      : undefined
                }
                maxLength={
                  key === "cnpj"
                    ? 18
                    : key === "phone"
                      ? 15
                      : key === "zipCode"
                        ? 9
                        : key === "state"
                          ? 2
                          : undefined
                }
                value={String(form[key] || "")}
                onChange={(e) => change(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        {msg && <p className="rep-error">{msg}</p>}
        <button className="primary" disabled={busy} onClick={() => void save()}>
          <Save />
          {busy ? "Salvando..." : "Salvar cliente"}
        </button>
      </div>
    </div>
  );
}

function OrdersPage({
  orders,
  clients,
  openOrder,
  navigate,
}: {
  orders: SalesOrder[];
  clients: UserProfile[];
  openOrder: () => Promise<void>;
  navigate: (p: string) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [client, setClient] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("recent");
  const filtered = orders
    .filter(
      (o) =>
        (status === "ALL" || o.status === status) &&
        (client === "ALL" || o.clientId === client) &&
        (!from || new Date(o.createdAt) >= new Date(`${from}T00:00:00`)) &&
        (!to || new Date(o.createdAt) <= new Date(`${to}T23:59:59`)) &&
        `${orderNo(o.orderNumber)} ${o.clientSnapshot?.company || ""}`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "high"
        ? Number(b.total) - Number(a.total)
        : sort === "low"
          ? Number(a.total) - Number(b.total)
          : sort === "old"
            ? String(a.createdAt).localeCompare(String(b.createdAt))
            : String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  return (
    <section className="rep-panel">
      <div className="rep-toolbar rep-order-filters">
        <label>
          <Search />
          <input
            placeholder="Número ou cliente"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="ALL">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company || c.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">Todos os status</option>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          aria-label="Data inicial"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          aria-label="Data final"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Mais recentes</option>
          <option value="old">Mais antigos</option>
          <option value="high">Maior valor</option>
          <option value="low">Menor valor</option>
        </select>
        <button className="primary" onClick={() => void openOrder()}>
          <Plus />
          Novo pedido
        </button>
      </div>
      <div className="rep-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Status</th>
              <th>Total</th>
              <th>Atualização</th>
              <th>Expiração</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr
                key={o.id}
                className="clickable"
                onClick={() =>
                  navigate(`/representante/pedidos/${orderNo(o.orderNumber)}`)
                }
              >
                <td>
                  <b>{orderNo(o.orderNumber)}</b>
                </td>
                <td>{String(o.clientSnapshot?.company || "Não definido")}</td>
                <td>
                  <span className={`order-status ${o.status.toLowerCase()}`}>
                    {labels[o.status]}
                  </span>
                </td>
                <td>{cash(o.total)}</td>
                <td>{date(o.updatedAt)}</td>
                <td>{o.status === "DRAFT" ? countdown(o.expiresAt) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <p>Nenhum pedido encontrado com esses filtros.</p>}
    </section>
  );
}

function OrderEditor({
  order,
  clients,
  products,
  stock,
  profile,
  reload,
  navigate,
}: {
  order: SalesOrder;
  clients: UserProfile[];
  products: Product[];
  stock: SalesStock[];
  profile: UserProfile;
  reload: () => Promise<void>;
  navigate: (p: string) => void;
}) {
  const editable = ["DRAFT", "RETURNED"].includes(order.status);
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
  const [items, setItems] = useState<(SalesOrderItem & { id?: string })[]>(
    (order.items || []).sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [productQuery, setProductQuery] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = profile.orderDiscountLimit ?? 15;
  const stockMap = new Map(stock.map((s) => [s.productId, s]));
  const calculate = (item: SalesOrderItem) => {
    const extra = payment === "UPFRONT" ? 5 : 0;
    const manual = Number(item.manualDiscountPercent || 0);
    const effective =
      Math.round(
        (100 - (1 - manual / 100) * (1 - extra / 100) * 100) * 100,
      ) / 100;
    const list = Number(item.listPrice || 0);
    const unit =
      Math.round(list * (1 - manual / 100) * (1 - extra / 100) * 100) / 100;
    return {
      ...item,
      paymentDiscountPercent: extra,
      effectiveDiscountPercent: effective,
      unitPrice: unit,
      lineTotal: unit * Number(item.quantity || 0),
    };
  };
  const calculated = items.map(calculate);
  const totals = calculated.reduce(
    (a, i) => ({
      subtotal: a.subtotal + i.listPrice * i.quantity,
      total: a.total + i.lineTotal,
    }),
    { subtotal: 0, total: 0 },
  );
  const suggestions = products
    .filter(
      (p) =>
        p.preco != null &&
        !items.some((i) => i.productId === p.id) &&
        `${p.codigoInterno} ${p.nome}`
          .toLowerCase()
          .includes(productQuery.toLowerCase()),
    )
    .slice(0, 8);
  const add = (p: Product) => {
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
    setProductQuery("");
  };
  const payload = {
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
      quantity: Number(i.quantity),
      manualDiscountPercent: Number(i.manualDiscountPercent),
    })),
  };
  const persist = async (submit: boolean) => {
    setBusy(true);
    setMsg("");
    try {
      const { data, error } = await supabase.rpc("save_sales_order", {
        ...payload,
        p_submit: submit,
      });
      if (error) throw error;
      const full = { ...(data as SalesOrder), items: calculated };
      await uploadPdf(full);
      await reload();
      setMsg(
        submit ? "Pedido enviado e estoque reservado." : "Rascunho salvo.",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  const action = async (type: string) => {
    const comment =
      type === "CANCEL"
        ? "Cancelado pelo representante."
        : window.prompt("Descreva a alteração necessária:") || "";
    if (!comment) return;
    const rpc =
      type === "CHANGE"
        ? "request_sales_order_change"
        : "transition_sales_order";
    const params =
      type === "CHANGE"
        ? { p_order_id: order.id, p_comment: comment }
        : { p_order_id: order.id, p_action: type, p_comment: comment };
    const { error } = await supabase.rpc(rpc, params);
    if (error) setMsg(error.message);
    else {
      await reload();
      setMsg(
        type === "CHANGE"
          ? "Solicitação enviada ao administrador."
          : "Pedido cancelado.",
      );
    }
  };
  const currentOrderPdf = () =>
    orderPdfFile({
      ...order,
      ...payloadToOrder(payload),
      items: calculated,
      subtotal: totals.subtotal,
      discount: totals.subtotal - totals.total,
      total: totals.total,
    });
  const download = async () => {
    try {
      const file = await currentOrderPdf();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMsg("PDF baixado no dispositivo.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível baixar o PDF.");
    }
  };
  const share = async () => {
    try {
      const file = await currentOrderPdf();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Pedido ${orderNo(order.orderNumber)}`,
          text: "Pedido comercial Briland",
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setMsg(
          "O PDF foi baixado. Este navegador não permite anexar arquivos diretamente ao WhatsApp; anexe o arquivo baixado na conversa desejada.",
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível compartilhar.");
    }
  };
  return (
    <section className="rep-panel">
      <div className="order-heading">
        <button onClick={() => navigate("/representante/pedidos")}>
          <ArrowLeft />
          Voltar
        </button>
        <div>
          <small>PEDIDO</small>
          <h2>{orderNo(order.orderNumber)}</h2>
          <span className={`order-status ${order.status.toLowerCase()}`}>
            {labels[order.status]}
          </span>
        </div>
        <div>
          {order.status === "DRAFT" && (
            <b>Expira em {countdown(order.expiresAt)}</b>
          )}
          <button onClick={() => void share()}>
            <Share2 />
            Compartilhar PDF
          </button>
          <button onClick={() => void download()}>
            <Download />
            Baixar PDF
          </button>
        </div>
      </div>
      <div className="rep-form-grid">
        <label>
          Cliente
          <select
            disabled={!editable}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Selecione</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company} - {c.cnpj}
              </option>
            ))}
          </select>
        </label>
        <label>
          Frete
          <select
            disabled={!editable}
            value={freight}
            onChange={(e) => setFreight(e.target.value as "CIF" | "FOB")}
          >
            <option>CIF</option>
            <option>FOB</option>
          </select>
        </label>
        <label>
          Redespacho
          <input
            disabled={!editable}
            value={redispatchName}
            onChange={(e) => setRedispatchName(e.target.value)}
          />
        </label>
        <label>
          Telefone do redespacho
          <input
            disabled={!editable}
            value={redispatchPhone}
            onChange={(e) => setRedispatchPhone(e.target.value)}
          />
        </label>
        <label>
          Pagamento
          <select
            disabled={!editable}
            value={payment}
            onChange={(e) =>
              setPayment(e.target.value as "UPFRONT" | "INSTALLMENTS")
            }
          >
            <option value="INSTALLMENTS">Parcelado</option>
            <option value="UPFRONT">À vista antecipado (+5%)</option>
          </select>
        </label>
        {payment === "INSTALLMENTS" && (
          <label>
            Prazo
            <input
              disabled={!editable}
              placeholder="Ex.: 30/45/60"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </label>
        )}
      </div>
      {editable && (
        <div className="product-picker">
          <Search />
          <input
            placeholder="Adicionar produto por nome ou código"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
          />
          {productQuery && (
            <div>
              {suggestions.map((p) => (
                <button key={p.id} onClick={() => add(p)}>
                  <b>{p.codigoInterno}</b> {p.nome}{" "}
                  <span>{cash(Number(p.preco))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="rep-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Disponível</th>
              <th>Quantidade</th>
              <th>Tabela</th>
              <th>Desconto</th>
              <th>Unitário</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {calculated.map((item, index) => (
              <tr key={item.productId}>
                <td>
                  <b>{item.productCode}</b>
                  <br />
                  {item.productName}
                </td>
                <td>{stockMap.get(item.productId)?.availableBalance ?? 0}</td>
                <td>
                  <input
                    disabled={!editable}
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      setItems(
                        items.map((v, i) =>
                          i === index
                            ? { ...v, quantity: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </td>
                <td>{cash(item.listPrice)}</td>
                <td>
                  <input
                    disabled={!editable}
                    type="number"
                    min="0"
                    max={limit}
                    step="0.01"
                    value={item.manualDiscountPercent}
                    onChange={(e) =>
                      setItems(
                        items.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                manualDiscountPercent: Number(e.target.value),
                              }
                            : v,
                        ),
                      )
                    }
                  />
                  <small>{payment === "UPFRONT" && " + 5% à vista"}</small>
                </td>
                <td>{cash(item.unitPrice)}</td>
                <td>
                  <b>{cash(item.lineTotal)}</b>
                </td>
                <td>
                  {editable && (
                    <button
                      onClick={() =>
                        setItems(items.filter((_, i) => i !== index))
                      }
                    >
                      <X />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="order-notes">
        Observações
        <textarea
          disabled={!editable}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="order-total">
        <span>
          Subtotal <b>{cash(totals.subtotal)}</b>
        </span>
        <span>
          Descontos <b>- {cash(totals.subtotal - totals.total)}</b>
        </span>
        <strong>Total {cash(totals.total)}</strong>
      </div>
      {msg && <p className="rep-message">{msg}</p>}
      <div className="order-actions">
        {editable && (
          <>
            <button disabled={busy} onClick={() => void persist(false)}>
              <Save />
              Salvar
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void persist(true)}
            >
              <Send />
              Salvar e enviar
            </button>
            <button
              className="danger-button"
              onClick={() => void action("CANCEL")}
            >
              Excluir pedido
            </button>
          </>
        )}
        {order.status === "SUBMITTED" && (
          <button onClick={() => void action("CHANGE")}>
            Solicitar alteração
          </button>
        )}
      </div>
      {(order.history || []).length > 0 && (
        <div className="order-history">
          <h3>Histórico</h3>
          {(order.history || [])
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((h) => (
              <p key={h.id}>
                <b>{labels[h.action] || h.action}</b> -{" "}
                {h.actorName || "Sistema"} - {date(h.createdAt)}
                {h.comment && <span>{h.comment}</span>}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
function payloadToOrder(p: Record<string, unknown>) {
  return {
    clientId: p.p_client_id,
    freightType: p.p_freight_type,
    redispatchName: p.p_redispatch_name,
    redispatchPhone: p.p_redispatch_phone,
    paymentType: p.p_payment_type,
    paymentTerms: p.p_payment_terms,
    notes: p.p_notes,
  } as Partial<SalesOrder>;
}
async function uploadPdfFile(orderId: string, file: File) {
  const path = `${orderId}/${file.name}`;
  const { error } = await supabase.storage
    .from("sales-orders")
    .upload(path, file, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage
    .from("sales-orders")
    .createSignedUrl(path, 7 * 24 * 60 * 60);
  if (signError) throw signError;
  return data.signedUrl;
}
async function uploadPdf(order: SalesOrder) {
  const file = await orderPdfFile(order);
  return uploadPdfFile(order.id, file);
}

function MyData({ profile }: { profile: UserProfile }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const change = async () => {
    if (next.length < 8 || next !== confirm) {
      setMsg("A nova senha precisa ter 8 caracteres e coincidir.");
      return;
    }
    const check = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: current,
    });
    if (check.error) {
      setMsg("A senha atual está incorreta.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setMsg(error ? error.message : "Senha alterada com sucesso.");
    if (!error) {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  };
  return (
    <section className="rep-panel">
      <h2>Meus dados</h2>
      <div className="rep-profile">
        <p>
          <small>Nome</small>
          <b>{profile.name}</b>
        </p>
        <p>
          <small>E-mail</small>
          <b>{profile.email}</b>
        </p>
        <p>
          <small>Empresa</small>
          <b>{profile.company || "-"}</b>
        </p>
        <p>
          <small>Telefone</small>
          <b>{profile.phone || "-"}</b>
        </p>
        <p>
          <small>Limite de desconto</small>
          <b>{profile.orderDiscountLimit ?? 15}%</b>
        </p>
      </div>
      <h3>Alterar senha</h3>
      <div className="rep-form-grid">
        <label>
          Senha atual
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Nova senha
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      </div>
      {msg && <p className="rep-message">{msg}</p>}
      <button className="primary" onClick={() => void change()}>
        <Save />
        Alterar senha
      </button>
    </section>
  );
}
