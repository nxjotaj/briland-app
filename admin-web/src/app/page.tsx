"use client";

import { useEffect, useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import {
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  Activity,
  Download,
  Eye,
  FileSpreadsheet,
  ImageIcon,
  LinkIcon,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  Users
} from "lucide-react";
import { supabase, uploadCatalogBlob, uploadCatalogMedia } from "@/lib/supabase";
import { createId, csvEscape, downloadBlob, formatLocalDate, formatLocalDateTime, money, numberOrNull, slugify } from "@/lib/helpers";
import type {
  AboutSettings,
  Aplicacao,
  AppData,
  AppSettings,
  Categoria,
  Lead,
  Marca,
  MediaSettings,
  ModeloVeiculo,
  Montadora,
  Permission,
  Produto,
  ProdutoAplicacao,
  ProdutoModeloVeiculo,
  Role,
  SocialLinks,
  AuditLog,
  CatalogPdfRole,
  TelemetryEvent,
  Usuario
} from "@/lib/types";

type Tab =
  | "Dashboard"
  | "Produtos"
  | "Categorias"
  | "Marcas"
  | "Montadoras"
  | "Aplicações"
  | "Leads"
  | "Usuários"
  | "Permissões"
  | "Diagnóstico"
  | "Catálogo PDF"
  | "Mídia"
  | "Links"
  | "Conteúdo";

const tabs: { id: Tab; icon: React.ElementType }[] = [
  { id: "Dashboard", icon: BarChart3 },
  { id: "Produtos", icon: Boxes },
  { id: "Categorias", icon: Tags },
  { id: "Marcas", icon: ShieldCheck },
  { id: "Montadoras", icon: Building2 },
  { id: "Aplicações", icon: Building2 },
  { id: "Leads", icon: MessageCircle },
  { id: "Usuários", icon: Users },
  { id: "Permissões", icon: Lock },
  { id: "Diagnóstico", icon: Activity },
  { id: "Catálogo PDF", icon: Download },
  { id: "Mídia", icon: ImageIcon },
  { id: "Links", icon: LinkIcon },
  { id: "Conteúdo", icon: Settings }
];

const emptyData: AppData = {
  produtos: [],
  categorias: [],
  marcas: [],
  aplicacoes: [],
  montadoras: [],
  modelosVeiculo: [],
  produtoModelosVeiculo: [],
  usuarios: [],
  leads: [],
  permissoes: [],
  produtoAplicacoes: [],
  settings: {},
  telemetry: [],
  auditLogs: []
};

const userSelectFields = "id,name,company,email,role,status,notes,phone,cnpj,address,city,state,registrationNotes,approvedAt,approvedBy,lastLoginAt,createdAt,updatedAt,authUserId";

const isMaster = (role?: Role | null) => role === "ADMIN_MASTER" || role === "ADMIN";
const isCollaborator = (role?: Role | null) => role === "ADMIN_COLABORADOR";
const canUseAdminWeb = (role?: Role | null) => isMaster(role) || isCollaborator(role);
const visibleTabsFor = (role?: Role | null) => {
  if (isMaster(role)) return tabs;
  return tabs.filter(({ id }) => ["Dashboard", "Produtos", "Categorias", "Marcas", "Montadoras", "Aplicações", "Leads"].includes(id));
};

function leadDepartment(lead: Lead) {
  const source = `${lead.origem || ""} ${lead.mensagem || ""}`.toLowerCase();
  if (source.includes("suporte")) return "Suporte";
  if (source.includes("comercial")) return "Comercial";
  return "Não informado";
}

function leadMessageBody(message?: string | null) {
  return (message || "").replace(/^\[(Comercial|Suporte)\]\s*/i, "").trim();
}

const catalogPdfRoles: CatalogPdfRole[] = ["VISITANTE", "NAO_CLIENTE", "CLIENTE", "REPRESENTANTE"];
const catalogPdfRoleLabel: Record<CatalogPdfRole, string> = {
  VISITANTE: "Visitante",
  NAO_CLIENTE: "Não cliente",
  CLIENTE: "Cliente",
  REPRESENTANTE: "Representante"
};

function permissionAllowed(permission: Permission | undefined, role: CatalogPdfRole) {
  if (!permission) return true;
  if (role === "VISITANTE") return permission.visibleToVisitor;
  if (role === "NAO_CLIENTE") return permission.visibleToNonClient;
  if (role === "CLIENTE") return permission.visibleToClient;
  return permission.visibleToRepresentative;
}

function permissionMapForRole(permissions: Permission[], role: CatalogPdfRole) {
  return Object.fromEntries(permissions.map((permission) => [permission.fieldKey, permissionAllowed(permission, role)]));
}

function canShowField(map: Record<string, boolean>, key: string, fallback = true) {
  return key in map ? Boolean(map[key]) : fallback;
}

async function trackAdminTelemetry(payload: Omit<TelemetryEvent, "id" | "createdAt">) {
  try {
    await supabase.from("AppTelemetryEvent").insert({
      id: createId("tel"),
      ...payload,
      metadata: payload.metadata || {}
    });
  } catch {
    // Diagnostico nunca pode travar o painel.
  }
}

export default function Page() {
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<Usuario | null>(null);
  const [loginError, setLoginError] = useState("");
  const [data, setData] = useState<AppData>(emptyData);
  const [active, setActive] = useState<Tab>("Dashboard");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };

  const loadAdmin = async (token: string, authUserId: string) => {
    const { data: users, error } = await supabase
      .from("User")
      .select(userSelectFields)
      .eq("authUserId", authUserId)
      .limit(1)
      .returns<Usuario[]>();
    if (error) throw error;
    const user = users?.[0];
    if (!user || !canUseAdminWeb(user.role) || user.status !== "ACTIVE") {
      await supabase.auth.signOut();
      throw new Error("Acesso permitido somente para administradores ativos.");
    }
    setSessionToken(token);
    setAdminUser(user);
    await reload(user.role);
  };

  const reload = async (roleOverride = adminUser?.role) => {
    setLoading(true);
    const startedAt = performance.now();
    try {
      const master = isMaster(roleOverride);
      const [
        produtos,
        categorias,
        marcas,
        montadoras,
        modelosVeiculo,
        produtoModelosVeiculo,
        aplicacoes,
        leads,
        produtoAplicacoes,
        settings,
        usuarios,
        permissoes,
        telemetry,
        auditLogs
      ] = await Promise.all([
        supabase.from("Produto").select("*").order("ordem", { ascending: true }).order("nome").returns<Produto[]>(),
        supabase.from("Categoria").select("*").order("ordem", { ascending: true }).returns<Categoria[]>(),
        supabase.from("Marca").select("*").order("nome").returns<Marca[]>(),
        supabase.from("Montadora").select("*").order("nome").returns<Montadora[]>(),
        supabase.from("ModeloVeiculo").select("*").order("nome").returns<ModeloVeiculo[]>(),
        supabase.from("ProdutoModeloVeiculo").select("*").returns<ProdutoModeloVeiculo[]>(),
        supabase.from("Aplicacao").select("*").order("nome").returns<Aplicacao[]>(),
        supabase.from("LeadOrcamento").select("*").order("createdAt", { ascending: false }).limit(300).returns<Lead[]>(),
        supabase.from("ProdutoAplicacao").select("*").returns<ProdutoAplicacao[]>(),
        supabase.rpc("get_app_settings"),
        master ? supabase.from("User").select(userSelectFields).order("name").returns<Usuario[]>() : Promise.resolve({ data: [], error: null }),
        master ? supabase.from("ProductFieldPermission").select("*").order("fieldLabel").returns<Permission[]>() : Promise.resolve({ data: [], error: null }),
        master ? supabase.from("AppTelemetryEvent").select("*").order("createdAt", { ascending: false }).limit(1000).returns<TelemetryEvent[]>() : Promise.resolve({ data: [], error: null }),
        master ? supabase.from("AuditLog").select("*").order("createdAt", { ascending: false }).limit(500).returns<AuditLog[]>() : Promise.resolve({ data: [], error: null })
      ]);

      const firstError = [produtos, categorias, marcas, montadoras, modelosVeiculo, produtoModelosVeiculo, aplicacoes, usuarios, leads, permissoes, produtoAplicacoes, settings, telemetry, auditLogs].find((item) => item.error);
      if (firstError?.error) throw firstError.error;

      setData({
        produtos: produtos.data || [],
        categorias: categorias.data || [],
        marcas: marcas.data || [],
        montadoras: montadoras.data || [],
        modelosVeiculo: modelosVeiculo.data || [],
        produtoModelosVeiculo: produtoModelosVeiculo.data || [],
        aplicacoes: aplicacoes.data || [],
        usuarios: usuarios.data || [],
        leads: leads.data || [],
        permissoes: permissoes.data || [],
        produtoAplicacoes: produtoAplicacoes.data || [],
        settings: (settings.data as AppSettings | null) || {},
        telemetry: telemetry.data || [],
        auditLogs: auditLogs.data || []
      });
      void trackAdminTelemetry({
        eventType: "load_time",
        screen: "admin-web",
        route: String(active),
        userId: adminUser?.id || null,
        userRole: roleOverride || null,
        durationMs: Math.round(performance.now() - startedAt),
        success: true,
        metadata: { source: "admin-web", master }
      });
    } catch (error) {
      void trackAdminTelemetry({
        eventType: "api_error",
        screen: "admin-web",
        route: String(active),
        userId: adminUser?.id || null,
        userRole: roleOverride || null,
        durationMs: Math.round(performance.now() - startedAt),
        success: false,
        message: error instanceof Error ? error.message : "Falha ao carregar dados.",
        metadata: { source: "admin-web" }
      });
      notify(error instanceof Error ? error.message : "Falha ao carregar dados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: current }) => {
      try {
        const session = current.session;
        if (session) await loadAdmin(session.access_token, session.user.id);
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Falha ao validar acesso.");
      } finally {
        setAuthLoading(false);
      }
    });
  }, []);

  const login = async (email: string, password: string) => {
    setLoginError("");
    setAuthLoading(true);
    try {
      const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!auth.session) throw new Error("Sessão não criada.");
      await loadAdmin(auth.session.access_token, auth.session.user.id);
      void trackAdminTelemetry({ eventType: "login", screen: "login", route: "admin-web", success: true, message: email, metadata: { source: "admin-web" } });
      notify("Login realizado.");
    } catch (error) {
      void trackAdminTelemetry({ eventType: "login", screen: "login", route: "admin-web", success: false, message: error instanceof Error ? error.message : "Falha de login", metadata: { source: "admin-web", email } });
      setLoginError(error instanceof Error ? error.message : "Não foi possível entrar.");
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSessionToken(null);
    setAdminUser(null);
    setData(emptyData);
  };

  useEffect(() => {
    if (!sessionToken || !adminUser) return;
    const visibleTabs = visibleTabsFor(adminUser.role);
    const canSeeTab = visibleTabs.some((item) => item.id === active);
    const activeTab = canSeeTab ? active : "Dashboard";
    void trackAdminTelemetry({
      eventType: "screen_view",
      screen: String(activeTab),
      route: "admin-web",
      userId: adminUser.id,
      userRole: adminUser.role,
      success: true,
      metadata: { source: "admin-web" }
    });
  }, [active, adminUser, sessionToken]);

  if (authLoading && !sessionToken) return <FullLoader label="Validando acesso administrativo..." />;
  if (!sessionToken || !adminUser) return <LoginScreen onLogin={login} error={loginError} loading={authLoading} />;
  const visibleTabs = visibleTabsFor(adminUser.role);
  const canSeeTab = visibleTabs.some((item) => item.id === active);
  const activeTab = canSeeTab ? active : "Dashboard";

  return (
    <div className="min-h-screen bg-soft text-navy">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col overflow-hidden bg-navy p-5 text-white lg:flex">
        <div className="mb-5 shrink-0 rounded-2xl bg-white/8 p-5">
          <div className="text-3xl font-black tracking-wide">BRILAND</div>
          <div className="mt-2 text-sm text-white/60">Painel administrativo web</div>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {visibleTabs.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setActive(id)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition ${active === id ? "bg-yellow text-navy" : "text-white/78 hover:bg-white/10"}`}>
              <Icon size={18} />
              {id}
            </button>
          ))}
        </nav>
        <div className="mt-5 shrink-0 rounded-2xl border border-white/10 p-4 text-sm text-white/70">
          <div className="font-bold text-white">{adminUser.name}</div>
          <div>{adminUser.email}</div>
          <button onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 font-bold text-white hover:bg-white/10">
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-line bg-white/88 px-5 py-4 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[.25em] text-yellow">Briland Admin</div>
              <h1 className="text-2xl font-black">{active}</h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex h-11 min-w-[280px] items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm shadow-sm">
                <Search size={17} className="text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no painel..." className="w-full bg-transparent outline-none" />
              </label>
              <button onClick={() => void reload()} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-black text-white">
                {loading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}
                Atualizar
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {visibleTabs.map(({ id }) => (
              <button key={id} onClick={() => setActive(id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${active === id ? "bg-yellow text-navy" : "bg-white text-navy"}`}>
                {id}
              </button>
            ))}
          </div>
        </header>

        <section className="p-5 lg:p-8">
          {activeTab === "Dashboard" && <Dashboard data={data} setActive={setActive} role={adminUser.role} />}
          {activeTab === "Produtos" && <Products data={data} query={query} reload={reload} notify={notify} />}
          {activeTab === "Categorias" && <CategoryBrandSection title="Categorias" table="Categoria" imageField="imagem" items={data.categorias} query={query} reload={reload} notify={notify} canDelete={isMaster(adminUser.role)} />}
          {activeTab === "Marcas" && <CategoryBrandSection title="Marcas" table="Marca" imageField="logo" items={data.marcas} query={query} reload={reload} notify={notify} canDelete={isMaster(adminUser.role)} />}
          {activeTab === "Montadoras" && <VehicleSection data={data} query={query} reload={reload} notify={notify} canDelete={isMaster(adminUser.role)} />}
          {activeTab === "Aplicações" && <Applications items={data.aplicacoes} query={query} reload={reload} notify={notify} canDelete={isMaster(adminUser.role)} />}
          {activeTab === "Leads" && <Leads leads={data.leads} products={data.produtos} query={query} reload={reload} notify={notify} />}
          {activeTab === "Usuários" && <UsersSection users={data.usuarios} query={query} reload={reload} notify={notify} adminUser={adminUser} />}
          {activeTab === "Permissões" && <PermissionsSectionV2 permissions={data.permissoes} query={query} reload={reload} notify={notify} />}
          {activeTab === "Diagnóstico" && <Diagnostics data={data} />}
          {activeTab === "Catálogo PDF" && <CatalogPdfSection data={data} reload={reload} notify={notify} />}
          {activeTab === "Mídia" && <MediaSettingsSection settings={data.settings.media} reload={reload} notify={notify} />}
          {activeTab === "Links" && <LinksSection settings={data.settings.socialLinks} reload={reload} notify={notify} />}
          {activeTab === "Conteúdo" && <ContentSection settings={data.settings.about} reload={reload} notify={notify} />}
        </section>
      </main>

      {toast && <div className="fixed bottom-5 right-5 z-50 rounded-2xl bg-navy px-5 py-4 text-sm font-bold text-white shadow-soft">{toast}</div>}
    </div>
  );
}

function FullLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy text-white">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 animate-spin text-yellow" size={34} />
        <div className="font-bold">{label}</div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, error, loading }: { onLogin: (email: string, password: string) => void; error: string; loading: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="grid min-h-screen bg-navy lg:grid-cols-[1fr_520px]">
      <div className="hidden items-center justify-center p-12 lg:flex">
        <div className="max-w-xl">
          <div className="text-6xl font-black tracking-wide text-white">BRILAND</div>
          <p className="mt-6 text-2xl font-bold text-white/76">Painel web para gerenciar catálogo, mídia, leads e permissões do app em tempo real pelo Supabase.</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onLogin(email, password);
        }}
        className="flex min-h-screen flex-col justify-center bg-white px-8 py-12"
      >
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            <div className="text-sm font-black uppercase tracking-[.24em] text-yellow">Admin Briland</div>
            <h1 className="mt-3 text-3xl font-black text-navy">Entrar no painel</h1>
            <p className="mt-2 text-sm text-muted">Acesso restrito a usuários ADMIN ativos.</p>
          </div>
          <Field label="E-mail"><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required className="input" /></Field>
          <Field label="Senha"><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required className="input" /></Field>
          {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
          <button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-yellow font-black text-navy disabled:opacity-60">
            {loading && <Loader2 className="animate-spin" size={18} />}
            Entrar
          </button>
        </div>
      </form>
    </div>
  );
}

function Dashboard({ data, setActive, role }: { data: AppData; setActive: (tab: Tab) => void; role: Role }) {
  const cards = [
    { label: "Produtos", value: String(data.produtos.length), tab: "Produtos", icon: Boxes },
    { label: "Ativos", value: String(data.produtos.filter((item) => item.ativo !== false).length), tab: "Produtos", icon: CheckCircle2 },
    { label: "Sem imagem", value: String(data.produtos.filter((item) => !item.imagemPrincipal).length), tab: "Produtos", icon: ImageIcon },
    { label: "Leads", value: String(data.leads.length), tab: "Leads", icon: MessageCircle },
    { label: "Usuários", value: String(data.usuarios.length), tab: "Usuários", icon: Users, masterOnly: true },
    { label: "Permissões", value: String(data.permissoes.length), tab: "Permissões", icon: Lock, masterOnly: true },
    { label: "Erros 24h", value: String(data.telemetry.filter((item) => item.success === false && Date.parse(item.createdAt || "") > Date.now() - 86400000).length), tab: "Diagnóstico", icon: Activity, masterOnly: true }
  ].filter((item) => !item.masterOnly || isMaster(role));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, tab, icon: Icon }) => (
          <button key={label} onClick={() => setActive(tab as Tab)} className="rounded-2xl bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <Icon className="text-yellow" />
              <span className="text-3xl font-black">{value}</span>
            </div>
            <div className="mt-4 text-sm font-black text-muted">{label}</div>
          </button>
        ))}
      </div>
      <Panel title="Resumo operacional">
        <div className="grid gap-4 md:grid-cols-3">
          <Summary label="Categorias" value={data.categorias.length} />
          <Summary label="Marcas" value={data.marcas.length} />
          <Summary label="Aplicações" value={data.aplicacoes.length} />
        </div>
      </Panel>
    </div>
  );
}

