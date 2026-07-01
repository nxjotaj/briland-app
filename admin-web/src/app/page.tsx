"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
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
import { supabase, uploadCatalogMedia } from "@/lib/supabase";
import { createId, csvEscape, downloadBlob, money, numberOrNull, slugify } from "@/lib/helpers";
import type {
  AboutSettings,
  Aplicacao,
  AppData,
  AppSettings,
  Categoria,
  Lead,
  Marca,
  MediaSettings,
  Permission,
  Produto,
  ProdutoAplicacao,
  Role,
  SocialLinks,
  Usuario
} from "@/lib/types";

type Tab =
  | "Dashboard"
  | "Produtos"
  | "Categorias"
  | "Marcas"
  | "Aplicações"
  | "Leads"
  | "Usuários"
  | "Permissões"
  | "Mídia"
  | "Links"
  | "Conteúdo";

const tabs: { id: Tab; icon: React.ElementType }[] = [
  { id: "Dashboard", icon: BarChart3 },
  { id: "Produtos", icon: Boxes },
  { id: "Categorias", icon: Tags },
  { id: "Marcas", icon: ShieldCheck },
  { id: "Aplicações", icon: Building2 },
  { id: "Leads", icon: MessageCircle },
  { id: "Usuários", icon: Users },
  { id: "Permissões", icon: Lock },
  { id: "Mídia", icon: ImageIcon },
  { id: "Links", icon: LinkIcon },
  { id: "Conteúdo", icon: Settings }
];

const emptyData: AppData = {
  produtos: [],
  categorias: [],
  marcas: [],
  aplicacoes: [],
  usuarios: [],
  leads: [],
  permissoes: [],
  produtoAplicacoes: [],
  settings: {}
};

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
      .select("id,name,company,email,role,status,notes,lastLoginAt,createdAt,updatedAt,authUserId")
      .eq("authUserId", authUserId)
      .limit(1)
      .returns<Usuario[]>();
    if (error) throw error;
    const user = users?.[0];
    if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE") {
      await supabase.auth.signOut();
      throw new Error("Acesso permitido somente para usuários ADMIN ativos.");
    }
    setSessionToken(token);
    setAdminUser(user);
    await reload();
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [
        produtos,
        categorias,
        marcas,
        aplicacoes,
        usuarios,
        leads,
        permissoes,
        produtoAplicacoes,
        settings
      ] = await Promise.all([
        supabase.from("Produto").select("*").order("ordem", { ascending: true }).order("nome").returns<Produto[]>(),
        supabase.from("Categoria").select("*").order("ordem", { ascending: true }).returns<Categoria[]>(),
        supabase.from("Marca").select("*").order("nome").returns<Marca[]>(),
        supabase.from("Aplicacao").select("*").order("nome").returns<Aplicacao[]>(),
        supabase.from("User").select("id,name,company,email,role,status,notes,lastLoginAt,createdAt,updatedAt,authUserId").order("name").returns<Usuario[]>(),
        supabase.from("LeadOrcamento").select("*").order("createdAt", { ascending: false }).limit(300).returns<Lead[]>(),
        supabase.from("ProductFieldPermission").select("*").order("fieldLabel").returns<Permission[]>(),
        supabase.from("ProdutoAplicacao").select("*").returns<ProdutoAplicacao[]>(),
        supabase.rpc("get_app_settings")
      ]);

      const firstError = [produtos, categorias, marcas, aplicacoes, usuarios, leads, permissoes, produtoAplicacoes, settings].find((item) => item.error);
      if (firstError?.error) throw firstError.error;

      setData({
        produtos: produtos.data || [],
        categorias: categorias.data || [],
        marcas: marcas.data || [],
        aplicacoes: aplicacoes.data || [],
        usuarios: usuarios.data || [],
        leads: leads.data || [],
        permissoes: permissoes.data || [],
        produtoAplicacoes: produtoAplicacoes.data || [],
        settings: (settings.data as AppSettings | null) || {}
      });
    } catch (error) {
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
      notify("Login realizado.");
    } catch (error) {
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

  if (authLoading && !sessionToken) return <FullLoader label="Validando acesso administrativo..." />;
  if (!sessionToken || !adminUser) return <LoginScreen onLogin={login} error={loginError} loading={authLoading} />;

  return (
    <div className="min-h-screen bg-soft text-navy">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col bg-navy p-5 text-white lg:flex">
        <div className="mb-8 rounded-2xl bg-white/8 p-5">
          <div className="text-3xl font-black tracking-wide">BRILAND</div>
          <div className="mt-2 text-sm text-white/60">Painel administrativo web</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {tabs.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setActive(id)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition ${active === id ? "bg-yellow text-navy" : "text-white/78 hover:bg-white/10"}`}>
              <Icon size={18} />
              {id}
            </button>
          ))}
        </nav>
        <div className="rounded-2xl border border-white/10 p-4 text-sm text-white/70">
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
              <button onClick={reload} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-black text-white">
                {loading ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}
                Atualizar
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {tabs.map(({ id }) => (
              <button key={id} onClick={() => setActive(id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${active === id ? "bg-yellow text-navy" : "bg-white text-navy"}`}>
                {id}
              </button>
            ))}
          </div>
        </header>

        <section className="p-5 lg:p-8">
          {active === "Dashboard" && <Dashboard data={data} setActive={setActive} />}
          {active === "Produtos" && <Products data={data} query={query} reload={reload} notify={notify} />}
          {active === "Categorias" && <CategoryBrandSection title="Categorias" table="Categoria" imageField="imagem" items={data.categorias} query={query} reload={reload} notify={notify} />}
          {active === "Marcas" && <CategoryBrandSection title="Marcas" table="Marca" imageField="logo" items={data.marcas} query={query} reload={reload} notify={notify} />}
          {active === "Aplicações" && <Applications items={data.aplicacoes} query={query} reload={reload} notify={notify} />}
          {active === "Leads" && <Leads leads={data.leads} products={data.produtos} query={query} reload={reload} notify={notify} />}
          {active === "Usuários" && <UsersSection users={data.usuarios} query={query} reload={reload} notify={notify} />}
          {active === "Permissões" && <PermissionsSection permissions={data.permissoes} query={query} reload={reload} notify={notify} />}
          {active === "Mídia" && <MediaSettingsSection settings={data.settings.media} reload={reload} notify={notify} />}
          {active === "Links" && <LinksSection settings={data.settings.socialLinks} reload={reload} notify={notify} />}
          {active === "Conteúdo" && <ContentSection settings={data.settings.about} reload={reload} notify={notify} />}
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

