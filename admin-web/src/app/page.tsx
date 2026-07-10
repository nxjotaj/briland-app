"use client";

import { useEffect, useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import {
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  Activity,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  ImageIcon,
  LinkIcon,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Menu,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  Upload,
  Users
} from "lucide-react";
import { supabase, uploadCatalogBlob, uploadCatalogMedia } from "@/lib/supabase";
import { createId, csvEscape, downloadBlob, formatLocalDate, formatLocalDateTime, money, numberOrNull, slugify } from "@/lib/helpers";
import type {
  AboutSettings,
  CatalogAppearance,
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
  | "Conteúdo"
  | "Aparência";

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
  { id: "Conteúdo", icon: Settings },
  { id: "Aparência", icon: Settings }
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

function normalizeImportKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function importValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeImportKey);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeImportKey(key))) return String(value ?? "").trim();
  }
  return "";
}

function splitImportList(value: string) {
  return value.split(/[|;,]/).map((item) => item.trim()).filter(Boolean);
}

function parseCsvRows(text: string) {
  const matrix: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) matrix.push(row);
      row = [];
    } else value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) matrix.push(row);
  const [headers = [], ...dataRows] = matrix;
  return dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""])));
}

async function readSpreadsheetRows(file: File): Promise<Record<string, unknown>[]> {
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsvRows(await file.text());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("A planilha não contém nenhuma aba.");
  const headers = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((value) => String(value ?? "").trim());
  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((sheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (sheetRow.values as ExcelJS.CellValue[]).slice(1);
    if (values.some((value) => value != null && String(value).trim())) rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  });
  return rows;
}