function Products({ data, query, reload, notify }: { data: AppData; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [editing, setEditing] = useState<Produto | null>(null);
  const lower = query.toLowerCase();
  const products = data.produtos.filter((item) => [item.nome, item.codigoInterno, item.ean, item.ncm].join(" ").toLowerCase().includes(lower));

  const exportProducts = (format: "csv" | "xlsx") => {
    const rows = data.produtos.map((product) => ({
      ...product,
      categoria: data.categorias.find((item) => item.id === product.categoriaId)?.nome || "",
      marca: data.marcas.find((item) => item.id === product.marcaId)?.nome || "",
      montadoraModelo: data.produtoModelosVeiculo
        .filter((item) => item.produtoId === product.id)
        .map((item) => `${data.montadoras.find((brand) => brand.id === item.montadoraId)?.nome || item.montadoraId}:${data.modelosVeiculo.find((model) => model.id === item.modeloId)?.nome || item.modeloId}`)
        .join("|")
    }));
    if (format === "xlsx") {
      const sheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Produtos");
      XLSX.writeFile(workbook, "briland-produtos.xlsx");
      return;
    }
    const headers = Object.keys(rows[0] || { codigoInterno: "", nome: "" });
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","))].join("\n");
    downloadBlob("briland-produtos.csv", csv, "text/csv;charset=utf-8");
  };

  const importProducts = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
    let count = 0;
    for (const row of rows) {
      const codigoInterno = String(row.codigoInterno || row.codigo || row.Codigo || "").trim();
      const nome = String(row.nome || row.Nome || "").trim();
      if (!codigoInterno || !nome) continue;
      const existing = data.produtos.find((item) => item.codigoInterno === codigoInterno);
      const categoriaText = String(row.categoriaId || row.categoria || row.Categoria || "").toLowerCase();
      const marcaText = String(row.marcaId || row.marca || row.Marca || "").toLowerCase();
      const productId = existing?.id || createId("prod");
      const payload = {
        nome,
        slug: String(row.slug || slugify(`${codigoInterno}-${nome}`)),
        codigoInterno,
        categoriaId: data.categorias.find((item) => item.id === categoriaText || item.nome.toLowerCase() === categoriaText)?.id || data.categorias[0]?.id || "",
        marcaId: data.marcas.find((item) => item.id === marcaText || item.nome.toLowerCase() === marcaText)?.id || data.marcas[0]?.id || "",
        descricaoCurta: String(row.descricaoCurta || "") || null,
        descricaoCompleta: String(row.descricaoCompleta || "") || null,
        ean: String(row.ean || "") || null,
        ncm: String(row.ncm || "") || null,
        caixaMaster: String(row.caixaMaster || "") || null,
        ca: String(row.ca || "") || null,
        preco: row.preco ? Number(String(row.preco).replace(",", ".")) : null,
        estoque: row.estoque ? Number(row.estoque) : null,
        ativo: row.ativo == null ? true : !["false", "0", "Não", "nao"].includes(String(row.ativo)),
        destaque: ["true", "1", "Sim", "sim"].includes(String(row.destaque)),
        ordem: row.ordem ? Number(row.ordem) : 0
      };
      const request = existing
        ? supabase.from("Produto").update(payload).eq("id", existing.id)
        : supabase.from("Produto").insert({ id: productId, ...payload, updatedAt: new Date().toISOString() });
      const { error } = await request;
      if (error) throw error;
      const vehicleText = String(row.montadoraModelo || row.MontadoraModelo || "").trim();
      if (vehicleText) {
        const { error: deleteError } = await supabase.from("ProdutoModeloVeiculo").delete().eq("produtoId", productId);
        if (deleteError) throw deleteError;
        const pairs = vehicleText.split("|").map((item) => item.trim()).filter(Boolean);
        for (const pair of pairs) {
          const [brandName, modelName] = pair.split(":").map((item) => item?.trim().toLowerCase());
          if (!brandName || !modelName) continue;
          const brand = data.montadoras.find((item) => item.id.toLowerCase() === brandName || item.nome.toLowerCase() === brandName || item.slug?.toLowerCase() === brandName);
          const model = data.modelosVeiculo.find((item) => item.montadoraId === brand?.id && (item.id.toLowerCase() === modelName || item.nome.toLowerCase() === modelName || item.slug?.toLowerCase() === modelName));
          if (!brand || !model) continue;
          const { error: linkError } = await supabase.from("ProdutoModeloVeiculo").insert({ id: createId("pmv"), produtoId: productId, montadoraId: brand.id, modeloId: model.id, updatedAt: new Date().toISOString() });
          if (linkError) throw linkError;
        }
      }
      count += 1;
    }
    notify(`${count} produtos importados/atualizados.`);
    await reload();
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-3">
        <button onClick={() => setEditing(newProduct(data))} className="btn-yellow"><PackagePlus size={17} /> Criar produto</button>
        <label className="btn-white cursor-pointer"><Upload size={17} /> Importar CSV/XLSX<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => event.target.files?.[0] && void importProducts(event.target.files[0])} /></label>
        <button onClick={() => exportProducts("csv")} className="btn-white"><Download size={17} /> Exportar CSV</button>
        <button onClick={() => exportProducts("xlsx")} className="btn-white"><FileSpreadsheet size={17} /> Exportar XLSX</button>
      </div>
      <Panel title={`${products.length} produtos`}>
        <Table>
          <thead><tr><Th>Imagem</Th><Th>Código</Th><Th>Nome</Th><Th>Categoria</Th><Th>Marca</Th><Th>Preço</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <Td>{product.imagemPrincipal ? <img src={product.imagemPrincipal} alt="" className="h-12 w-16 rounded-lg object-contain" /> : <div className="h-12 w-16 rounded-lg bg-soft" />}</Td>
                <Td className="font-black">{product.codigoInterno}</Td>
                <Td>{product.nome}</Td>
                <Td>{data.categorias.find((item) => item.id === product.categoriaId)?.nome || "-"}</Td>
                <Td>{data.marcas.find((item) => item.id === product.marcaId)?.nome || "-"}</Td>
                <Td>{money(product.preco)}</Td>
                <Td><Toggle checked={product.ativo !== false} onChange={async (checked) => { await updateRow("Produto", product.id, { ativo: checked }, reload, notify); }} /></Td>
                <Td><button onClick={() => setEditing(product)} className="icon-btn"><Pencil size={16} /></button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {editing && <ProductModal product={editing} data={data} onClose={() => setEditing(null)} reload={reload} notify={notify} />}
    </>
  );
}