function Dashboard({ data, setActive }: { data: AppData; setActive: (tab: Tab) => void }) {
  const cards: { label: string; value: string; tab: Tab; icon: React.ElementType }[] = [
    { label: "Produtos", value: String(data.produtos.length), tab: "Produtos", icon: Boxes },
    { label: "Ativos", value: String(data.produtos.filter((item) => item.ativo !== false).length), tab: "Produtos", icon: CheckCircle2 },
    { label: "Sem imagem", value: String(data.produtos.filter((item) => !item.imagemPrincipal).length), tab: "Produtos", icon: ImageIcon },
    { label: "Leads", value: String(data.leads.length), tab: "Leads", icon: MessageCircle },
    { label: "Usuários", value: String(data.usuarios.length), tab: "Usuários", icon: Users },
    { label: "Permissões", value: String(data.permissoes.length), tab: "Permissões", icon: Lock }
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, tab, icon: Icon }) => (
          <button key={label} onClick={() => setActive(tab)} className="rounded-2xl bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5">
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
      marca: data.marcas.find((item) => item.id === product.marcaId)?.nome || ""
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
        : supabase.from("Produto").insert({ id: createId("prod"), ...payload, updatedAt: new Date().toISOString() });
      const { error } = await request;
      if (error) throw error;
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
        <Field label="Manual PDF"><input className="input" value={draft.manualPdf || ""} onChange={(event) => set("manualPdf", event.target.value)} /></Field>
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
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <UploadBox label="Imagem principal" folder="produtos/principal" value={draft.imagemPrincipal || ""} onUploaded={(url) => set("imagemPrincipal", url)} />
        <UploadBox label="Adicionar imagem extra" folder="produtos/extras" onUploaded={(url) => set("imagensExtras", [...extras, url])} />
      </div>
      {extras.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{extras.map((url, index) => <div key={`${url}-${index}`} className="relative h-24 w-28 rounded-xl border border-line bg-white p-2"><img src={url} alt="" className="h-full w-full object-contain" /><button className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white" onClick={() => set("imagensExtras", extras.filter((_, current) => current !== index))}><Trash2 size={13} /></button></div>)}</div>}
      <ModalActions saving={saving} onSave={save} onDelete={!isNew ? remove : undefined} />
    </Modal>
  );
}

function CategoryBrandSection({ title, table, imageField, items, query, reload, notify }: { title: string; table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; items: Array<Categoria | Marca>; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
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
      {editing && <CategoryBrandModal table={table} imageField={imageField} item={editing} reload={reload} notify={notify} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryBrandModal({ table, imageField, item, reload, notify, onClose }: { table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; item: Categoria | Marca; reload: () => Promise<void>; notify: (message: string) => void; onClose: () => void }) {
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
      <ModalActions saving={saving} onSave={save} onDelete={!isNew ? remove : undefined} />
    </Modal>
  );
}

function Applications({ items, query, reload, notify }: { items: Aplicacao[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [editing, setEditing] = useState<Aplicacao | null>(null);
  const filtered = items.filter((item) => [item.nome, item.tipo].join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <button onClick={() => setEditing({ id: createId("app"), nome: "Nova aplicação", slug: "nova-aplicacao", tipo: "Geral", ativo: true })} className="btn-yellow mb-5"><Plus size={17} /> Criar aplicação</button>
      <Panel title={`${filtered.length} aplicações`}>
        <Table><thead><tr><Th>Nome</Th><Th>Tipo</Th><Th>Status</Th><Th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><Td>{item.nome}</Td><Td>{item.tipo}</Td><Td><Toggle checked={item.ativo !== false} onChange={(checked) => updateRow("Aplicacao", item.id, { ativo: checked }, reload, notify)} /></Td><Td><button className="icon-btn" onClick={() => setEditing(item)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      {editing && <ApplicationModal item={editing} reload={reload} notify={notify} onClose={() => setEditing(null)} />}
    </>
  );
}

function ApplicationModal({ item, reload, notify, onClose }: { item: Aplicacao; reload: () => Promise<void>; notify: (message: string) => void; onClose: () => void }) {
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
  return <Modal title="Aplicação" onClose={onClose}><div className="grid gap-4 lg:grid-cols-3"><Field label="Nome"><input className="input" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></Field><Field label="Slug"><input className="input" value={draft.slug || ""} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></Field><Field label="Tipo"><input className="input" value={draft.tipo || ""} onChange={(e) => setDraft({ ...draft, tipo: e.target.value })} /></Field></div><label className="mt-4 inline-flex items-center gap-2"><input type="checkbox" checked={draft.ativo !== false} onChange={(e) => setDraft({ ...draft, ativo: e.target.checked })} /> Ativa</label><ModalActions saving={false} onSave={save} /></Modal>;
}

function Leads({ leads, products, query, reload, notify }: { leads: Lead[]; products: Produto[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [selected, setSelected] = useState<Lead | null>(null);
  const filtered = leads.filter((lead) => [lead.nome, lead.empresa, lead.email, lead.telefone, lead.mensagem].join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <Panel title={`${filtered.length} leads`}>
        <Table><thead><tr><Th>Nome</Th><Th>Empresa</Th><Th>Produto</Th><Th>Status</Th><Th>Data</Th><Th /></tr></thead><tbody>{filtered.map((lead) => <tr key={lead.id}><Td>{lead.nome}</Td><Td>{lead.empresa}</Td><Td>{products.find((p) => p.id === lead.produtoId)?.codigoInterno || "-"}</Td><Td><select className="input h-9" value={lead.status || "NOVO"} onChange={async (event) => updateRow("LeadOrcamento", lead.id, { status: event.target.value }, reload, notify)}><option>NOVO</option><option>EM_ATENDIMENTO</option><option>CONCLUIDO</option><option>ARQUIVADO</option></select></Td><Td>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("pt-BR") : "-"}</Td><Td><button className="icon-btn" onClick={() => setSelected(lead)}><Eye size={16} /></button></Td></tr>)}</tbody></Table>
      </Panel>
      {selected && <Modal title="Lead recebido" onClose={() => setSelected(null)}><div className="grid gap-3 lg:grid-cols-2"><Info label="Nome" value={selected.nome} /><Info label="Empresa" value={selected.empresa} /><Info label="Telefone" value={selected.telefone} /><Info label="E-mail" value={selected.email} /><Info label="Cidade/UF" value={`${selected.cidade || "-"} / ${selected.estado || "-"}`} /><Info label="Origem" value={selected.origem} /></div><div className="mt-4 rounded-2xl bg-soft p-4 text-sm leading-6">{selected.mensagem || "Sem mensagem"}</div>{selected.telefone && <a href={`https://wa.me/${selected.telefone.replace(/\D/g, "")}`} target="_blank" className="btn-yellow mt-5 inline-flex"><MessageCircle size={17} /> Abrir WhatsApp</a>}</Modal>}
    </>
  );
}

function UsersSection({ users, query, reload, notify }: { users: Usuario[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [editing, setEditing] = useState<Usuario | null>(null);
  const filtered = users.filter((user) => [user.name, user.email, user.company, user.role, user.status].join(" ").toLowerCase().includes(query.toLowerCase()));
  return <><Panel title={`${filtered.length} usuários`}><Table><thead><tr><Th>Nome</Th><Th>E-mail</Th><Th>Empresa</Th><Th>Role</Th><Th>Status</Th><Th /></tr></thead><tbody>{filtered.map((user) => <tr key={user.id}><Td>{user.name}</Td><Td>{user.email}</Td><Td>{user.company}</Td><Td>{user.role}</Td><Td>{user.status}</Td><Td><button className="icon-btn" onClick={() => setEditing(user)}><Pencil size={16} /></button></Td></tr>)}</tbody></Table></Panel>{editing && <UserModal user={editing} reload={reload} notify={notify} onClose={() => setEditing(null)} />}</>;
}

function UserModal({ user, reload, notify, onClose }: { user: Usuario; reload: () => Promise<void>; notify: (message: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(user);
  const save = async () => {
    const { error } = await supabase.from("User").update({ name: draft.name, company: draft.company || null, email: draft.email, role: draft.role, status: draft.status, notes: draft.notes || null }).eq("id", user.id);
    if (error) notify(error.message);
    else {
      notify("Usuário atualizado.");
      await reload();
      onClose();
    }
  };
  return <Modal title="Editar usuário" onClose={onClose}><div className="grid gap-4 lg:grid-cols-2"><Field label="Nome"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="Empresa"><input className="input" value={draft.company || ""} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></Field><Field label="E-mail"><input className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field><Field label="Role"><select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}><option>ADMIN</option><option>REPRESENTANTE</option><option>CLIENTE</option><option>VISITANTE</option></select></Field><Field label="Status"><select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Usuario["status"] })}><option>ACTIVE</option><option>INACTIVE</option></select></Field><Field label="Notas"><textarea className="textarea" value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field></div><ModalActions saving={false} onSave={save} /></Modal>;
}

function PermissionsSection({ permissions, query, reload, notify }: { permissions: Permission[]; query: string; reload: () => Promise<void>; notify: (message: string) => void }) {
  const filtered = permissions.filter((item) => [item.fieldKey, item.fieldLabel].join(" ").toLowerCase().includes(query.toLowerCase()));
  const toggle = async (permission: Permission, key: keyof Pick<Permission, "visibleToVisitor" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">) => updateRow("ProductFieldPermission", permission.id, { [key]: !permission[key] }, reload, notify);
  return <Panel title={`${filtered.length} permissões`}><Table><thead><tr><Th>Campo</Th><Th>Visitante</Th><Th>Cliente</Th><Th>Representante</Th><Th>Admin</Th></tr></thead><tbody>{filtered.map((permission) => <tr key={permission.id}><Td><div className="font-black">{permission.fieldLabel}</div><div className="text-xs text-muted">{permission.fieldKey}</div></Td><Td><Toggle checked={permission.visibleToVisitor} onChange={() => toggle(permission, "visibleToVisitor")} /></Td><Td><Toggle checked={permission.visibleToClient} onChange={() => toggle(permission, "visibleToClient")} /></Td><Td><Toggle checked={permission.visibleToRepresentative} onChange={() => toggle(permission, "visibleToRepresentative")} /></Td><Td><Toggle checked={permission.visibleToAdmin} onChange={() => toggle(permission, "visibleToAdmin")} /></Td></tr>)}</tbody></Table></Panel>;
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
    setUploading(true);
    try {
      onUploaded(await uploadCatalogMedia(file, folder));
    } finally {
      setUploading(false);
    }
  };
  return <div className="rounded-2xl border border-line bg-white p-4"><div className="mb-3 text-sm font-black">{label}</div>{value ? <img src={value} alt="" className="mb-3 h-36 w-full rounded-xl bg-soft object-contain" /> : <div className="mb-3 flex h-36 items-center justify-center rounded-xl bg-soft text-sm text-muted">Sem imagem</div>}<label className="btn-white inline-flex cursor-pointer">{uploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Enviar arquivo<input className="hidden" type="file" accept="image/*,.pdf" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} /></label></div>;
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