async function importProductsFromTemplate(file: File, data: AppData) {
  let rows: Record<string, unknown>[];
  try {
    rows = await readSpreadsheetRows(file);
  } catch {
    throw new Error("Não foi possível abrir o arquivo. Salve a planilha como .xlsx ou .csv e tente novamente.");
  }
  if (!rows.length) throw new Error("A primeira aba da planilha está vazia.");
  const headers = Object.keys(rows[0] || {}).map(normalizeImportKey);
  const requiredHeaders = ["codigointerno", "categoria", "marca", "nome", "ean", "ncm", "caixamaster"];
  const missingHeaders = requiredHeaders.filter((key) => !headers.includes(key));
  if (missingHeaders.length) {
    const labels: Record<string, string> = { codigointerno: "Código interno", categoria: "Categoria", marca: "Marca", nome: "Nome", ean: "EAN", ncm: "NCM", caixamaster: "Caixa Master" };
    throw new Error(`Cabeçalhos ausentes: ${missingHeaders.map((key) => labels[key]).join(", ")}. Não renomeie as colunas do modelo.`);
  }

  const validationErrors: string[] = [];
  const seenCodes = new Map<string, number>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const values = {
      codigo: importValue(row, ["Código interno", "codigoInterno", "codigo"]),
      categoria: importValue(row, ["Categoria", "categoriaId"]),
      marca: importValue(row, ["Marca", "marcaId"]),
      nome: importValue(row, ["Nome", "Descrição do produto", "Nome Descrição do produto"]),
      ncm: importValue(row, ["NCM", "NCM Com os pontos"]),
      caixa: importValue(row, ["Caixa Master", "caixaMaster"])
    };
    if (!Object.values(values).some(Boolean)) return;
    const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => ({ codigo: "Código interno", categoria: "Categoria", marca: "Marca", nome: "Nome", ncm: "NCM", caixa: "Caixa Master" }[key]));
    if (missing.length) validationErrors.push(`Linha ${line}: campos vazios — ${missing.join(", ")}.`);
    const normalizedCode = values.codigo.toLocaleLowerCase("pt-BR");
    if (normalizedCode && seenCodes.has(normalizedCode)) validationErrors.push(`Linha ${line}: Código interno duplicado (também aparece na linha ${seenCodes.get(normalizedCode)}).`);
    else if (normalizedCode) seenCodes.set(normalizedCode, line);
    for (const [label, aliases] of [["Preço", ["Preço", "preco"]], ["Estoque", ["Estoque", "estoque"]]] as const) {
      const value = importValue(row, [...aliases]);
      if (value && numberOrNull(value) == null) validationErrors.push(`Linha ${line}: ${label} deve ser numérico; valor recebido: “${value}”.`);
    }
  });
  if (validationErrors.length) {
    const shown = validationErrors.slice(0, 12);
    throw new Error(`A planilha tem ${validationErrors.length} erro(s):\n${shown.join("\n")}${validationErrors.length > shown.length ? `\n… e mais ${validationErrors.length - shown.length}.` : ""}`);
  }

  const categorias = [...data.categorias];
  const marcas = [...data.marcas];
  const aplicacoes = [...data.aplicacoes];
  const findByNameOrId = <T extends { id: string; nome: string; slug?: string | null }>(items: T[], value: string) => {
    const normalized = normalizeImportKey(value);
    return items.find((item) => normalizeImportKey(item.id) === normalized || normalizeImportKey(item.nome) === normalized || normalizeImportKey(item.slug) === normalized);
  };
  const ensureCategoria = async (nome: string) => {
    const existing = findByNameOrId(categorias, nome);
    if (existing) return existing;
    const created = { id: createId("cat"), nome, slug: slugify(nome), ativo: true, ordem: categorias.length + 1 };
    const { error } = await supabase.from("Categoria").insert(created);
    if (error) throw error;
    categorias.push(created);
    return created;
  };
  const ensureMarca = async (nome: string) => {
    const existing = findByNameOrId(marcas, nome);
    if (existing) return existing;
    const created = { id: createId("marca"), nome, slug: slugify(nome), ativo: true };
    const { error } = await supabase.from("Marca").insert(created);
    if (error) throw error;
    marcas.push(created);
    return created;
  };
  const ensureAplicacao = async (nome: string) => {
    const existing = findByNameOrId(aplicacoes, nome);
    if (existing) return existing;
    const created = { id: createId("apl"), nome, slug: slugify(nome), tipo: null, ativo: true };
    const { error } = await supabase.from("Aplicacao").insert(created);
    if (error) throw error;
    aplicacoes.push(created);
    return created;
  };

  let count = 0;
  for (const row of rows) {
    const codigoInterno = importValue(row, ["Código interno", "codigoInterno", "codigo"]);
    const categoriaText = importValue(row, ["Categoria", "categoriaId"]);
    const marcaText = importValue(row, ["Marca", "marcaId"]);
    const nome = importValue(row, ["Nome", "Descrição do produto", "Nome Descrição do produto"]);
    const ncm = importValue(row, ["NCM", "NCM Com os pontos"]);
    const caixaMaster = importValue(row, ["Caixa Master", "caixaMaster"]);
    if (!codigoInterno && !nome && !categoriaText && !marcaText) continue;
    if (!codigoInterno || !categoriaText || !marcaText || !nome || !ncm || !caixaMaster) {
      throw new Error(`Linha ${count + 2}: preencha Código interno, Categoria, Marca, Nome, NCM e Caixa Master.`);
    }

    const existing = data.produtos.find((item) => item.codigoInterno === codigoInterno);
    const categoria = await ensureCategoria(categoriaText);
    const marca = await ensureMarca(marcaText);
    const productId = existing?.id || createId("prod");
    const payload = {
      nome,
      slug: importValue(row, ["slug"]) || slugify(`${codigoInterno}-${nome}`),
      codigoInterno,
      categoriaId: categoria.id,
      marcaId: marca.id,
      descricaoCurta: importValue(row, ["Descrição curta", "descricaoCurta"]) || null,
      descricaoCompleta: importValue(row, ["Descrição completa", "descricaoCompleta"]) || null,
      ean: importValue(row, ["EAN"]) || null,
      ncm,
      caixaMaster,
      ca: importValue(row, ["CA"]) || null,
      preco: numberOrNull(importValue(row, ["Preço", "preco"])),
      estoque: numberOrNull(importValue(row, ["Estoque", "estoque"])),
      condicaoComercial: importValue(row, ["Condição Comercial", "condicaoComercial"]) || null,
      observacaoComercial: importValue(row, ["Observação Comercial", "observacaoComercial"]) || null,
      ativo: true,
      destaque: false,
      ordem: existing?.ordem ?? 0,
      updatedAt: new Date().toISOString()
    };
    const request = existing
      ? supabase.from("Produto").update(payload).eq("id", existing.id)
      : supabase.from("Produto").insert({ id: productId, ...payload });
    const { error } = await request;
    if (error) throw new Error(`Linha ${count + 2} (${codigoInterno}): não foi possível salvar o produto — ${error.message}`);

    const applicationText = importValue(row, ["Aplicações", "Aplicacao", "Aplicacoes"]);
    if (applicationText) {
      const { error: deleteApplicationError } = await supabase.from("ProdutoAplicacao").delete().eq("produtoId", productId);
      if (deleteApplicationError) throw deleteApplicationError;
      for (const applicationName of splitImportList(applicationText)) {
        const application = await ensureAplicacao(applicationName);
        const { error: applicationError } = await supabase.from("ProdutoAplicacao").insert({ id: createId("pa"), produtoId: productId, aplicacaoId: application.id });
        if (applicationError) throw applicationError;
      }
    }
    count += 1;
  }
  return count;
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
    <div className="admin-shell min-h-screen text-navy">
      {mobileNavOpen && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-navy/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`admin-sidebar fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col overflow-hidden p-5 transition-transform duration-300 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="brand-block mb-6 shrink-0 p-4">
          <div className="flex items-center gap-3">
            <div className="brand-mark">B</div>
            <div><div className="text-xl font-black tracking-[.08em]">BRILAND</div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-muted">Central de gestão</div></div>
          </div>
        </div>
        <div className="mb-3 px-3 text-[10px] font-black uppercase tracking-[.22em] text-muted">Menu principal</div>
        <nav className="admin-nav min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {visibleTabs.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => { setActive(id); setMobileNavOpen(false); }} className={`nav-item ${active === id ? "nav-item-active" : ""}`}>
              <span className="nav-icon"><Icon size={17} /></span><span className="flex-1">{id}</span>{active === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="user-card mt-5 shrink-0 p-3">
          <div className="flex items-center gap-3"><div className="user-avatar">{adminUser.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{adminUser.name}</div><div className="truncate text-xs text-muted">{adminUser.email}</div></div><button aria-label="Sair" onClick={logout} className="icon-btn"><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="lg:pl-[286px]">
        <header className="admin-header sticky top-0 z-20 px-4 py-4 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button aria-label="Abrir menu" onClick={() => setMobileNavOpen(true)} className="icon-btn lg:hidden"><Menu size={19} /></button>
              <div><div className="text-[10px] font-black uppercase tracking-[.24em] text-amber-500">Briland Admin</div><h1 className="text-xl font-black lg:text-2xl">{active}</h1></div>
            </div>
            <div className="flex items-center gap-2 lg:gap-3">
              <label className="search-control hidden h-11 min-w-[280px] items-center gap-2 px-4 text-sm md:flex">
                <Search size={17} className="text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no painel..." className="w-full bg-transparent outline-none" />
              </label>
              <button aria-label="Notificações" className="icon-btn relative"><Bell size={17} /><span className="notification-dot" /></button>
              <button onClick={() => void reload()} className="btn-primary h-11 px-4">{loading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}<span className="hidden sm:inline">Atualizar</span></button>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1600px] p-4 lg:p-8">
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
          {activeTab === "Aparência" && <AppearanceSection draftSettings={data.settings.catalogAppearanceDraft} publishedSettings={data.settings.catalogAppearance} reload={reload} notify={notify} />}
        </section>
      </main>

      {toast && <div className="toast fixed bottom-5 right-5 z-50 px-5 py-4 text-sm font-bold text-white">{toast}</div>}
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
  const activeProducts = data.produtos.filter((item) => item.ativo !== false).length;
  const pendingUsers = data.usuarios.filter((item) => item.status === "PENDING").length;
  const newLeads = data.leads.filter((item) => item.status === "NOVO").length;
  const withImages = data.produtos.filter((item) => item.imagemPrincipal).length;
  const completion = data.produtos.length ? Math.round((withImages / data.produtos.length) * 100) : 0;
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const next = new Date(date); next.setDate(next.getDate() + 1);
    return { label: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""), value: data.leads.filter((lead) => { const time = Date.parse(lead.createdAt || ""); return time >= date.getTime() && time < next.getTime(); }).length };
  });
  const maxLeads = Math.max(1, ...lastSevenDays.map((item) => item.value));
  const topCategories = data.categorias.map((category) => ({ name: category.nome, value: data.produtos.filter((product) => product.categoriaId === category.id).length })).sort((a, b) => b.value - a.value).slice(0, 5);
  const maxCategory = Math.max(1, ...topCategories.map((item) => item.value));
  const cards = [
    { label: "Produtos cadastrados", value: String(data.produtos.length), helper: `${activeProducts} ativos`, tab: "Produtos", icon: Boxes, tone: "blue" },
    { label: "Novos leads", value: String(newLeads), helper: `${data.leads.length} no total`, tab: "Leads", icon: MessageCircle, tone: "yellow" },
    { label: "Usuários pendentes", value: String(pendingUsers), helper: `${data.usuarios.length} cadastrados`, tab: "Usuários", icon: Users, masterOnly: true, tone: "violet" },
    { label: "Catálogo completo", value: `${completion}%`, helper: `${withImages} produtos com foto`, tab: "Produtos", icon: CheckCircle2, tone: "green" }
  ].filter((item) => !item.masterOnly || isMaster(role));
  return (
    <div className="space-y-6">
      <section className="hero-dashboard relative overflow-hidden p-6 lg:p-8">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-black text-navy"><Sparkles size={14} className="text-amber-500" /> Visão geral em tempo real</div><h2 className="max-w-2xl text-3xl font-black leading-tight lg:text-4xl">Tudo que importa para o catálogo, em um só lugar.</h2><p className="mt-3 max-w-xl text-sm font-semibold text-slate-600 lg:text-base">Acompanhe produtos, oportunidades e a saúde operacional da plataforma Briland.</p></div><div className="flex flex-wrap gap-3"><button onClick={() => setActive("Produtos")} className="btn-primary"><Plus size={17} /> Novo produto</button><button onClick={() => setActive("Leads")} className="btn-glass">Ver oportunidades <ArrowUpRight size={16} /></button></div></div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, helper, tab, icon: Icon, tone }) => (
          <button key={label} onClick={() => setActive(tab as Tab)} className="metric-card group text-left">
            <div className={`metric-icon metric-${tone}`}><Icon size={19} /></div><div className="mt-6 flex items-end justify-between"><div><div className="text-3xl font-black tracking-tight">{value}</div><div className="mt-1 text-sm font-black">{label}</div><div className="mt-1 text-xs font-semibold text-muted">{helper}</div></div><ArrowUpRight size={18} className="mb-1 text-slate-300 transition group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-navy" /></div>
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Panel title="Entrada de leads — últimos 7 dias"><div className="chart-bars">{lastSevenDays.map((item) => <div key={item.label} className="chart-column"><div className="chart-value">{item.value}</div><div className="chart-track"><div className="chart-fill" style={{ height: `${Math.max(8, (item.value / maxLeads) * 100)}%` }} /></div><div className="chart-label">{item.label}</div></div>)}</div></Panel>
        <Panel title="Distribuição do catálogo"><div className="space-y-4">{topCategories.length ? topCategories.map((item, index) => <div key={item.name}><div className="mb-2 flex items-center justify-between text-sm"><span className="font-bold">{item.name}</span><span className="font-black">{item.value}</span></div><div className="progress-track"><div className={`progress-fill progress-${index}`} style={{ width: `${(item.value / maxCategory) * 100}%` }} /></div></div>) : <div className="py-10 text-center text-sm text-muted">Sem categorias para exibir.</div>}</div></Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Panel title="Oportunidades recentes"><div className="divide-y divide-line">{data.leads.slice(0, 5).map((lead) => <button key={lead.id} onClick={() => setActive("Leads")} className="flex w-full items-center gap-3 py-3 text-left"><div className="lead-avatar">{lead.nome.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-black">{lead.nome}</div><div className="truncate text-xs text-muted">{lead.empresa || lead.email || "Contato pelo catálogo"}</div></div><span className={`status-pill status-${String(lead.status).toLowerCase()}`}>{lead.status}</span></button>)}{!data.leads.length && <div className="py-10 text-center text-sm text-muted">Nenhum lead recebido.</div>}</div></Panel>
        <Panel title="Pulso operacional"><div className="grid gap-3 sm:grid-cols-2"><Summary label="Categorias" value={data.categorias.length} /><Summary label="Marcas" value={data.marcas.length} /><Summary label="Aplicações" value={data.aplicacoes.length} /><Summary label="Montadoras" value={data.montadoras.length} /></div><div className="mt-5 rounded-2xl bg-navy p-4 text-white"><div className="flex items-center gap-2 text-sm font-black"><Clock3 size={17} className="text-yellow" /> Dados sincronizados</div><p className="mt-2 text-xs text-white/60">As métricas refletem os registros atuais do Supabase.</p></div></Panel>
      </div>
    </div>
  );
}

function Products({ data, query, reload, notify }: { data: AppData; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [editing, setEditing] = useState<Produto | null>(null);
  const lower = query.toLowerCase();
  const products = data.produtos.filter((item) => [item.nome, item.codigoInterno, item.ean, item.ncm].join(" ").toLowerCase().includes(lower));

  const exportProducts = async (format: "csv" | "xlsx") => {
    const rows = data.produtos.map((product) => ({
      ...product,
      categoria: data.categorias.find((item) => item.id === product.categoriaId)?.nome || "",
      marca: data.marcas.find((item) => item.id === product.marcaId)?.nome || "",
      aplicacoes: data.produtoAplicacoes
        .filter((item) => item.produtoId === product.id)
        .map((item) => data.aplicacoes.find((application) => application.id === item.aplicacaoId)?.nome || item.aplicacaoId)
        .filter(Boolean)
        .join("|"),
      montadoraModelo: data.produtoModelosVeiculo
        .filter((item) => item.produtoId === product.id)
        .map((item) => `${data.montadoras.find((brand) => brand.id === item.montadoraId)?.nome || item.montadoraId}:${data.modelosVeiculo.find((model) => model.id === item.modeloId)?.nome || item.modeloId}`)
        .join("|")
    }));
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Produtos");
      const headers = Object.keys(rows[0] || { codigoInterno: "", nome: "" });
      sheet.columns = headers.map((header) => ({ header, key: header, width: 20 }));
      sheet.addRows(rows);
      downloadBlob("briland-produtos.xlsx", await workbook.xlsx.writeBuffer(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return;
    }
    const headers = Object.keys(rows[0] || { codigoInterno: "", nome: "" });
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","))].join("\n");
    downloadBlob("briland-produtos.csv", csv, "text/csv;charset=utf-8");
  };

  const importProducts = async (file: File) => {
    const rows = await readSpreadsheetRows(file);
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

  const importOfficialTemplate = async (file: File) => {
    try {
      const count = await importProductsFromTemplate(file, data);
      notify(`${count} produtos importados/atualizados pelo modelo oficial.`);
      await reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao importar a planilha modelo.";
      notify("Importação não concluída. Veja o relatório aberto na tela.");
      window.alert(`Erro na importação de ${file.name}\n\n${message}\n\nCorrija os itens indicados e envie novamente.`);
      void trackAdminTelemetry({ eventType: "import_error", screen: "Produtos", route: "admin-web", success: false, message, metadata: { fileName: file.name, fileSize: file.size } });
    }
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-3">
        <button onClick={() => setEditing(newProduct(data))} className="btn-yellow"><PackagePlus size={17} /> Criar produto</button>
        <label className="btn-white cursor-pointer"><Upload size={17} /> Importar CSV/XLSX<input type="file" accept=".csv,.xlsx" className="hidden" onChange={(event) => event.target.files?.[0] && void importOfficialTemplate(event.target.files[0])} /></label>
        <button onClick={() => exportProducts("csv")} className="btn-white"><Download size={17} /> Exportar CSV</button>
        <button onClick={() => void exportProducts("xlsx")} className="btn-white"><FileSpreadsheet size={17} /> Exportar XLSX</button>
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
  const [applicationLinks, setApplicationLinks] = useState<ProdutoAplicacao[]>(() => data.produtoAplicacoes.filter((item) => item.produtoId === product.id));
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
      const existingApplicationLinks = data.produtoAplicacoes.filter((item) => item.produtoId === draft.id);
      const currentApplicationIds = new Set(applicationLinks.map((item) => item.id).filter(Boolean));
      for (const item of existingApplicationLinks) {
        if (item.id && !currentApplicationIds.has(item.id)) {
          const { error: deleteError } = await supabase.from("ProdutoAplicacao").delete().eq("id", item.id);
          if (deleteError) throw deleteError;
        }
      }
      for (const item of applicationLinks) {
        if (!item.aplicacaoId) continue;
        const exists = Boolean(item.id && existingApplicationLinks.some((current) => current.id === item.id));
        if (!exists) {
          const { error: applicationError } = await supabase.from("ProdutoAplicacao").insert({ id: item.id || createId("pa"), produtoId: draft.id, aplicacaoId: item.aplicacaoId });
          if (applicationError) throw applicationError;
        }
      }
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
            <div className="font-black">Aplicações</div>
            <div className="text-xs text-muted">Vincule o produto a aplicações comerciais como Linha leve, Linha pesada ou outras.</div>
          </div>
          <button className="btn-white" disabled={data.aplicacoes.length === 0} onClick={() => {
            const aplicacaoId = data.aplicacoes.find((application) => !applicationLinks.some((link) => link.aplicacaoId === application.id))?.id || data.aplicacoes[0]?.id || "";
            if (!aplicacaoId) return;
            setApplicationLinks([...applicationLinks, { id: createId("pa"), produtoId: draft.id, aplicacaoId }]);
          }}><Plus size={15} /> Adicionar</button>
        </div>
        <div className="space-y-3">
          {data.aplicacoes.length === 0 && <div className="rounded-xl bg-soft p-4 text-sm text-muted">Cadastre aplicações na aba Aplicações antes de vincular produtos.</div>}
          {applicationLinks.length === 0 && data.aplicacoes.length > 0 && <div className="rounded-xl bg-soft p-4 text-sm text-muted">Nenhuma aplicação vinculada.</div>}
          {applicationLinks.map((link, index) => (
            <div key={link.id || `${link.aplicacaoId}-${index}`} className="grid gap-3 rounded-xl bg-soft p-3 lg:grid-cols-[1fr_auto]">
              <select className="input" value={link.aplicacaoId || ""} onChange={(event) => setApplicationLinks(applicationLinks.map((item, current) => current === index ? { ...item, aplicacaoId: event.target.value } : item))}>
                {data.aplicacoes.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
              <button className="icon-btn" onClick={() => setApplicationLinks(applicationLinks.filter((_, current) => current !== index))}><Trash2 size={16} /></button>
            </div>
          ))}
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
      <div className="mt-4"><UploadBox label={imageField === "imagem" ? "Imagem da categoria" : "Logo da marca"} folder={imageField === "imagem" ? "categorias" : "marcas"} value={String(draft[imageField] || "")} iconMode={imageField === "imagem"} onUploaded={(url) => setDraft({ ...draft, [imageField]: url })} /></div>
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
  const performanceLimitMs = 1500;
  const criticalLoadLimitMs = 3000;
  const incompleteProducts = data.produtos.filter((product) => !product.codigoInterno || !product.nome || !product.categoriaId || !product.marcaId);
  const productsWithoutImage = data.produtos.filter((product) => product.ativo !== false && !product.imagemPrincipal);
  const orphanVehicleLinks = data.produtoModelosVeiculo.filter((link) => !data.produtos.some((product) => product.id === link.produtoId) || !data.modelosVeiculo.some((model) => model.id === link.modeloId));
  const slowScreens = loadRows.filter((row) => row.avg > performanceLimitMs || row.max > criticalLoadLimitMs);
  const detectedProblems = [
    ...errors24h.slice(0, 20).map((event) => ({ severity: "Erro", area: event.screen || event.route || "Sistema", detail: event.message || event.eventType })),
    ...slowScreens.map((row) => ({ severity: row.max > criticalLoadLimitMs ? "Crítico" : "Alerta", area: row.screen, detail: `Carregamento médio ${row.avg} ms; máximo ${row.max} ms. Padrão: até ${performanceLimitMs} ms.` })),
    ...(incompleteProducts.length ? [{ severity: "Erro", area: "Produtos", detail: `${incompleteProducts.length} produto(s) sem código, nome, categoria ou marca.` }] : []),
    ...(orphanVehicleLinks.length ? [{ severity: "Erro", area: "Vínculos", detail: `${orphanVehicleLinks.length} vínculo(s) de veículo apontam para registros inexistentes.` }] : []),
    ...(productsWithoutImage.length ? [{ severity: "Alerta", area: "Produtos", detail: `${productsWithoutImage.length} produto(s) ativo(s) sem imagem principal.` }] : [])
  ];
  const securityScore = Math.max(0, 100 - errors24h.length * 2 - failedLogins24h.length * 5 - Math.max(0, activeAdmins.length - 3) * 6 - legacyAdmins.length * 12);
  const health = detectedProblems.length === 0 ? "Tudo saudável" : detectedProblems.some((item) => item.severity === "Erro" || item.severity === "Crítico") ? "Revisar agora" : "Atenção";

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
      <Panel title={`Problemas detectados (${detectedProblems.length})`}>
        {detectedProblems.length === 0 ? <div className="text-sm font-bold text-green-700">Nenhum desvio encontrado nos dados e eventos monitorados.</div> : <Table>
          <thead><tr><Th>Nível</Th><Th>Área</Th><Th>Problema / padrão esperado</Th></tr></thead>
          <tbody>{detectedProblems.map((problem, index) => <tr key={`${problem.area}-${index}`}><Td className="font-black">{problem.severity}</Td><Td>{problem.area}</Td><Td>{problem.detail}</Td></tr>)}</tbody>
        </Table>}
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

const defaultCatalogAppearance: CatalogAppearance = {
  version: 1,
  primaryColor: "#021126",
  accentColor: "#FCB900",
  backgroundColor: "#F4F6FA",
  surfaceColor: "#FFFFFF",
  textColor: "#021126",
  fontFamily: "system",
  cardRadius: 12,
  dockOpacity: 72,
  dockHeight: 62,
  dockPosition: "bottom",
  showProductCategory: true,
  showProductBrand: true,
  logoUrl: ""
};

function safeCatalogAppearance(value?: CatalogAppearance): CatalogAppearance {
  const merged = { ...defaultCatalogAppearance, ...(value || {}) };
  const color = (candidate: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : fallback;
  return {
    ...merged,
    version: Math.max(1, Number(merged.version) || 1),
    primaryColor: color(merged.primaryColor, defaultCatalogAppearance.primaryColor),
    accentColor: color(merged.accentColor, defaultCatalogAppearance.accentColor),
    backgroundColor: color(merged.backgroundColor, defaultCatalogAppearance.backgroundColor),
    surfaceColor: color(merged.surfaceColor, defaultCatalogAppearance.surfaceColor),
    textColor: color(merged.textColor, defaultCatalogAppearance.textColor),
    cardRadius: Math.min(32, Math.max(0, Number(merged.cardRadius) || 0)),
    dockOpacity: Math.min(100, Math.max(35, Number(merged.dockOpacity) || 72)),
    dockHeight: Math.min(90, Math.max(52, Number(merged.dockHeight) || 62)),
    fontFamily: ["system", "rounded", "serif"].includes(merged.fontFamily) ? merged.fontFamily : "system",
    dockPosition: merged.dockPosition === "top" ? "top" : "bottom",
    logoUrl: String(merged.logoUrl || "").slice(0, 1000)
  };
}

function AppearanceSection({ draftSettings, publishedSettings, reload, notify }: { draftSettings?: CatalogAppearance; publishedSettings?: CatalogAppearance; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [draft, setDraft] = useState(() => safeCatalogAppearance(draftSettings || publishedSettings));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(safeCatalogAppearance(draftSettings || publishedSettings)), [draftSettings, publishedSettings]);
  const set = <K extends keyof CatalogAppearance>(key: K, value: CatalogAppearance[K]) => setDraft((current) => safeCatalogAppearance({ ...current, [key]: value }));
  const saveDraft = async () => {
    setSaving(true);
    try { await saveSetting("catalogAppearanceDraft", safeCatalogAppearance(draft), reload, notify); } finally { setSaving(false); }
  };
  const publish = async () => {
    if (!window.confirm("Publicar esta aparência no app real? O rascunho atual passará a ser o layout ativo.")) return;
    setSaving(true);
    try {
      const published = { ...safeCatalogAppearance(draft), version: (publishedSettings?.version || 0) + 1, publishedAt: new Date().toISOString() };
      await saveSetting("catalogAppearance", published, reload, notify);
      notify(`Aparência versão ${published.version} publicada no app.`);
    } finally { setSaving(false); }
  };
  const phoneFont = draft.fontFamily === "serif" ? "Georgia, serif" : draft.fontFamily === "rounded" ? "ui-rounded, system-ui" : "system-ui";
  const sample = "BR64211";
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
    <Panel title="Aparência do catálogo — rascunho">
      <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-900">As alterações abaixo aparecem somente na prévia. O app real muda apenas ao clicar em “Publicar no app”.</div>
      <div className="grid gap-4 md:grid-cols-2">
        {([['primaryColor','Cor principal'],['accentColor','Cor de destaque'],['backgroundColor','Fundo'],['surfaceColor','Cards'],['textColor','Texto']] as const).map(([key,label]) => <Field key={key} label={label}><div className="flex gap-2"><input type="color" value={draft[key]} onChange={(e) => set(key, e.target.value)} className="h-11 w-14 rounded-xl border border-line bg-white p-1" /><input className="input" value={draft[key]} onChange={(e) => set(key, e.target.value as CatalogAppearance[typeof key])} /></div></Field>)}
        <Field label="Fonte"><select className="input" value={draft.fontFamily} onChange={(e) => set('fontFamily', e.target.value as CatalogAppearance['fontFamily'])}><option value="system">Sistema</option><option value="rounded">Arredondada</option><option value="serif">Serifada</option></select></Field>
        <Field label={`Raio dos cards: ${draft.cardRadius}px`}><input type="range" min="0" max="32" value={draft.cardRadius} onChange={(e) => set('cardRadius', Number(e.target.value))} className="w-full" /></Field>
        <Field label={`Transparência da ilha: ${draft.dockOpacity}%`}><input type="range" min="35" max="100" value={draft.dockOpacity} onChange={(e) => set('dockOpacity', Number(e.target.value))} className="w-full" /></Field>
        <Field label={`Altura da ilha: ${draft.dockHeight}px`}><input type="range" min="52" max="90" value={draft.dockHeight} onChange={(e) => set('dockHeight', Number(e.target.value))} className="w-full" /></Field>
        <Field label="Posição da ilha"><select className="input" value={draft.dockPosition} onChange={(e) => set('dockPosition', e.target.value as CatalogAppearance['dockPosition'])}><option value="bottom">Inferior</option><option value="top">Superior</option></select></Field>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2"><label className="flex items-center gap-3 rounded-xl bg-soft p-3 font-bold"><input type="checkbox" checked={draft.showProductCategory} onChange={(e) => set('showProductCategory', e.target.checked)} /> Mostrar categoria</label><label className="flex items-center gap-3 rounded-xl bg-soft p-3 font-bold"><input type="checkbox" checked={draft.showProductBrand} onChange={(e) => set('showProductBrand', e.target.checked)} /> Mostrar marca</label></div>
      <div className="mt-5"><UploadBox label="Logo superior personalizado" folder="app/layout" value={draft.logoUrl} onUploaded={(url) => set('logoUrl', url)} /></div>
      <div className="mt-6 flex flex-wrap gap-3"><button disabled={saving} onClick={() => void saveDraft()} className="btn-white"><Save size={17} /> Salvar rascunho</button><button disabled={saving} onClick={() => void publish()} className="btn-yellow"><CheckCircle2 size={17} /> Publicar no app</button><button disabled={saving} onClick={() => setDraft(safeCatalogAppearance(publishedSettings))} className="btn-white">Restaurar publicado</button></div>
      <p className="mt-4 text-xs font-bold text-muted">Publicado: versão {publishedSettings?.version || 0}{publishedSettings?.publishedAt ? ` em ${formatLocalDateTime(publishedSettings.publishedAt)}` : " — layout padrão atual"}.</p>
    </Panel>
    <div className="xl:sticky xl:top-28 xl:self-start"><div className="mb-3 text-center text-sm font-black text-muted">PRÉVIA AO VIVO — IPHONE</div><div className="mx-auto w-[360px] rounded-[54px] bg-[#111] p-[10px] shadow-2xl"><div className="relative h-[720px] overflow-hidden rounded-[44px]" style={{ background: draft.backgroundColor, color: draft.textColor, fontFamily: phoneFont }}><div className="absolute left-1/2 top-2 z-10 h-7 w-28 -translate-x-1/2 rounded-full bg-black" /><div className="flex h-14 items-center justify-between px-7 pt-2 text-xs font-black"><span>09:41</span><span>● ●●</span></div><div className="flex h-20 items-center justify-center" style={{ background: draft.surfaceColor }}>{draft.logoUrl ? <img src={draft.logoUrl} className="h-12 w-40 object-contain" alt="Logo na prévia" /> : <strong className="text-2xl" style={{ color: draft.primaryColor }}>BRILAND</strong>}</div><div className="p-5"><div className="mb-4 flex gap-2"><div className="flex-1 rounded-xl p-3 text-sm" style={{ background: draft.surfaceColor }}>Buscar produtos</div><div className="rounded-xl p-3" style={{ background: draft.accentColor }}>☰</div></div><div className="mb-3 text-sm opacity-60">13 produtos encontrados</div><div className="grid grid-cols-2 gap-3">{[sample,"BR64212"].map((code) => <div key={code} className="overflow-hidden border border-black/5" style={{ background: draft.surfaceColor, borderRadius: draft.cardRadius }}><div className="flex h-28 items-center justify-center" style={{ background: `${draft.primaryColor}10` }}>📦</div><div className="p-3"><strong style={{ color: draft.primaryColor }}>{code}</strong><div className="mt-1 text-xs opacity-70">Lâmpada halógena automotiva</div>{draft.showProductCategory && <div className="mt-3 text-[10px] opacity-55">Lâmpadas{draft.showProductBrand && " • Briland"}</div>}<div className="mt-3 text-xs font-black" style={{ color: draft.accentColor }}>Entrar para ver mais</div></div></div>)}</div></div><div className="absolute left-5 right-5 flex items-center justify-around rounded-full border border-white/50 text-lg shadow-xl" style={{ [draft.dockPosition]: 14, height: draft.dockHeight, background: `rgba(255,255,255,${draft.dockOpacity / 100})` }}>◎ in ◉ ◌</div></div></div></div>
  </div>;
}

async function saveSetting(key: string, value: unknown, reload: () => Promise<void>, notify: (message: string) => void) {
  const { error } = await supabase.rpc("save_app_setting", { setting_key: key, setting_value: value });
  if (error) {
    notify(error.message);
    throw error;
  }
  notify("Configuração salva.");
  await reload();
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

function UploadBox({ label, folder, value, iconMode = false, onUploaded }: { label: string; folder: string; value?: string; iconMode?: boolean; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (!isImageFile(file)) {
      alert("Este campo aceita apenas imagens. PDF deve ser cadastrado somente como link no campo Manual PDF URL.");
      return;
    }
    setUploading(true);
    try {
      const uploadFile = iconMode ? await compressIconImage(file) : file;
      onUploaded(await uploadCatalogMedia(uploadFile, folder));
    } finally {
      setUploading(false);
    }
  };
  return <div className="rounded-2xl border border-line bg-white p-4"><div className="mb-3 text-sm font-black">{label}</div>{value && !isPdfUrl(value) ? <img src={value} alt="" className="mb-3 h-36 w-full rounded-xl bg-soft object-contain" /> : <div className="mb-3 flex h-36 items-center justify-center rounded-xl bg-soft text-sm text-muted">{value ? "Arquivo atual nao e imagem" : "Sem imagem"}</div>}<label className="btn-white inline-flex cursor-pointer">{uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Enviar imagem<input className="hidden" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label>{iconMode && <p className="mt-2 text-xs text-muted">A imagem sera comprimida para 256 x 256 px e usada como icone leve no app.</p>}</div>;
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
  return <section className="panel-card p-5 lg:p-6"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-base font-black lg:text-lg">{title}</h2><button className="panel-more" aria-label={`Mais opções de ${title}`}>•••</button></div>{children}</section>;
}

function Table({ children }: { children: React.ReactNode }) {
  return <div className="table-wrap overflow-x-auto"><table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">{children}</table></div>;
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
  return <div className="summary-card p-4"><div className="text-2xl font-black">{value}</div><div className="mt-1 text-sm font-bold text-muted">{label}</div></div>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div className="rounded-xl bg-soft p-3"><div className="text-xs font-black uppercase text-muted">{label}</div><div className="mt-1 font-bold">{value || "-"}</div></div>;
}