function ProductModal({ product, data, onClose, reload, notify }: { product: Produto; data: AppData; onClose: () => void; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [draft, setDraft] = useState<Produto>(product);
  const [vehicleLinks, setVehicleLinks] = useState<ProdutoModeloVeiculo[]>(() => data.produtoModelosVeiculo.filter((item) => item.produtoId === product.id));
  const [saving, setSaving] = useState(false);
  const isNew = !data.produtos.some((item) => item.id === product.id);
  const extras = draft.imagensExtras || [];
  const set = <K extends keyof Produto>(key: K, value: Produto[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        nome: draft.nome,
        slug: draft.slug || slugify(`${draft.codigoInterno}-${draft.nome}`),
        codigoInterno: draft.codigoInterno || "",
        categoriaId: draft.categoriaId || data.categorias[0]?.id || "",
        marcaId: draft.marcaId || data.marcas[0]?.id || "",
        descricaoCurta: draft.descricaoCurta || null,
        descricaoCompleta: draft.descricaoCompleta || null,
        ean: draft.ean || null,
        ncm: draft.ncm || null,
        caixaMaster: draft.caixaMaster || null,
        imagemPrincipal: draft.imagemPrincipal || null,
        imagensExtras: extras,
        ativo: draft.ativo !== false,
        destaque: Boolean(draft.destaque),
        ordem: Number(draft.ordem || 0),
        observacaoInterna: draft.observacaoInterna || null,
        preco: draft.preco ?? null,
        estoque: draft.estoque ?? null,
        condicaoComercial: draft.condicaoComercial || null,
        prazoEntrega: draft.prazoEntrega || null,
        fichaTecnica: draft.fichaTecnica || null,
        manualPdf: draft.manualPdf || null,
        observacaoComercial: draft.observacaoComercial || null,
        margem: draft.margem ?? null,
        ca: draft.ca || null,
        updatedAt: new Date().toISOString()
      };
      const { error } = isNew ? await supabase.from("Produto").insert({ id: draft.id, ...payload }) : await supabase.from("Produto").update(payload).eq("id", draft.id);
      if (error) throw error;
      const existingLinks = data.produtoModelosVeiculo.filter((item) => item.produtoId === draft.id);
      const currentIds = new Set(vehicleLinks.map((item) => item.id));
      for (const item of existingLinks) {
        if (!currentIds.has(item.id)) {
          const { error: deleteError } = await supabase.from("ProdutoModeloVeiculo").delete().eq("id", item.id);
          if (deleteError) throw deleteError;
        }
      }
      for (const item of vehicleLinks) {
        if (!item.montadoraId || !item.modeloId) continue;
        const linkPayload = {
          produtoId: draft.id,
          montadoraId: item.montadoraId,
          modeloId: item.modeloId,
          observacaoComercial: item.observacaoComercial || null,
          updatedAt: new Date().toISOString()
        };
        const exists = existingLinks.some((current) => current.id === item.id);
        const { error: linkError } = exists
          ? await supabase.from("ProdutoModeloVeiculo").update(linkPayload).eq("id", item.id)
          : await supabase.from("ProdutoModeloVeiculo").insert({ id: item.id, ...linkPayload });
        if (linkError) throw linkError;
      }
      notify("Produto salvo.");
      await reload();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar produto.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Excluir produto?")) return;
    const { error } = await supabase.from("Produto").delete().eq("id", draft.id);
    if (error) notify(error.message);
    else {
      notify("Produto excluído.");
      await reload();
      onClose();
    }
  };

  return (
    <Modal title={isNew ? "Criar produto" : "Editar produto"} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="Código interno"><input className="input" value={draft.codigoInterno || ""} onChange={(event) => set("codigoInterno", event.target.value)} /></Field>
        <Field label="Nome"><input className="input" value={draft.nome || ""} onChange={(event) => set("nome", event.target.value)} /></Field>
        <Field label="Slug"><input className="input" value={draft.slug || ""} onChange={(event) => set("slug", event.target.value)} /></Field>
        <Field label="Categoria"><select className="input" value={draft.categoriaId || ""} onChange={(event) => set("categoriaId", event.target.value)}>{data.categorias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></Field>
        <Field label="Marca"><select className="input" value={draft.marcaId || ""} onChange={(event) => set("marcaId", event.target.value)}>{data.marcas.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></Field>
        <Field label="EAN"><input className="input" value={draft.ean || ""} onChange={(event) => set("ean", event.target.value)} /></Field>
        <Field label="NCM"><input className="input" value={draft.ncm || ""} onChange={(event) => set("ncm", event.target.value)} /></Field>
        <Field label="CA"><input className="input" value={draft.ca || ""} onChange={(event) => set("ca", event.target.value)} /></Field>
        <Field label="Caixa master"><input className="input" value={draft.caixaMaster || ""} onChange={(event) => set("caixaMaster", event.target.value)} /></Field>
        <Field label="Preço"><input className="input" type="number" value={draft.preco ?? ""} onChange={(event) => set("preco", numberOrNull(event.target.value) as number | null)} /></Field>
        <Field label="Estoque"><input className="input" type="number" value={draft.estoque ?? ""} onChange={(event) => set("estoque", numberOrNull(event.target.value) as number | null)} /></Field>
        <Field label="Margem"><input className="input" type="number" value={draft.margem ?? ""} onChange={(event) => set("margem", numberOrNull(event.target.value) as number | null)} /></Field>
        <Field label="Ordem"><input className="input" type="number" value={draft.ordem ?? 0} onChange={(event) => set("ordem", Number(event.target.value || 0))} /></Field>
        <Field label="Condição comercial"><input className="input" value={draft.condicaoComercial || ""} onChange={(event) => set("condicaoComercial", event.target.value)} /></Field>
        <Field label="Prazo de entrega"><input className="input" value={draft.prazoEntrega || ""} onChange={(event) => set("prazoEntrega", event.target.value)} /></Field>
        <Field label="Manual PDF URL"><input className="input" placeholder="Cole o link do PDF. No app aparecerá como download." value={draft.manualPdf || ""} onChange={(event) => set("manualPdf", event.target.value)} /></Field>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Field label="Descrição curta"><textarea className="textarea" value={draft.descricaoCurta || ""} onChange={(event) => set("descricaoCurta", event.target.value)} /></Field>
        <Field label="Descrição completa"><textarea className="textarea" value={draft.descricaoCompleta || ""} onChange={(event) => set("descricaoCompleta", event.target.value)} /></Field>
        <Field label="Ficha técnica"><textarea className="textarea" value={draft.fichaTecnica || ""} onChange={(event) => set("fichaTecnica", event.target.value)} /></Field>
        <Field label="Observação comercial"><textarea className="textarea" value={draft.observacaoComercial || ""} onChange={(event) => set("observacaoComercial", event.target.value)} /></Field>
        <Field label="Observação interna"><textarea className="textarea" value={draft.observacaoInterna || ""} onChange={(event) => set("observacaoInterna", event.target.value)} /></Field>
        <div className="rounded-2xl border border-line p-4">
          <div className="mb-3 font-black">Status</div>
          <label className="mr-6 inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(event) => set("ativo", event.target.checked)} /> Ativo</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.destaque)} onChange={(event) => set("destaque", event.target.checked)} /> Destaque</label>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-line p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-black">Aplicação por Montadora</div>
            <div className="text-xs text-muted">Vincule este produto a uma ou mais montadoras/modelos.</div>
          </div>
          <button className="btn-white" onClick={() => {
            const montadoraId = data.montadoras[0]?.id || "";
            const modeloId = data.modelosVeiculo.find((item) => item.montadoraId === montadoraId)?.id || "";
            setVehicleLinks([...vehicleLinks, { id: createId("pmv"), produtoId: draft.id, montadoraId, modeloId, observacaoComercial: "" }]);
          }}><Plus size={15} /> Adicionar</button>
        </div>
        <div className="space-y-3">
          {vehicleLinks.length === 0 && <div className="rounded-xl bg-soft p-4 text-sm text-muted">Nenhuma aplicação por montadora cadastrada.</div>}
          {vehicleLinks.map((link, index) => {
            const models = data.modelosVeiculo.filter((item) => item.montadoraId === link.montadoraId);
            return (
              <div key={link.id} className="grid gap-3 rounded-xl bg-soft p-3 lg:grid-cols-[1fr_1fr_2fr_auto]">
                <select className="input" value={link.montadoraId} onChange={(event) => {
                  const montadoraId = event.target.value;
                  const modeloId = data.modelosVeiculo.find((item) => item.montadoraId === montadoraId)?.id || "";
                  setVehicleLinks(vehicleLinks.map((item, current) => current === index ? { ...item, montadoraId, modeloId } : item));
                }}>{data.montadoras.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
                <select className="input" value={link.modeloId} onChange={(event) => setVehicleLinks(vehicleLinks.map((item, current) => current === index ? { ...item, modeloId: event.target.value } : item))}>{models.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
                <input className="input" placeholder="Observação comercial" value={link.observacaoComercial || ""} onChange={(event) => setVehicleLinks(vehicleLinks.map((item, current) => current === index ? { ...item, observacaoComercial: event.target.value } : item))} />
                <button className="icon-btn" onClick={() => setVehicleLinks(vehicleLinks.filter((_, current) => current !== index))}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <UploadBox label="Imagem principal" folder="produtos/principal" value={draft.imagemPrincipal || ""} onUploaded={(url) => set("imagemPrincipal", url)} />
        <UploadBox label="Adicionar imagem extra" folder="produtos/extras" onUploaded={(url) => set("imagensExtras", [...extras, url])} />
      </div>
      {extras.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{extras.map((url, index) => <div key={`${url}-${index}`} className="relative h-24 w-28 rounded-xl border border-line bg-white p-2"><img src={url} alt="" className="h-full w-full object-contain" /><button className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white" onClick={() => set("imagensExtras", extras.filter((_, current) => current !== index))}><Trash2 size={13} /></button></div>)}</div>}
      <ModalActions saving={saving} onSave={save} onDelete={!isNew ? remove : undefined} />
    </Modal>
  );
}

function CategoryBrandSection({ title, table, imageField, items, query, reload, notify, canDelete }: { title: string; table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; items: Array<Categoria | Marca>; query: string; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean }) {
  const [editing, setEditing] = useState<Categoria | Marca | null>(null);
  const filtered = items.filter((item) => item.nome.toLowerCase().includes(query.toLowerCase()));
  const create = () => setEditing(table === "Categoria" ? { id: createId("cat"), nome: "Nova categoria", slug: "nova-categoria", ativo: true, ordem: 0 } : { id: createId("marca"), nome: "Nova marca", slug: "nova-marca", ativo: true });
  return (
    <>
      <button onClick={create} className="btn-yellow mb-5"><Plus size={17} /> Criar {title.toLowerCase()}</button>
      <Panel title={`${filtered.length} registros`}>
        <Table>
          <thead><tr><Th>Imagem</Th><Th>Nome</Th><Th>Slug</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{filtered.map((item) => {
            const imageValue = String((item as Record<string, unknown>)[imageField] || "");
            return <tr key={item.id}><Td>{imageValue ? <img src={imageValue} alt="" className="h-12 w-16 rounded-lg object-contain" /> : <div className="h-12 w-16 rounded-lg bg-soft" />}</Td><Td>{item.nome}</Td><Td>{item.slug}</Td><Td><Toggle checked={item.ativo !== false} onChange={(checked) => updateRow(table, item.id, { ativo: checked }, reload, notify)} /></Td><Td><button className="icon-btn" onClick={() => setEditing(item)}><Pencil size={16} /></button></Td></tr>;
          })}</tbody>
        </Table>
      </Panel>
      {editing && <CategoryBrandModal table={table} imageField={imageField} item={editing} reload={reload} notify={notify} canDelete={canDelete} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryBrandModal({ table, imageField, item, reload, notify, canDelete, onClose }: { table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; item: Categoria | Marca; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(item as Record<string, unknown>);
  const [saving, setSaving] = useState(false);
  const isNew = item.id.includes("_");
  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { nome: draft.nome, slug: draft.slug || slugify(String(draft.nome)), ativo: draft.ativo !== false };
      if (table === "Categoria") {
        payload.descricao = draft.descricao || null;
        payload.ordem = Number(draft.ordem || 0);
        payload.imagem = draft.imagem || null;
      } else {
        payload.logo = draft.logo || null;
      }
      const { error } = isNew ? await supabase.from(table).insert({ id: item.id, ...payload }) : await supabase.from(table).update(payload).eq("id", item.id);
      if (error) throw error;
      notify("Registro salvo.");
      await reload();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!confirm("Excluir registro?")) return;
    const { error } = await supabase.from(table).delete().eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Registro excluído.");
      await reload();
      onClose();
    }
  };
  return (
    <Modal title={`Editar ${table}`} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Nome"><input className="input" value={String(draft.nome || "")} onChange={(event) => setDraft({ ...draft, nome: event.target.value })} /></Field>
        <Field label="Slug"><input className="input" value={String(draft.slug || "")} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></Field>
        {table === "Categoria" && <Field label="Ordem"><input className="input" type="number" value={String(draft.ordem ?? 0)} onChange={(event) => setDraft({ ...draft, ordem: Number(event.target.value || 0) })} /></Field>}
        {table === "Categoria" && <Field label="Descrição"><textarea className="textarea" value={String(draft.descricao || "")} onChange={(event) => setDraft({ ...draft, descricao: event.target.value })} /></Field>}
      </div>
      <div className="mt-4"><UploadBox label={imageField === "imagem" ? "Imagem da categoria" : "Logo da marca"} folder={imageField === "imagem" ? "categorias" : "marcas"} value={String(draft[imageField] || "")} onUploaded={(url) => setDraft({ ...draft, [imageField]: url })} /></div>
      <label className="mt-4 inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(event) => setDraft({ ...draft, ativo: event.target.checked })} /> Ativo</label>
      <ModalActions saving={saving} onSave={save} onDelete={!isNew && canDelete ? remove : undefined} />
    </Modal>
  );
}

function VehicleSection({ data, query, reload, notify, canDelete }: { data: AppData; query: string; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean }) {
  const [editingBrand, setEditingBrand] = useState<Montadora | null>(null);
  const [editingModel, setEditingModel] = useState<ModeloVeiculo | null>(null);
  const lower = query.toLowerCase();
  const brands = data.montadoras.filter((item) => [item.nome, item.slug].join(" ").toLowerCase().includes(lower));
  const models = data.modelosVeiculo.filter((item) => [item.nome, item.slug, data.montadoras.find((brand) => brand.id === item.montadoraId)?.nome].join(" ").toLowerCase().includes(lower));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setEditingBrand({ id: createId("mont"), nome: "Nova montadora", slug: "nova-montadora", imagem: "", ativo: true })} className="btn-yellow"><Plus size={17} /> Criar montadora</button>
        <button onClick={() => setEditingModel({ id: createId("modelo"), nome: "Novo modelo", slug: "novo-modelo", montadoraId: data.montadoras[0]?.id || "", ativo: true })} className="btn-white"><Plus size={17} /> Criar modelo</button>
      </div>
      <Panel title={`${brands.length} montadoras`}>
        <Table><thead><tr><Th>Imagem</Th><Th>Nome</Th><Th>Slug</Th><Th>Status</Th><Th>Modelos</Th><Th /></tr></thead><tbody>{brands.map((brand) => <tr key={brand.id}><Td>{brand.imagem ? <img src={brand.imagem} alt="" className="h-12 w-12 rounded-xl object-contain" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-soft"><ImageIcon size={18} /></div>}</Td><Td>{brand.nome}</Td><Td>{brand.slug}</Td><Td><Toggle checked={brand.ativo !== false} onChange={(checked) => updateRow("Montadora", brand.id, { ativo: checked, updatedAt: new Date().toISOString() }, reload, notify)} /></Td><Td>{data.modelosVeiculo.filter((item) => item.montadoraId === brand.id).length}</Td><Td><button className="icon-btn" onClick={() => setEditingBrand(brand)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      <Panel title={`${models.length} modelos`}>
        <Table><thead><tr><Th>Modelo</Th><Th>Montadora</Th><Th>Slug</Th><Th>Status</Th><Th /></tr></thead><tbody>{models.map((model) => <tr key={model.id}><Td>{model.nome}</Td><Td>{data.montadoras.find((brand) => brand.id === model.montadoraId)?.nome || "-"}</Td><Td>{model.slug}</Td><Td><Toggle checked={model.ativo !== false} onChange={(checked) => updateRow("ModeloVeiculo", model.id, { ativo: checked, updatedAt: new Date().toISOString() }, reload, notify)} /></Td><Td><button className="icon-btn" onClick={() => setEditingModel(model)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      {editingBrand && <VehicleBrandModal item={editingBrand} reload={reload} notify={notify} canDelete={canDelete} onClose={() => setEditingBrand(null)} />}
      {editingModel && <VehicleModelModal item={editingModel} brands={data.montadoras} reload={reload} notify={notify} canDelete={canDelete} onClose={() => setEditingModel(null)} />}
    </div>
  );
}

function VehicleBrandModal({ item, reload, notify, canDelete, onClose }: { item: Montadora; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState(item);
  const [uploading, setUploading] = useState(false);
  const isNew = !item.createdAt;
  const save = async () => {
    const payload = { nome: draft.nome, slug: slugify(draft.nome), imagem: draft.imagem || null, ativo: draft.ativo !== false, updatedAt: new Date().toISOString() };
    const { error } = isNew ? await supabase.from("Montadora").insert({ id: draft.id, ...payload }) : await supabase.from("Montadora").update(payload).eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Montadora salva.");
      await reload();
      onClose();
    }
  };
  const uploadImage = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const optimizedFile = await compressIconImage(file);
      const url = await uploadCatalogMedia(optimizedFile, "montadoras");
      setDraft({ ...draft, imagem: url });
      notify("Imagem enviada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao enviar imagem.");
    } finally {
      setUploading(false);
    }
  };
  const remove = async () => {
    if (!confirm("Excluir montadora?")) return;
    const { error } = await supabase.from("Montadora").delete().eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Montadora excluída.");
      await reload();
      onClose();
    }
  };
  return (
    <Modal title="Montadora" onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          <Field label="Nome"><input className="input" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value, slug: slugify(e.target.value) })} /></Field>
          <Field label="Slug automático"><input className="input bg-soft text-muted" value={slugify(draft.nome)} readOnly /></Field>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(e) => setDraft({ ...draft, ativo: e.target.checked })} /> Ativa</label>
        </div>
        <div className="rounded-2xl border border-line bg-soft p-4">
          <div className="mb-3 text-sm font-black text-navy">Imagem do card</div>
          <div className="mb-3 flex h-28 items-center justify-center rounded-xl bg-white">
            {draft.imagem ? <img src={draft.imagem} alt="" className="max-h-24 max-w-24 object-contain" /> : <ImageIcon className="text-muted" size={32} />}
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy px-3 py-2 text-sm font-black text-white">
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            Enviar imagem
            <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0])} />
          </label>
          <p className="mt-2 text-xs text-muted">Recomendado: PNG/WebP quadrado, 256 x 256 px. O app carrega como ícone leve.</p>
        </div>
      </div>
      <ModalActions saving={false} onSave={save} onDelete={!isNew && canDelete ? remove : undefined} />
    </Modal>
  );
}

function VehicleModelModal({ item, brands, reload, notify, canDelete, onClose }: { item: ModeloVeiculo; brands: Montadora[]; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState(item);
  const isNew = !item.createdAt;
  const save = async () => {
    const payload = { nome: draft.nome, slug: slugify(draft.nome), montadoraId: draft.montadoraId || brands[0]?.id || "", ativo: draft.ativo !== false, updatedAt: new Date().toISOString() };
    const { error } = isNew ? await supabase.from("ModeloVeiculo").insert({ id: draft.id, ...payload }) : await supabase.from("ModeloVeiculo").update(payload).eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Modelo salvo.");
      await reload();
      onClose();
    }
  };
  const remove = async () => {
    if (!confirm("Excluir modelo?")) return;
    const { error } = await supabase.from("ModeloVeiculo").delete().eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Modelo excluído.");
      await reload();
      onClose();
    }
  };
  return <Modal title="Modelo de veículo" onClose={onClose}><div className="grid gap-4 lg:grid-cols-3"><Field label="Nome"><input className="input" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value, slug: slugify(e.target.value) })} /></Field><Field label="Slug automático"><input className="input bg-soft text-muted" value={slugify(draft.nome)} readOnly /></Field><Field label="Montadora"><select className="input" value={draft.montadoraId} onChange={(e) => setDraft({ ...draft, montadoraId: e.target.value })}>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nome}</option>)}</select></Field></div><label className="mt-4 inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(e) => setDraft({ ...draft, ativo: e.target.checked })} /> Ativo</label><ModalActions saving={false} onSave={save} onDelete={!isNew && canDelete ? remove : undefined} /></Modal>;
}

function Applications({ items, query, reload, notify, canDelete }: { items: Aplicacao[]; query: string; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean }) {
  const [editing, setEditing] = useState<Aplicacao | null>(null);
  const filtered = items.filter((item) => [item.nome, item.tipo].join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <button onClick={() => setEditing({ id: createId("app"), nome: "Nova aplicação", slug: "nova-aplicacao", tipo: "Geral", ativo: true })} className="btn-yellow mb-5"><Plus size={17} /> Criar aplicação</button>
      <Panel title={`${filtered.length} aplicações`}>
        <Table><thead><tr><Th>Nome</Th><Th>Tipo</Th><Th>Status</Th><Th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><Td>{item.nome}</Td><Td>{item.tipo}</Td><Td><Toggle checked={item.ativo !== false} onChange={(checked) => updateRow("Aplicacao", item.id, { ativo: checked }, reload, notify)} /></Td><Td><button className="icon-btn" onClick={() => setEditing(item)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      {editing && <ApplicationModal item={editing} reload={reload} notify={notify} canDelete={canDelete} onClose={() => setEditing(null)} />}
    </>
  );
}

function ApplicationModal({ item, reload, notify, canDelete, onClose }: { item: Aplicacao; reload: () => Promise<void>; notify: (message: string) => void; canDelete: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState(item);
  const isNew = item.id.includes("_");
  const save = async () => {
    const payload = { nome: draft.nome, slug: draft.slug || slugify(draft.nome), tipo: draft.tipo || null, ativo: draft.ativo !== false };
    const { error } = isNew ? await supabase.from("Aplicacao").insert({ id: draft.id, ...payload }) : await supabase.from("Aplicacao").update(payload).eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Aplicação salva.");
      await reload();
      onClose();
    }
  };
  const remove = async () => {
    if (!confirm("Excluir aplicação?")) return;
    const { error } = await supabase.from("Aplicacao").delete().eq("id", item.id);
    if (error) notify(error.message);
    else {
      notify("Aplicação excluída.");
      await reload();
      onClose();
    }
  };
  return <Modal title="Aplicação" onClose={onClose}><div className="grid gap-4 lg:grid-cols-3"><Field label="Nome"><input className="input" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></Field><Field label="Slug"><input className="input" value={draft.slug || ""} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></Field><Field label="Tipo"><input className="input" value={draft.tipo || ""} onChange={(e) => setDraft({ ...draft, tipo: e.target.value })} /></Field></div><label className="mt-4 inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(e) => setDraft({ ...draft, ativo: e.target.checked })} /> Ativa</label><ModalActions saving={false} onSave={save} onDelete={!isNew && canDelete ? remove : undefined} /></Modal>;
}

function Leads({ leads, products, query, reload, notify }: { leads: Lead[]; products: Produto[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<Lead | null>(null);
  const filtered = leads.filter((lead) => [lead.nome, lead.empresa, lead.email, lead.telefone, lead.mensagem].join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <Panel title={`${filtered.length} leads`}>
        <Table><thead><tr><Th>Nome</Th><Th>Área</Th><Th>Empresa</Th><Th>Produto</Th><Th>Status</Th><Th>Data</Th><Th /></tr></thead><tbody>{filtered.map((lead) => <tr key={lead.id}><Td>{lead.nome}</Td><Td>{leadDepartment(lead)}</Td><Td>{lead.empresa}</Td><Td>{products.find((p) => p.id === lead.produtoId)?.codigoInterno || "-"}</Td><Td><select className="input h-9" value={lead.status || "NOVO"} onChange={async (event) => updateRow("LeadOrcamento", lead.id, { status: event.target.value }, reload, notify)}><option>NOVO</option><option>EM_ATENDIMENTO</option><option>CONCLUIDO</option><option>ARQUIVADO</option></select></Td><Td>{formatLocalDate(lead.createdAt)}</Td><Td><button className="icon-btn" onClick={() => setSelected(lead)}><Eye size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      {selected && <Modal title="Lead recebido" onClose={() => setSelected(null)}><div className="grid gap-3 lg:grid-cols-2"><Info label="Nome" value={selected.nome} /><Info label="Área" value={leadDepartment(selected)} /><Info label="Empresa" value={selected.empresa} /><Info label="Telefone" value={selected.telefone} /><Info label="E-mail" value={selected.email} /><Info label="Cidade/UF" value={`${selected.cidade || "-"} / ${selected.estado || "-"}`} /><Info label="Origem" value={selected.origem} /></div><div className="mt-4 rounded-2xl bg-soft p-4 text-sm leading-6">{leadMessageBody(selected.mensagem) || "Sem mensagem"}</div>{selected.telefone && <a href={`https://wa.me/${selected.telefone.replace(/\D/g, "")}`} target="_blank" className="btn-yellow mt-5 inline-flex"><MessageCircle size={17} /> Abrir WhatsApp</a>}</Modal>}
    </>
  );
}

function UsersSection({ users, query, reload, notify, adminUser }: { users: Usuario[]; query: string; reload: () => Promise<void>; notify: (message: string) => void; adminUser: Usuario }) {
  const [editing, setEditing] = useState<Usuario | null>(null);
  const filtered = users.filter((user) => [user.name, user.email, user.company, user.phone, user.cnpj, user.role, user.status].join(" ").toLowerCase().includes(query.toLowerCase()));
  const pending = users.filter((user) => user.status === "PENDING").length;
  const activeAdmins = users.filter((user) => user.status === "ACTIVE" && (isMaster(user.role) || isCollaborator(user.role))).length;
  return <><div className="mb-5 grid gap-4 md:grid-cols-3"><Summary label="Pendentes" value={pending} /><Summary label="Usuários ativos" value={users.filter((user) => user.status === "ACTIVE").length} /><Summary label="Admins ativos" value={activeAdmins} /></div><Panel title={`${filtered.length} usuários`}><Table><thead><tr><Th>Nome</Th><Th>E-mail</Th><Th>Empresa</Th><Th>Telefone</Th><Th>CNPJ</Th><Th>Role</Th><Th>Status</Th><Th /></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><Td>{user.name}</Td><Td>{user.email}</Td><Td>{user.company}</Td><Td>{user.phone || "-"}</Td><Td>{user.cnpj || "-"}</Td><Td>{user.role}</Td><Td>{user.status}</Td><Td><button className="icon-btn" onClick={() => setEditing(user)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table></Panel>{editing && <UserModal user={editing} reload={reload} notify={notify} adminUser={adminUser} onClose={() => setEditing(null)} />}</>;
}

function UserModal({ user, reload, notify, adminUser, onClose }: { user: Usuario; reload: () => Promise<void>; notify: (message: string) => void; adminUser: Usuario; onClose: () => void }) {
  const [draft, setDraft] = useState(user);
  const save = async () => {
    const approvedAt = draft.status === "ACTIVE" ? (draft.approvedAt || new Date().toISOString()) : draft.approvedAt || null;
    const approvedBy = draft.status === "ACTIVE" ? (draft.approvedBy || adminUser.id) : draft.approvedBy || null;
    const { error } = await supabase.from("User").update({ name: draft.name, company: draft.company || null, email: draft.email, role: draft.role, status: draft.status, phone: draft.phone || null, cnpj: draft.cnpj || null, address: draft.address || null, city: draft.city || null, state: draft.state || null, registrationNotes: draft.registrationNotes || null, notes: draft.notes || null, approvedAt, approvedBy }).eq("id", user.id);
    if (error) notify(error.message);
    else {
      notify("Usuário atualizado.");
      await reload();
      onClose();
    }
  };
  return <Modal title="Editar usuário" onClose={onClose}><div className="grid gap-4 lg:grid-cols-2"><Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="Empresa"><input className="input" value={draft.company || ""} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></Field><Field label="E-mail"><input className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field><Field label="Telefone / WhatsApp"><input className="input" value={draft.phone || ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field><Field label="CNPJ"><input className="input" value={draft.cnpj || ""} onChange={(e) => setDraft({ ...draft, cnpj: e.target.value })} /></Field><Field label="Endereço"><input className="input" value={draft.address || ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></Field><Field label="Cidade"><input className="input" value={draft.city || ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></Field><Field label="UF"><input className="input" value={draft.state || ""} onChange={(e) => setDraft({ ...draft, state: e.target.value })} /></Field><Field label="Role"><select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}><option>ADMIN_MASTER</option><option>ADMIN_COLABORADOR</option><option>NAO_CLIENTE</option><option>CLIENTE</option><option>REPRESENTANTE</option></select></Field><Field label="Status"><select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Usuario["status"] })}><option>PENDING</option><option>ACTIVE</option><option>INACTIVE</option></select></Field><Field label="Observações do cadastro"><textarea className="textarea" value={draft.registrationNotes || ""} onChange={(e) => setDraft({ ...draft, registrationNotes: e.target.value })} /></Field><Field label="Notas internas"><textarea className="textarea" value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field></div><ModalActions saving={false} onSave={save} /></Modal>;
}

function PermissionsSection({ permissions, query, reload, notify }: { permissions: Permission[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const filtered = permissions.filter((item) => [item.fieldKey, item.fieldLabel].join(" ").toLowerCase().includes(query.toLowerCase()));
  const toggle = async (permission: Permission, key: keyof Pick<Permission, "visibleToVisitor" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">) => updateRow("ProductFieldPermission", permission.id, { [key]: !permission[key] }, reload, notify);
  return <Panel title={`${filtered.length} permissões`}><Table><thead><tr><Th>Campo</Th><Th>Visitante</Th><Th>Cliente</Th><Th>Representante</Th><Th>Admin</Th></tr></thead><tbody>{filtered.map((permission) => <tr key={permission.id}><Td><div className="font-black">{permission.fieldLabel}</div><div className="text-xs text-muted">{permission.fieldKey}</div></Td><Td><Toggle checked={permission.visibleToVisitor} onChange={() => toggle(permission, "visibleToVisitor")} /></Td><Td><Toggle checked={permission.visibleToClient} onChange={() => toggle(permission, "visibleToClient")} /></Td><Td><Toggle checked={permission.visibleToRepresentative} onChange={() => toggle(permission, "visibleToRepresentative")} /></Td><Td><Toggle checked={permission.visibleToAdmin} onChange={() => toggle(permission, "visibleToAdmin")} /></Td></tr>)}</tbody></Table></Panel>;
}

function PermissionsSectionV2({ permissions, query, reload, notify }: { permissions: Permission[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const filtered = permissions.filter((item) => [item.fieldKey, item.fieldLabel].join(" ").toLowerCase().includes(query.toLowerCase()));
  const toggle = async (permission: Permission, key: keyof Pick<Permission, "visibleToVisitor" | "visibleToNonClient" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">) => updateRow("ProductFieldPermission", permission.id, { [key]: !permission[key] }, reload, notify);
  return (
    <Panel title={`${filtered.length} permissões`}>
      <Table>
        <thead><tr><Th>Campo</Th><Th>Visitante</Th><Th>Não cliente</Th><Th>Cliente</Th><Th>Representante</Th><Th>Admin</Th></tr></thead>
        <tbody>{filtered.map((permission) => (
          <tr key={permission.id}>
            <Td><div className="font-black">{permission.fieldLabel}</div><div className="text-xs text-muted">{permission.fieldKey}</div></Td>
            <Td><Toggle checked={permission.visibleToVisitor} onChange={() => toggle(permission, "visibleToVisitor")} /></Td>
            <Td><Toggle checked={permission.visibleToNonClient} onChange={() => toggle(permission, "visibleToNonClient")} /></Td>
            <Td><Toggle checked={permission.visibleToClient} onChange={() => toggle(permission, "visibleToClient")} /></Td>
            <Td><Toggle checked={permission.visibleToRepresentative} onChange={() => toggle(permission, "visibleToRepresentative")} /></Td>
            <Td><Toggle checked={permission.visibleToAdmin} onChange={() => toggle(permission, "visibleToAdmin")} /></Td>
          </tr>
        ))}</tbody>
      </Table>
    </Panel>
  );
}

function CatalogPdfSection({ data, reload, notify }: { data: AppData; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [generating, setGenerating] = useState<CatalogPdfRole | "all" | null>(null);
  const settings = data.settings.catalogPdf || {};
  const generate = async (role: CatalogPdfRole) => {
    setGenerating(role);
    try {
      const pdfBytes = await buildCatalogPdf(data, role);
      const blob = new Blob([pdfBytesToArrayBuffer(pdfBytes)], { type: "application/pdf" });
      const path = `catalogo/catalogo-${role.toLowerCase().replace("_", "-")}.pdf`;
      const url = await uploadCatalogBlob(path, blob, "application/pdf");
      await saveSetting("catalogPdf", {
        ...settings,
        [role]: {
          url,
          generatedAt: new Date().toISOString(),
          role,
          productCount: data.produtos.filter((product) => product.ativo !== false).length
        }
      }, reload, notify);
      notify(`PDF ${catalogPdfRoleLabel[role]} gerado.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao gerar PDF.");
    } finally {
      setGenerating(null);
    }
  };
  const generateAll = async () => {
    setGenerating("all");
    try {
      let nextSettings = { ...settings };
      for (const role of catalogPdfRoles) {
        const pdfBytes = await buildCatalogPdf(data, role);
        const blob = new Blob([pdfBytesToArrayBuffer(pdfBytes)], { type: "application/pdf" });
        const path = `catalogo/catalogo-${role.toLowerCase().replace("_", "-")}.pdf`;
        const url = await uploadCatalogBlob(path, blob, "application/pdf");
        nextSettings = {
          ...nextSettings,
          [role]: {
            url,
            generatedAt: new Date().toISOString(),
            role,
            productCount: data.produtos.filter((product) => product.ativo !== false).length
          }
        };
      }
      await saveSetting("catalogPdf", nextSettings, reload, notify);
      notify("PDFs do catálogo gerados.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao gerar PDFs.");
    } finally {
      setGenerating(null);
    }
  };
  return (
    <div className="space-y-6">
      <Panel title="Download PDF do catálogo">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="text-sm leading-6 text-muted">
            O PDF é gerado no painel e salvo no Supabase Storage. O app só exibe o botão e baixa o arquivo conforme a permissão <strong>catalogPdfDownload</strong>, sem pesar o celular do cliente.
          </div>
          <button onClick={() => void generateAll()} disabled={generating != null} className="btn-yellow justify-center">
            {generating === "all" ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />}
            Gerar todos os perfis
          </button>
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        {catalogPdfRoles.map((role) => {
          const entry = settings[role];
          return (
            <Panel key={role} title={catalogPdfRoleLabel[role]}>
              <div className="space-y-3 text-sm">
                <Info label="Última geração" value={entry?.generatedAt ? formatLocalDateTime(entry.generatedAt) : "Nunca gerado"} />
                <Info label="Produtos no PDF" value={entry?.productCount != null ? String(entry.productCount) : "-"} />
                {entry?.url ? <a className="btn-white inline-flex" href={entry.url} target="_blank"><Eye size={17} /> Abrir PDF</a> : <div className="rounded-xl bg-soft p-3 text-muted">Nenhum PDF salvo para este perfil.</div>}
              </div>
              <button onClick={() => void generate(role)} disabled={generating != null} className="btn-yellow mt-5">
                {generating === role ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />}
                Gerar PDF
              </button>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

async function buildCatalogPdf(data: AppData, role: CatalogPdfRole) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const permissions = permissionMapForRole(data.permissoes, role);
  const products = data.produtos.filter((product) => product.ativo !== false);
  const categoryProducts = data.categorias
    .filter((category) => category.ativo !== false)
    .map((category) => ({
      category,
      products: products.filter((product) => product.categoriaId === category.id).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome))
    }))
    .filter((group) => group.products.length > 0);
  const uncategorized = products.filter((product) => !data.categorias.some((category) => category.id === product.categoriaId));
  if (uncategorized.length) categoryProducts.push({ category: { id: "sem-categoria", nome: "Sem categoria", ativo: true }, products: uncategorized });

  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const navy = rgb(0.008, 0.067, 0.149);
  const yellow = rgb(0.988, 0.727, 0);
  const muted = rgb(0.42, 0.44, 0.5);
  const line = rgb(0.9, 0.91, 0.94);

  const addPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
    drawPdfHeader(page, bold, font, role);
  };
  drawPdfHeader(page, bold, font, role);

  for (const group of categoryProducts) {
    if (y < 230) addPage();
    page.drawRectangle({ x: 34, y: y - 72, width: 527, height: 82, color: navy, borderColor: yellow, borderWidth: 1 });
    page.drawText(group.category.nome, { x: 52, y: y - 32, size: 21, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`${group.products.length} produtos`, { x: 52, y: y - 54, size: 10, font, color: rgb(0.86, 0.88, 0.92) });
    if (group.category.imagem) {
      const image = await loadPdfImage(pdf, group.category.imagem, 440, 150).catch(() => null);
      if (image) page.drawImage(image.image, { x: 410, y: y - 66, width: 120, height: 66 });
    }
    y -= 104;

    for (let index = 0; index < group.products.length; index += 2) {
      if (y < 190) addPage();
      const row = group.products.slice(index, index + 2);
      for (let column = 0; column < row.length; column += 1) {
        await drawProductCard(pdf, page, row[column], data, permissions, {
          x: 34 + column * 264,
          y: y - 170,
          width: 250,
          height: 170,
          font,
          bold,
          navy,
          yellow,
          muted,
          line
        });
      }
      y -= 186;
    }
  }
  return pdf.save();
}

function drawPdfHeader(page: ReturnType<PDFDocument["addPage"]>, bold: Awaited<ReturnType<PDFDocument["embedFont"]>>, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, role: CatalogPdfRole) {
  const navy = rgb(0.008, 0.067, 0.149);
  const yellow = rgb(0.988, 0.727, 0);
  page.drawRectangle({ x: 0, y: 802, width: 595.28, height: 39.89, color: navy });
  page.drawText("BRILAND", { x: 34, y: 815, size: 17, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Catálogo de produtos", { x: 126, y: 817, size: 10, font, color: rgb(0.86, 0.88, 0.92) });
  page.drawText(catalogPdfRoleLabel[role], { x: 492, y: 816, size: 10, font: bold, color: yellow });
}

async function drawProductCard(
  pdf: PDFDocument,
  page: ReturnType<PDFDocument["addPage"]>,
  product: Produto,
  data: AppData,
  permissions: Record<string, boolean>,
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    navy: ReturnType<typeof rgb>;
    yellow: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
    line: ReturnType<typeof rgb>;
  }
) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(1, 1, 1), borderColor: box.line, borderWidth: 1 });
  if (product.imagemPrincipal) {
    const image = await loadPdfImage(pdf, product.imagemPrincipal, 330, 210).catch(() => null);
    if (image) page.drawImage(image.image, { x: box.x + 9, y: box.y + 92, width: 82, height: 66 });
  }
  page.drawText(product.codigoInterno || "Sem código", { x: box.x + 100, y: box.y + 142, size: 10, font: box.bold, color: box.navy });
  drawWrappedText(page, product.nome || "Produto", box.x + 100, box.y + 126, 136, 9, box.bold, box.navy, 2);
  const details: string[] = [];
  if (canShowField(permissions, "caixaMaster")) details.push(`Caixa master: ${product.caixaMaster || "A cadastrar"}`);
  if (canShowField(permissions, "ncm")) details.push(`NCM: ${product.ncm || "A cadastrar"}`);
  if (canShowField(permissions, "ean")) details.push(`EAN: ${product.ean || "A cadastrar"}`);
  if (canShowField(permissions, "ca", false)) details.push(`CA: ${product.ca || "A cadastrar"}`);
  if (canShowField(permissions, "fichaTecnica") && product.fichaTecnica) details.push(`Ficha técnica: ${product.fichaTecnica}`);
  if (canShowField(permissions, "aplicacoesVeiculo")) {
    const applications = data.produtoModelosVeiculo.filter((item) => item.produtoId === product.id);
    if (applications.length) {
      details.push(`Montadora/modelo: ${applications.map((item) => {
        const brand = data.montadoras.find((brandItem) => brandItem.id === item.montadoraId)?.nome || "Montadora";
        const model = data.modelosVeiculo.find((modelItem) => modelItem.id === item.modeloId)?.nome || "Modelo";
        return `${brand} ${model}`;
      }).join(", ")}`);
    }
  }
  if (canShowField(permissions, "observacaoComercial") && product.observacaoComercial) details.push(`Obs.: ${product.observacaoComercial}`);
  let cursor = box.y + 82;
  for (const detail of details.slice(0, 8)) {
    cursor = drawWrappedText(page, detail, box.x + 10, cursor, box.width - 20, 7.5, box.font, box.muted, 2) - 5;
    if (cursor < box.y + 10) break;
  }
  page.drawRectangle({ x: box.x, y: box.y + box.height - 4, width: box.width, height: 4, color: box.yellow });
}

function drawWrappedText(page: ReturnType<PDFDocument["addPage"]>, text: string, x: number, y: number, maxWidth: number, size: number, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, color: ReturnType<typeof rgb>, maxLines = 3) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((lineText, index) => page.drawText(lineText, { x, y: y - index * (size + 3), size, font, color }));
  return y - lines.length * (size + 3);
}

async function loadPdfImage(pdf: PDFDocument, url: string, maxWidth: number, maxHeight: number) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Arquivo ignorado porque nao e imagem.");
  }
  const blob = await response.blob();
  if (!blob.type.toLowerCase().startsWith("image/")) {
    throw new Error("Arquivo ignorado porque nao e imagem.");
  }
  const bitmap = await createImageBitmap(blob);
  const ratio = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar imagem do PDF.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const jpegBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  if (!jpegBlob) throw new Error("Não foi possível converter imagem do PDF.");
  const image = await pdf.embedJpg(await jpegBlob.arrayBuffer());
  return { image, width, height };
}

function pdfBytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isImageFile(file: File) {
  return file.type.toLowerCase().startsWith("image/");
}

function isPdfUrl(value?: string) {
  return Boolean(value && /\.pdf($|\?)/i.test(value));
}

function Diagnostics({ data }: { data: AppData }) {
  const [selectedAudit, setSelectedAudit] = useState<AuditLog | null>(null);
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;
  const telemetry24h = data.telemetry.filter((event) => event.createdAt && Date.parse(event.createdAt) >= last24h);
  const errors24h = telemetry24h.filter((event) => event.success === false || event.eventType.includes("error"));
  const failedLogins24h = telemetry24h.filter((event) => event.eventType === "login" && event.success === false);
  const access24h = telemetry24h.filter((event) => event.eventType === "screen_view" || event.eventType === "login");
  const activeAdmins = data.usuarios.filter((user) => user.status === "ACTIVE" && (isMaster(user.role) || isCollaborator(user.role)));
  const legacyAdmins = data.usuarios.filter((user) => user.role === "ADMIN");
  const loadRows = Object.values(data.telemetry.filter((event) => event.eventType === "load_time" && event.durationMs != null).reduce<Record<string, { screen: string; total: number; count: number; max: number }>>((acc, event) => {
    const screen = event.screen || event.route || "Sem tela";
    acc[screen] ||= { screen, total: 0, count: 0, max: 0 };
    acc[screen].total += Number(event.durationMs || 0);
    acc[screen].count += 1;
    acc[screen].max = Math.max(acc[screen].max, Number(event.durationMs || 0));
    return acc;
  }, {})).map((row) => ({ ...row, avg: Math.round(row.total / Math.max(row.count, 1)) })).sort((a, b) => b.avg - a.avg).slice(0, 8);
  const securityScore = Math.max(0, 100 - errors24h.length * 2 - failedLogins24h.length * 5 - Math.max(0, activeAdmins.length - 3) * 6 - legacyAdmins.length * 12);
  const health = securityScore >= 85 && errors24h.length === 0 ? "Tudo saudável" : securityScore >= 70 ? "Atenção leve" : "Revisar agora";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Summary label="Score de segurança" value={securityScore} />
        <Summary label="Acessos 24h" value={access24h.length} />
        <Summary label="Erros 24h" value={errors24h.length} />
        <Summary label="Admins ativos" value={activeAdmins.length} />
      </div>
      <Panel title={`Saúde geral: ${health}`}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Eventos monitorados" value={String(data.telemetry.length)} />
          <Info label="Falhas de login 24h" value={String(failedLogins24h.length)} />
          <Info label="Admins legados" value={String(legacyAdmins.length)} />
          <Info label="Última alteração" value={formatLocalDateTime(data.auditLogs[0]?.createdAt)} />
        </div>
      </Panel>
      <Panel title="Telas mais lentas">
        <Table>
          <thead><tr><Th>Tela</Th><Th>Média</Th><Th>Pior leitura</Th><Th>Eventos</Th></tr></thead>
          <tbody>{loadRows.map((row) => <tr key={row.screen}><Td>{row.screen}</Td><Td>{row.avg} ms</Td><Td>{row.max} ms</Td><Td>{row.count}</Td></tr>)}</tbody>
        </Table>
      </Panel>
      <Panel title="Últimos erros">
        <Table>
          <thead><tr><Th>Data</Th><Th>Tipo</Th><Th>Tela</Th><Th>Mensagem</Th></tr></thead>
          <tbody>{errors24h.slice(0, 12).map((event) => <tr key={event.id}><Td>{formatLocalDateTime(event.createdAt)}</Td><Td>{event.eventType}</Td><Td>{event.screen || event.route || "-"}</Td><Td>{event.message || "-"}</Td></tr>)}</tbody>
        </Table>
      </Panel>
      <Panel title="Alterações recentes">
        <Table>
          <thead><tr><Th>Data</Th><Th>Admin</Th><Th>Ação</Th><Th>Entidade</Th><Th>ID</Th><Th /></tr></thead>
          <tbody>{data.auditLogs.slice(0, 20).map((log) => <tr key={log.id}><Td>{formatLocalDateTime(log.createdAt)}</Td><Td>{log.actorEmail || log.actorUserId || "-"}</Td><Td>{log.action}</Td><Td>{log.entityType}</Td><Td>{log.entityId || "-"}</Td><Td><button className="icon-btn" onClick={() => setSelectedAudit(log)}><Eye size={16} /></button></Td></tr>)}</tbody>
        </Table>
      </Panel>
      {selectedAudit && <AuditDetailModal log={selectedAudit} onClose={() => setSelectedAudit(null)} />}
    </div>
  );
}

function AuditDetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const before = (log.metadata?.before || null) as Record<string, unknown> | null;
  const after = (log.metadata?.after || null) as Record<string, unknown> | null;
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null));
  return (
    <Modal title="Detalhe da alteração" onClose={onClose}>
      <div className="grid gap-3 lg:grid-cols-4">
        <Info label="Data" value={formatLocalDateTime(log.createdAt)} />
        <Info label="Admin" value={log.actorEmail || log.actorUserId || "-"} />
        <Info label="Ação" value={log.action} />
        <Info label="Entidade" value={`${log.entityType} / ${log.entityId || "-"}`} />
      </div>
      <Panel title={`${keys.length} campos alterados`}>
        <Table>
          <thead><tr><Th>Campo</Th><Th>Antes</Th><Th>Depois</Th></tr></thead>
          <tbody>{keys.map((key) => <tr key={key}><Td className="font-black">{key}</Td><Td><pre className="whitespace-pre-wrap text-xs">{formatAuditValue(before?.[key])}</pre></Td><Td><pre className="whitespace-pre-wrap text-xs">{formatAuditValue(after?.[key])}</pre></Td></tr>)}</tbody>
        </Table>
      </Panel>
    </Modal>
  );
}

function formatAuditValue(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function MediaSettingsSection({ settings, reload, notify }: { settings?: MediaSettings & { recommendations?: Record<string, string> }; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [draft, setDraft] = useState<MediaSettings>({ initialImage: settings?.initialImage || "", homeImage: settings?.homeImage || "" });
  useEffect(() => setDraft({ initialImage: settings?.initialImage || "", homeImage: settings?.homeImage || "" }), [settings?.initialImage, settings?.homeImage]);
  return <SettingsPanel title="Mídia do app" onSave={async () => saveSetting("media", draft, reload, notify)}><UploadBox label="Imagem inicial - recomendado 1080 x 1920 px" folder="app/inicial" value={draft.initialImage} onUploaded={(url) => setDraft({ ...draft, initialImage: url })} /><UploadBox label="Imagem da home - recomendado 1200 x 760 px" folder="app/home" value={draft.homeImage} onUploaded={(url) => setDraft({ ...draft, homeImage: url })} /></SettingsPanel>;
}

function LinksSection({ settings, reload, notify }: { settings?: SocialLinks; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [draft, setDraft] = useState<SocialLinks>(settings || { instagram: "", linkedin: "", whatsapp: "", site: "" });
  useEffect(() => settings && setDraft(settings), [settings]);
  return <SettingsPanel title="Links sociais" onSave={() => saveSetting("socialLinks", draft, reload, notify)}><div className="grid gap-4 lg:grid-cols-2">{(["instagram", "linkedin", "whatsapp", "site"] as const).map((key) => <Field key={key} label={key}><input className="input" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}</div></SettingsPanel>;
}

function ContentSection({ settings, reload, notify }: { settings?: AboutSettings; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [draft, setDraft] = useState<AboutSettings>(settings || { title: "Sobre a Briland", subtitle: "", body: "" });
  useEffect(() => settings && setDraft(settings), [settings]);
  return <SettingsPanel title="Conteúdo institucional" onSave={() => saveSetting("about", draft, reload, notify)}><div className="grid gap-4"><Field label="Título"><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field><Field label="Subtítulo"><input className="input" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></Field><Field label="Texto"><textarea className="textarea min-h-52" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field></div></SettingsPanel>;
}

async function saveSetting(key: string, value: unknown, reload: () => Promise<void>, notify: (message: string) => void) {
  const { error } = await supabase.rpc("save_app_setting", { setting_key: key, setting_value: value });
  if (error) notify(error.message);
  else {
    notify("Configuração salva.");
    await reload();
  }
}

async function updateRow(table: string, id: string, payload: Record<string, unknown>, reload: () => Promise<void>, notify: (message: string) => void) {
  const { error } = await supabase.from(table).update(payload).eq("id", id);
  if (error) notify(error.message);
  else {
    notify("Registro atualizado.");
    await reload();
  }
}

async function compressIconImage(file: File, maxSize = 256, quality = 0.78) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") || "montadora";
  return new File([blob], `${name}.webp`, { type: "image/webp" });
}

function newProduct(data: AppData): Produto {
  return {
    id: createId("prod"),
    nome: "Novo produto",
    slug: "novo-produto",
    codigoInterno: "",
    categoriaId: data.categorias[0]?.id || "",
    marcaId: data.marcas[0]?.id || "",
    ativo: true,
    destaque: false,
    ordem: 0,
    imagensExtras: []
  };
}

function UploadBox({ label, folder, value, onUploaded }: { label: string; folder: string; value?: string; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (!isImageFile(file)) {
      alert("Este campo aceita apenas imagens. PDF deve ser cadastrado somente como link no campo Manual PDF URL.");
      return;
    }
    setUploading(true);
    try {
      onUploaded(await uploadCatalogMedia(file, folder));
    } finally {
      setUploading(false);
    }
  };
  return <div className="rounded-2xl border border-line bg-white p-4"><div className="mb-3 text-sm font-black">{label}</div>{value && !isPdfUrl(value) ? <img src={value} alt="" className="mb-3 h-36 w-full rounded-xl bg-soft object-contain" /> : <div className="mb-3 flex h-36 items-center justify-center rounded-xl bg-soft text-sm text-muted">{value ? "Arquivo atual nao e imagem" : "Sem imagem"}</div>}<label className="btn-white inline-flex cursor-pointer">{uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Enviar imagem<input className="hidden" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label></div>;
}

function SettingsPanel({ title, children, onSave }: { title: string; children: React.ReactNode; onSave: () => void | Promise<void> }) {
  return <Panel title={title}><div className="space-y-5">{children}</div><button onClick={() => void onSave()} className="btn-yellow mt-6"><Save size={17} /> Salvar</button></Panel>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end bg-navy/55 p-0 lg:items-center lg:justify-center lg:p-8"><div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-soft lg:max-w-6xl lg:rounded-3xl lg:p-7"><div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-black">{title}</h2><button onClick={onClose} className="rounded-full bg-soft px-4 py-2 text-sm font-black">Fechar</button></div>{children}</div></div>;
}

function ModalActions({ saving, onSave, onDelete }: { saving: boolean; onSave: () => void | Promise<void>; onDelete?: () => void | Promise<void> }) {
  return <div className="mt-6 flex flex-wrap justify-end gap-3">{onDelete && <button onClick={() => void onDelete()} className="btn-danger"><Trash2 size={17} /> Excluir</button>}<button onClick={() => void onSave()} className="btn-yellow">{saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Salvar</button></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl bg-white p-5 shadow-soft"><h2 className="mb-5 text-lg font-black">{title}</h2>{children}</section>;
}

function Table({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">{children}</table></div>;
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="border-b border-line px-3 py-3 text-left text-xs font-black uppercase tracking-wide text-muted">{children}</th>;
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-b border-line px-3 py-3 align-middle ${className}`}>{children}</td>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs font-black uppercase tracking-wide text-muted">{label}</span>{children}</label>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void | Promise<void> }) {
  return <button onClick={() => void onChange(!checked)} className={`h-7 w-12 rounded-full p-1 transition ${checked ? "bg-yellow" : "bg-slate-200"}`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : ""}`} /></button>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-soft p-4"><div className="text-2xl font-black">{value}</div><div className="text-sm font-bold text-muted">{label}</div></div>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-xl bg-soft p-3"><div className="text-xs font-black uppercase text-muted">{label}</div><div className="mt-1 font-bold">{value || "-"}</div></div>;
}
