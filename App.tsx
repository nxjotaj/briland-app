import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";

import { CONFIG_STORAGE_KEY, signInWithPassword, supabaseGet, supabasePatch, supabasePost, supabaseRpc, uploadStorageObject } from "./src/api/supabase";
import type { Aplicacao, AppData, Categoria, Lead, Marca, MediaSettings, Permission, Produto, Role, Route, SocialLinks, Usuario } from "./src/types/domain";

const colors = {
  navy: "#021126",
  yellow: "#FCB900",
  ink: "#07142A",
  muted: "#6F7480",
  line: "#E8EAF0",
  soft: "#F6F7F9",
  red: "#CF102D",
  green: "#16A34A",
  white: "#FFFFFF"
};

type IconName = keyof typeof Ionicons.glyphMap;

const logo = require("./assets/briland-logo.png");

const userSelect = "id,name,company,email,role,status,notes,lastLoginAt,createdAt,updatedAt,authUserId";

function money(value?: number | null) {
  if (typeof value !== "number") return "Sob consulta";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

const defaultSocialLinks: SocialLinks = {
  instagram: "https://instagram.com/briland",
  linkedin: "https://linkedin.com/company/briland",
  whatsapp: "https://wa.me/5521973636891",
  site: "https://briland.com.br"
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `produto-${Date.now()}`;
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loginErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) return "Senha incorreta ou e-mail incorreto.";
  if (lower.includes("email not confirmed")) return "E-mail ainda não confirmado.";
  if (lower.includes("user") && lower.includes("not")) return "E-mail incorreto ou usuário não encontrado.";
  return "Não foi possível entrar. Confira e-mail e senha.";
}

function notify(title: string, message: string) {
  Alert.alert(title, message);
}

export default function App() {
  const [route, setRoute] = useState<Route>("initial");
  const [role, setRole] = useState<Role>("VISITANTE");
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [authToken, setAuthToken] = useState<string | undefined>();
  const [loginMessage, setLoginMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "featured" | "missingPhoto">("all");
  const [sortMode, setSortMode] = useState<"order" | "name" | "newest">("order");
  const [listMode, setListMode] = useState<"grid" | "list">("grid");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Produto | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(defaultSocialLinks);
  const [mediaSettings, setMediaSettings] = useState<MediaSettings>({ initialImage: "", homeImage: "" });
  const [loading, setLoading] = useState(true);
  const [routeSplash, setRouteSplash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>({
    produtos: [],
    categorias: [],
    marcas: [],
    aplicacoes: [],
    usuarios: [],
    leads: [],
    permissoes: []
  });

  const reload = async (nextRole = role, token = authToken) => {
    setLoading(true);
    setError(null);
    try {
      const isAdminRole = nextRole === "ADMIN";
      const [produtos, categorias, marcas, aplicacoes, appSettings] = await Promise.all([
        supabaseRpc<Produto[]>("get_visible_products", { requested_role: nextRole }, token),
        supabaseGet<Categoria>("Categoria", "select=*&order=ordem.asc", token),
        supabaseGet<Marca>("Marca", "select=*", token),
        supabaseGet<Aplicacao>("Aplicacao", "select=*", token),
        supabaseRpc<Record<string, unknown>>("get_app_settings", {}, token)
      ]);
      const [usuarios, leads, permissoes] = isAdminRole
        ? await Promise.all([
            supabaseGet<Usuario>("User", `select=${userSelect}`, token),
            supabaseGet<Lead>("LeadOrcamento", "select=*&order=createdAt.desc&limit=80", token),
            supabaseGet<Permission>("ProductFieldPermission", "select=*&order=fieldLabel.asc", token)
          ])
        : [[], [], []] as [Usuario[], Lead[], Permission[]];

      const settings = appSettings as { media?: MediaSettings; socialLinks?: SocialLinks };
      if (settings.socialLinks) setSocialLinks({ ...defaultSocialLinks, ...settings.socialLinks });
      if (settings.media) setMediaSettings({ initialImage: settings.media.initialImage || "", homeImage: settings.media.homeImage || "" });

      setData({
        produtos,
        categorias,
        marcas,
        aplicacoes,
        usuarios,
        leads,
        permissoes
      });
      setSelectedProduct((current) => current ?? produtos[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados do Supabase.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload("VISITANTE", undefined);
    void AsyncStorage.getItem(CONFIG_STORAGE_KEY).then((stored) => {
      if (!stored) return;
      const parsed = JSON.parse(stored) as { socialLinks?: SocialLinks; mediaSettings?: MediaSettings };
      if (parsed.socialLinks) setSocialLinks(parsed.socialLinks);
      if (parsed.mediaSettings) setMediaSettings(parsed.mediaSettings);
    }).catch(() => undefined);
  }, []);

  const saveAdminConfig = async (nextSocialLinks = socialLinks, nextMediaSettings = mediaSettings) => {
    setSocialLinks(nextSocialLinks);
    setMediaSettings(nextMediaSettings);
    if (authToken && role === "ADMIN") {
      await Promise.all([
        supabaseRpc("save_app_setting", { setting_key: "socialLinks", setting_value: nextSocialLinks }, authToken),
        supabaseRpc("save_app_setting", { setting_key: "media", setting_value: nextMediaSettings }, authToken)
      ]);
    }
    await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ socialLinks: nextSocialLinks, mediaSettings: nextMediaSettings }));
  };

  const activeProducts = useMemo(() => data.produtos.filter((item) => item.ativo !== false), [data.produtos]);
  const categoryById = useMemo(() => new Map(data.categorias.map((item) => [item.id, item])), [data.categorias]);
  const brandById = useMemo(() => new Map(data.marcas.map((item) => [item.id, item])), [data.marcas]);
  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = activeProducts.filter((item) => {
      const categoria = categoryById.get(item.categoriaId ?? "")?.nome ?? "";
      const marca = brandById.get(item.marcaId ?? "")?.nome ?? "";
      const text = [item.nome, item.codigoInterno, item.descricaoCurta, item.ean, item.ncm, categoria, marca].join(" ").toLowerCase();
      const statusOk =
        statusFilter === "all" ||
        (statusFilter === "active" && item.ativo !== false) ||
        (statusFilter === "inactive" && item.ativo === false) ||
        (statusFilter === "featured" && Boolean(item.destaque)) ||
        (statusFilter === "missingPhoto" && !item.imagemPrincipal);
      return (!q || text.includes(q)) && (!categoryFilter || item.categoriaId === categoryFilter) && (!brandFilter || item.marcaId === brandFilter) && statusOk;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "name") return a.nome.localeCompare(b.nome);
      if (sortMode === "newest") return String(b.createdAt).localeCompare(String(a.createdAt));
      return (a.ordem ?? 0) - (b.ordem ?? 0);
    });
  }, [activeProducts, query, categoryFilter, brandFilter, statusFilter, sortMode, categoryById, brandById]);

  const go = (next: Route) => {
    if (next === route) {
      setMenuOpen(false);
      return;
    }
    setRouteSplash(true);
    setMenuOpen(false);
    setTimeout(() => {
      setRoute(next);
      setRouteSplash(false);
    }, 320);
  };

  const openProduct = (product: Produto) => {
    setSelectedProduct(product);
    go("detail");
  };

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      setLoginMessage("");
      const session = await signInWithPassword(email, password);
      const users = await supabaseGet<Usuario>("User", `select=${userSelect}&authUserId=eq.${session.user.id}`, session.access_token);
      const user = users[0];
      if (!user) throw new Error("Usuario Auth sem vinculo na tabela User.");
      if (user.status === "INACTIVE") throw new Error("Este usuario esta inativo.");
      setAuthToken(session.access_token);
      setCurrentUser(user);
      setRole(user.role);
      await reload(user.role, session.access_token);
      setRoute(user.role === "ADMIN" ? "admin" : "products");
    } catch (err) {
      const message = loginErrorMessage(err);
      setLoginMessage(message);
      notify("Falha no login", message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setAuthToken(undefined);
    setCurrentUser(null);
    setRole("VISITANTE");
    setLoginMessage("");
    go("initial");
  };

  const createLead = async (payload: Partial<Lead>) => {
    try {
      await supabasePost<Lead>("LeadOrcamento", {
        nome: payload.nome || currentUser?.name || "Visitante Briland",
        empresa: payload.empresa || currentUser?.company || "Nao informado",
        telefone: payload.telefone || "5521973636891",
        email: payload.email || currentUser?.email || "catalogo@briland.com.br",
        cidade: payload.cidade || "Nao informado",
        estado: payload.estado || "NA",
        produtoId: payload.produtoId ?? null,
        mensagem: payload.mensagem || "Solicitacao enviada pelo app Briland.",
        origem: payload.origem || "app-mobile",
        status: "NOVO"
      });
      notify("Solicitacao enviada", "Recebemos sua mensagem no painel de leads.");
      void reload();
    } catch (err) {
      notify("Não foi possível salvar", err instanceof Error ? err.message : "Verifique as permissões RLS da tabela LeadOrcamento.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={route === "login" || route === "admin" ? "light" : "dark"} />
      {loading && <LoadingOverlay />}
      {routeSplash && <RouteSplash />}
      {route === "login" ? (
        <LoginScreen onLogin={login} onSignup={() => go("signup")} onCatalog={() => go("initial")} error={loginMessage} />
      ) : route === "initial" ? (
        <InitialScreen media={mediaSettings} onCatalog={() => go("home")} onLogin={() => go("login")} />
      ) : route === "admin" ? (
        <AdminScreen data={data} active={adminTab} setActive={setAdminTab} onBack={() => go("home")} onLogout={logout} reload={() => reload(role, authToken)} authToken={authToken} socialLinks={socialLinks} setSocialLinks={(links) => void saveAdminConfig(links, mediaSettings)} mediaSettings={mediaSettings} setMediaSettings={(settings) => void saveAdminConfig(socialLinks, settings)} onAction={(text) => notify("Painel admin", text)} />
      ) : (
        <>
          <Header back={["detail", "about", "signup"].includes(route)} onBack={() => go("home")} onMenu={() => setMenuOpen(true)} />
          {error && <ErrorBanner message={error} onRetry={reload} />}
          {route === "home" && <HomeScreen go={go} products={activeProducts} categories={data.categorias} media={mediaSettings} />}
          {route === "categories" && <CategoriesScreen categories={data.categorias} onPick={(id) => { setCategoryFilter(id); go("products"); }} />}
          {route === "products" && (
            <ProductList
              title="Produtos"
              subtitle="Encontre o produto ideal para sua necessidade."
              products={filteredProducts}
              allCategories={data.categorias}
              categoryById={categoryById}
              brandById={brandById}
              query={query}
              setQuery={setQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              brandFilter={brandFilter}
              setBrandFilter={setBrandFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sortMode={sortMode}
              setSortMode={setSortMode}
              brands={data.marcas}
              filterOpen={filterOpen}
              setFilterOpen={setFilterOpen}
              listMode={listMode}
              setListMode={setListMode}
              onOpen={openProduct}
              role={role}
            />
          )}
          {route === "promotions" && (
            <ProductList
              title="Promoções"
              subtitle="Produtos em destaque e oportunidades comerciais."
              products={filteredProducts.filter((item) => item.destaque || typeof item.preco === "number")}
              allCategories={data.categorias}
              categoryById={categoryById}
              brandById={brandById}
              query={query}
              setQuery={setQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              brandFilter={brandFilter}
              setBrandFilter={setBrandFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sortMode={sortMode}
              setSortMode={setSortMode}
              brands={data.marcas}
              filterOpen={filterOpen}
              setFilterOpen={setFilterOpen}
              listMode={listMode}
              setListMode={setListMode}
              onOpen={openProduct}
              role={role}
              promo
            />
          )}
          {route === "launches" && (
            <ProductList
              title="Lançamentos"
              subtitle="Últimos produtos cadastrados no catálogo."
              products={[...filteredProducts].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 80)}
              allCategories={data.categorias}
              categoryById={categoryById}
              brandById={brandById}
              query={query}
              setQuery={setQuery}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              brandFilter={brandFilter}
              setBrandFilter={setBrandFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              sortMode={sortMode}
              setSortMode={setSortMode}
              brands={data.marcas}
              filterOpen={filterOpen}
              setFilterOpen={setFilterOpen}
              listMode={listMode}
              setListMode={setListMode}
              onOpen={openProduct}
              role={role}
              launch
            />
          )}
          {route === "detail" && selectedProduct && <ProductDetail product={selectedProduct} role={role} category={categoryById.get(selectedProduct.categoriaId ?? "")} brand={brandById.get(selectedProduct.marcaId ?? "")} onQuote={() => createLead({ produtoId: selectedProduct.id, mensagem: `Tenho interesse no produto ${selectedProduct.codigoInterno} - ${selectedProduct.nome}.`, origem: "produto" })} />}
          {route === "contact" && <ContactScreen onSubmit={createLead} />}
          {route === "about" && <AboutScreen />}
          {route === "signup" && <SignupScreen links={socialLinks} onSubmit={createLead} onLogin={() => go("login")} />}
          {route !== "signup" && <SocialDock links={socialLinks} />}
        </>
      )}
      <SideMenu visible={menuOpen} role={role} user={currentUser} onClose={() => setMenuOpen(false)} go={go} setRole={setRole} setCurrentUser={(user) => { setCurrentUser(user); if (!user) setAuthToken(undefined); }} />
    </SafeAreaView>
  );
}

function LoadingOverlay() {
  return (
    <View style={styles.loadingOverlay}>
      <ActivityIndicator size="large" color={colors.yellow} />
      <Text style={styles.loadingText}>Carregando dados da Briland...</Text>
    </View>
  );
}

function RouteSplash() {
  return (
    <View style={styles.routeSplash}>
      <Image source={logo} style={styles.routeSplashLogo} resizeMode="contain" />
      <ActivityIndicator size="small" color={colors.yellow} />
    </View>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText} numberOfLines={2}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.errorButton}><Text style={styles.errorButtonText}>Tentar novamente</Text></Pressable>
    </View>
  );
}

function Header({ back, onBack, onMenu }: { back?: boolean; onBack: () => void; onMenu: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.iconButton} onPress={back ? onBack : onMenu}>
        <Ionicons name={back ? "chevron-back" : "menu"} size={28} color={colors.navy} />
      </Pressable>
      <LogoPlate compact />
      <Pressable style={styles.iconButton} onPress={() => Linking.openURL("https://wa.me/5521973636891")}>
        <Ionicons name="logo-whatsapp" size={25} color={colors.navy} />
      </Pressable>
    </View>
  );
}

function LogoPlate({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.logoPlate, compact && styles.logoPlateCompact]}>
      <Image source={logo} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

function InitialScreen({ media, onCatalog, onLogin }: { media: MediaSettings; onCatalog: () => void; onLogin: () => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.initialContent}>
      <LogoPlate />
      <Text style={styles.tagline}>Qualidade que <Text style={styles.bold}>te move.</Text></Text>
      <View style={styles.initialMediaFrame}>
        {media.initialImage ? <Image source={{ uri: media.initialImage }} style={styles.initialImage} resizeMode="cover" /> : <BrandedMedia title="Imagem inicial" subtitle="Recomendado 1080 x 1440 px" />}
      </View>
      <View style={styles.welcomeSheet}>
        <Text style={styles.welcomeTitle}>Bem-vindo a <Text style={styles.yellowText}>Briland</Text></Text>
        <Text style={styles.centerMuted}>Acesse o catálogo real de produtos e soluções automotivas.</Text>
        <SlideToEnter onComplete={onCatalog} />
        <Divider text="ou" />
        <Pressable style={styles.secondaryButton} onPress={onLogin}>
          <Ionicons name="person" size={24} color={colors.navy} />
          <Text style={styles.secondaryText}>Login com e-mail</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function SlideToEnter({ onComplete }: { onComplete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const completed = useRef(false);
  const maxDrag = 218;
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6,
    onPanResponderMove: (_, gesture) => {
      const next = Math.max(0, Math.min(maxDrag, gesture.dx));
      translateX.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx > maxDrag * 0.72 && !completed.current) {
        completed.current = true;
        Animated.timing(translateX, { toValue: maxDrag, duration: 140, useNativeDriver: true }).start(() => onComplete());
        return;
      }
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }
  })).current;
  return (
    <Pressable style={styles.slideTrack} onPress={onComplete}>
      <Text style={styles.slideText}>Deslize para entrar no catálogo</Text>
      <Animated.View style={[styles.slideThumb, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <Ionicons name="arrow-forward" size={27} color={colors.navy} />
      </Animated.View>
    </Pressable>
  );
}

function HomeScreen({ go, products, categories, media }: { go: (route: Route) => void; products: Produto[]; categories: Categoria[]; media: MediaSettings }) {
  const items: [Route, string, string, IconName][] = [
    ["categories", "Categorias", `${categories.length} categorias ativas`, "grid-outline"],
    ["products", "Produtos", `${products.length} produtos no catálogo`, "cube-outline"],
    ["launches", "Lançamentos", "Últimos cadastros do Supabase", "star-outline"],
    ["promotions", "Promoções", "Produtos em destaque", "pricetag-outline"],
    ["contact", "Contatos", "Fale com nossa equipe", "headset-outline"]
  ];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <View style={styles.heroCard}>
        {media.homeImage ? <Image source={{ uri: media.homeImage }} style={styles.heroImage} resizeMode="cover" /> : <BrandedMedia title="Home Briland" subtitle="Recomendado 1200 x 760 px" />}
        <Pressable style={styles.heroCta} onPress={() => go("products")}>
          <Text style={styles.heroCtaText}>Ver catálogo completo</Text>
          <Ionicons name="arrow-forward" size={25} color={colors.navy} />
        </Pressable>
      </View>
      <View style={styles.dots}><View style={styles.dotActive} /><View style={styles.dot} /><View style={styles.dot} /></View>
      {items.map(([target, title, subtitle, icon]) => (
        <Pressable key={title} style={styles.menuCard} onPress={() => go(target)}>
          <View style={styles.menuIcon}><Ionicons name={icon} size={29} color={colors.navy} /></View>
          <View style={styles.flex}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View>
          <Ionicons name="arrow-forward" size={28} color={colors.navy} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CategoriesScreen({ categories, onPick }: { categories: Categoria[]; onPick: (id: string) => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Categorias" subtitle="Explore todas as categorias vindas do Supabase." />
      {categories.length === 0 ? <EmptyState text="Nenhuma categoria disponivel." /> : (
        <View style={styles.grid}>
          {categories.map((item) => (
            <Pressable style={styles.categoryCard} key={item.id} onPress={() => onPick(item.id)}>
              {item.imagem ? <Image source={{ uri: item.imagem }} style={styles.categoryImage} resizeMode="cover" /> : <BrandedMedia title={item.nome} subtitle="Imagem da categoria" />}
              <LinearGradient colors={["transparent", "rgba(252,185,0,0.35)"]} style={StyleSheet.absoluteFill} />
              <View style={styles.categoryFooter}>
                <Ionicons name="grid-outline" size={20} color={colors.yellow} />
                <Text style={styles.categoryName}>{item.nome}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ProductList({
  title,
  subtitle,
  products,
  allCategories,
  categoryById,
  brandById,
  query,
  setQuery,
  categoryFilter,
  setCategoryFilter,
  brandFilter,
  setBrandFilter,
  statusFilter,
  setStatusFilter,
  sortMode,
  setSortMode,
  brands,
  filterOpen,
  setFilterOpen,
  listMode,
  setListMode,
  onOpen,
  role,
  promo,
  launch
}: {
  title: string;
  subtitle: string;
  products: Produto[];
  allCategories: Categoria[];
  categoryById: Map<string, Categoria>;
  brandById: Map<string, Marca>;
  query: string;
  setQuery: (q: string) => void;
  categoryFilter: string | null;
  setCategoryFilter: (id: string | null) => void;
  brandFilter: string | null;
  setBrandFilter: (id: string | null) => void;
  statusFilter: "all" | "active" | "inactive" | "featured" | "missingPhoto";
  setStatusFilter: (mode: "all" | "active" | "inactive" | "featured" | "missingPhoto") => void;
  sortMode: "order" | "name" | "newest";
  setSortMode: (mode: "order" | "name" | "newest") => void;
  brands: Marca[];
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  listMode: "grid" | "list";
  setListMode: (mode: "grid" | "list") => void;
  onOpen: (product: Produto) => void;
  role: Role;
  promo?: boolean;
  launch?: boolean;
}) {
  const activeCategory = categoryFilter ? categoryById.get(categoryFilter)?.nome : "Todas categorias";
  const activeBrand = brandFilter ? brands.find((item) => item.id === brandFilter)?.nome : "Todas marcas";
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title={title} subtitle={subtitle} badge={launch ? "NOVO" : undefined} />
      <View style={styles.searchRow}>
        <View style={styles.searchBox}><Ionicons name="search" size={22} color={colors.navy} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar codigo, EAN, NCM ou descricao..." placeholderTextColor="#9BA0AA" style={styles.searchInput} /></View>
        <Pressable style={styles.filterButton} onPress={() => setFilterOpen(true)}><Ionicons name="filter" size={22} color={colors.navy} /><Text style={styles.filterText}>Filtros</Text></Pressable>
      </View>
      <View style={styles.chips}>
        <Chip text={activeCategory ?? "Categorias"} onPress={() => setFilterOpen(true)} />
        <Chip text={activeBrand ?? "Marcas"} onPress={() => setFilterOpen(true)} />
        <Chip text="Limpar" onPress={() => { setQuery(""); setCategoryFilter(null); setBrandFilter(null); setStatusFilter("all"); setSortMode("order"); }} />
      </View>
      <View style={styles.resultRow}><Text style={styles.muted}>{products.length} produtos encontrados</Text><Segmented value={listMode} setValue={setListMode} /></View>
      {products.length === 0 ? <EmptyState text="Nenhum produto encontrado com os filtros atuais." /> : (
        <View style={listMode === "grid" ? styles.grid : styles.list}>
          {products.map((product) => (
            <Pressable key={product.id} style={[listMode === "grid" ? styles.productCard : styles.productListCard, promo && styles.promoCard, launch && styles.launchCard]} onPress={() => onOpen(product)}>
              <View style={listMode === "grid" ? undefined : styles.listImageWrap}>
                {product.imagemPrincipal ? <Image source={{ uri: product.imagemPrincipal }} style={listMode === "grid" ? styles.productImage : styles.productListImage} resizeMode="contain" /> : <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Sem foto cadastrada" compact={listMode === "list"} />}
                {promo && <Ribbon text="DESTAQUE" color={colors.red} />}
                {launch && <Ribbon text="NOVO" color={colors.yellow} />}
              </View>
              <View style={styles.productBody}>
                <Text style={styles.productCode}>{product.codigoInterno || "Sem codigo"}</Text>
                <Text style={styles.productName} numberOfLines={2}>{product.nome}</Text>
                <Text style={styles.mutedSmall}>{categoryById.get(product.categoriaId ?? "")?.nome || "Sem categoria"} • {brandById.get(product.marcaId ?? "")?.nome || "Sem marca"}</Text>
                <View style={styles.cardLine} />
                <Meta icon="cube-outline" label="Caixa master" value={product.caixaMaster || "A cadastrar"} />
                <Meta icon="document-text-outline" label="NCM" value={product.ncm || "A cadastrar"} />
                {role === "VISITANTE" ? <Text style={styles.loginHint}>Entrar para ver mais informações</Text> : <Text style={styles.price}>{money(product.preco)}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        categories={allCategories}
        brands={brands}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sortMode={sortMode}
        setSortMode={setSortMode}
      />
    </ScrollView>
  );
}

function ProductDetail({ product, role, category, brand, onQuote }: { product: Produto; role: Role; category?: Categoria; brand?: Marca; onQuote: () => void }) {
  const gallery = [product.imagemPrincipal, ...(product.imagensExtras ?? [])].filter(Boolean) as string[];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <View style={styles.detailMedia}>
        {gallery[0] ? <Image source={{ uri: gallery[0] }} style={styles.detailImage} resizeMode="contain" /> : <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Cadastre a imagem principal no painel admin" tall />}
        <View style={styles.dotsOverlay}><View style={styles.dotActive} />{gallery.slice(1, 5).map((item) => <View key={item} style={styles.dotLight} />)}</View>
      </View>
      <Text style={styles.smallYellow}>{product.codigoInterno || "Sem codigo"}</Text>
      <Text style={styles.detailTitle}>{product.nome}</Text>
      <Text style={styles.muted}>{product.descricaoCurta || "Produto cadastrado no catálogo Briland."}</Text>
      <View style={styles.statRow}>
        <InfoCard icon="document-text-outline" label="Preco" value={role === "VISITANTE" ? "Login requerido" : money(product.preco)} />
        <InfoCard icon="cube-outline" label="Estoque" value={typeof product.estoque === "number" ? `${product.estoque}` : "Sob consulta"} green={Boolean(product.estoque && product.estoque > 0)} small="unidades" />
      </View>
      <Accordion title="Informacoes principais" open>
        <View style={styles.detailGrid}>
          <DetailItem label="Categoria" value={category?.nome || "A cadastrar"} />
          <DetailItem label="Marca" value={brand?.nome || "A cadastrar"} />
          <DetailItem label="NCM" value={product.ncm || "A cadastrar"} />
          <DetailItem label="EAN" value={product.ean || "A cadastrar"} />
          <DetailItem label="Caixa Master" value={product.caixaMaster || "A cadastrar"} />
          <DetailItem label="CA" value={product.ca || "A cadastrar"} />
        </View>
      </Accordion>
      <Accordion title="Descrição completa" open={Boolean(product.descricaoCompleta)}>
        <Text style={styles.detailText}>{product.descricaoCompleta}</Text>
      </Accordion>
      <Accordion title="Ficha tecnica" open={Boolean(product.fichaTecnica)}>
        <Text style={styles.detailText}>{product.fichaTecnica}</Text>
      </Accordion>
      <Accordion title="Observação comercial" open={Boolean(product.observacaoComercial)}>
        <Text style={styles.detailText}>{product.observacaoComercial}</Text>
      </Accordion>
      <View style={styles.actionRow}>
        <Pressable style={styles.yellowButton} onPress={onQuote}><Ionicons name="document-text-outline" size={20} color={colors.navy} /><Text style={styles.yellowButtonText}>Solicitar orcamento</Text></Pressable>
        <Pressable style={styles.whatsButton} onPress={() => Linking.openURL(`https://wa.me/5521973636891?text=${encodeURIComponent(`Tenho interesse no produto ${product.codigoInterno} - ${product.nome}`)}`)}><Ionicons name="logo-whatsapp" size={24} color={colors.green} /></Pressable>
      </View>
    </ScrollView>
  );
}

function FilterSheet({
  visible,
  onClose,
  categories,
  brands,
  categoryFilter,
  setCategoryFilter,
  brandFilter,
  setBrandFilter,
  statusFilter,
  setStatusFilter,
  sortMode,
  setSortMode
}: {
  visible: boolean;
  onClose: () => void;
  categories: Categoria[];
  brands: Marca[];
  categoryFilter: string | null;
  setCategoryFilter: (id: string | null) => void;
  brandFilter: string | null;
  setBrandFilter: (id: string | null) => void;
  statusFilter: "all" | "active" | "inactive" | "featured" | "missingPhoto";
  setStatusFilter: (mode: "all" | "active" | "inactive" | "featured" | "missingPhoto") => void;
  sortMode: "order" | "name" | "newest";
  setSortMode: (mode: "order" | "name" | "newest") => void;
}) {
  const statuses: Array<["all" | "active" | "inactive" | "featured" | "missingPhoto", string]> = [
    ["all", "Todos"],
    ["active", "Ativos"],
    ["inactive", "Inativos"],
    ["featured", "Destaque"],
    ["missingPhoto", "Sem foto"]
  ];
  const sorts: Array<["order" | "name" | "newest", string]> = [["order", "Ordem"], ["name", "Nome"], ["newest", "Mais novos"]];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Filtros de produtos</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <Text style={styles.sheetLabel}>Categorias</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!categoryFilter} onPress={() => setCategoryFilter(null)} />
          {categories.map((item) => <OptionPill key={item.id} label={item.nome} selected={categoryFilter === item.id} onPress={() => setCategoryFilter(item.id)} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Marcas</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!brandFilter} onPress={() => setBrandFilter(null)} />
          {brands.map((item) => <OptionPill key={item.id} label={item.nome} selected={brandFilter === item.id} onPress={() => setBrandFilter(item.id)} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Status</Text>
        <View style={styles.wrapOptions}>{statuses.map(([value, label]) => <OptionPill key={value} label={label} selected={statusFilter === value} onPress={() => setStatusFilter(value)} />)}</View>
        <Text style={styles.sheetLabel}>Ordenacao</Text>
        <View style={styles.wrapOptions}>{sorts.map(([value, label]) => <OptionPill key={value} label={label} selected={sortMode === value} onPress={() => setSortMode(value)} />)}</View>
        <Pressable style={styles.yellowButton} onPress={onClose}><Text style={styles.yellowButtonText}>Aplicar filtros</Text></Pressable>
      </View>
    </Modal>
  );
}

function OptionPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.optionPill, selected && styles.optionPillSelected]}><Text style={[styles.optionPillText, selected && styles.optionPillTextSelected]}>{label}</Text></Pressable>;
}

function BrandedMedia({ title, subtitle, tall, compact }: { title: string; subtitle: string; tall?: boolean; compact?: boolean }) {
  return (
    <LinearGradient colors={[colors.navy, "#0B2347"]} style={[styles.brandedMedia, tall && styles.brandedMediaTall, compact && styles.brandedMediaCompact]}>
      <Image source={logo} style={styles.brandedMediaLogo} resizeMode="contain" />
      <Text style={styles.brandedMediaTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.brandedMediaSub}>{subtitle}</Text>
    </LinearGradient>
  );
}

function ContactScreen({ onSubmit }: { onSubmit: (lead: Partial<Lead>) => void }) {
  const [form, setForm] = useState({ nome: "", empresa: "", telefone: "", email: "", mensagem: "" });
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Contato" subtitle="Estamos aqui para te ajudar. Envie sua mensagem direto para o painel." />
      <View style={styles.formCard}>
        <Text style={styles.label}>Com quem voce quer falar? *</Text>
        <View style={styles.choiceRow}>
          <Choice title="Comercial" subtitle="Duvidas, orcamentos e parcerias" selected icon="briefcase-outline" />
          <Choice title="Suporte" subtitle="Atendimento tecnico e suporte" icon="headset-outline" />
        </View>
        <Input label="Nome completo" value={form.nome} onChangeText={(nome) => setForm({ ...form, nome })} />
        <Input label="Empresa" value={form.empresa} onChangeText={(empresa) => setForm({ ...form, empresa })} />
        <Input label="Numero de telefone / WhatsApp" value={form.telefone} onChangeText={(telefone) => setForm({ ...form, telefone })} />
        <Input label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} />
        <Text style={styles.label}>Mensagem *</Text>
        <TextInput value={form.mensagem} onChangeText={(mensagem) => setForm({ ...form, mensagem })} placeholder="Digite sua mensagem aqui..." style={styles.textArea} multiline placeholderTextColor="#9BA0AA" />
        <View style={styles.securityBox}><Ionicons name="shield-checkmark-outline" size={32} color={colors.yellow} /><View><Text style={styles.bold}>Seus dados estao protegidos</Text><Text style={styles.mutedSmall}>A mensagem sera registrada em LeadOrcamento.</Text></View></View>
        <Pressable style={styles.yellowButton} onPress={() => onSubmit({ ...form, origem: "contato" })}><Ionicons name="paper-plane-outline" size={22} color={colors.navy} /><Text style={styles.yellowButtonText}>Enviar mensagem</Text></Pressable>
      </View>
    </ScrollView>
  );
}

function LoginScreen({ onLogin, onSignup, onCatalog, error }: { onLogin: (email: string, password: string) => void | Promise<void>; onSignup: () => void; onCatalog: () => void; error?: string }) {
  const [email, setEmail] = useState("faturamento@briland.com.br");
  const [password, setPassword] = useState("");
  return (
    <SafeAreaView style={styles.loginScreen}>
      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onCatalog} style={styles.loginLogoButton}>
        <Image source={logo} style={styles.loginLogo} resizeMode="contain" />
      </Pressable>
      <Text style={styles.loginLabel}>Insira seu e-mail</Text>
      <DarkInput icon="mail-outline" value={email} onChangeText={setEmail} placeholder="seu@email.com" />
      <Text style={styles.loginLabel}>Insira sua senha</Text>
      <DarkInput icon="lock-closed-outline" value={password} onChangeText={setPassword} placeholder="Digite sua senha" secure />
      {error ? <View style={styles.loginErrorBox}><Ionicons name="alert-circle-outline" size={19} color={colors.red} /><Text style={styles.loginErrorText}>{error}</Text></View> : null}
      <Pressable style={styles.loginButton} onPress={() => onLogin(email, password)}><Text style={styles.loginButtonText}>Entrar</Text></Pressable>
      <Pressable onPress={() => Linking.openURL("https://wa.me/5521973636891?text=Preciso%20recuperar%20meu%20acesso%20Briland")}><Text style={styles.forgotText}>Esqueci a senha  ›</Text></Pressable>
      <Divider text="ou" dark />
      <Pressable style={styles.supportButton} onPress={() => Linking.openURL("https://wa.me/5521973636891")}><Ionicons name="logo-whatsapp" size={26} color="#22C55E" /><Text style={styles.supportText}>Falar com suporte</Text></Pressable>
      <Pressable style={styles.catalogBackButton} onPress={onCatalog}><Ionicons name="home-outline" size={22} color={colors.white} /><Text style={styles.catalogBackText}>Voltar ao catálogo</Text></Pressable>
      <Text style={styles.loginMuted}>Ainda não tem uma conta?</Text>
      <Pressable style={styles.signupDarkButton} onPress={onSignup}><Ionicons name="person-add-outline" size={26} color={colors.yellow} /><Text style={styles.signupDarkText}>Cadastrar</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SignupScreen({ links, onSubmit, onLogin }: { links: SocialLinks; onSubmit: (lead: Partial<Lead>) => void; onLogin: () => void }) {
  const [form, setForm] = useState({ nome: "", empresa: "", telefone: "", email: "", mensagem: "" });
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.signupContent}>
      <PageTitle title="Cadastrar empresa" subtitle="Preencha os dados abaixo para solicitar seu cadastro empresarial." />
      <Input label="Razao social" value={form.empresa} onChangeText={(empresa) => setForm({ ...form, empresa })} />
      <Input label="Nome do responsavel" value={form.nome} onChangeText={(nome) => setForm({ ...form, nome })} />
      <Input label="Contato (Telefone / WhatsApp)" value={form.telefone} onChangeText={(telefone) => setForm({ ...form, telefone })} />
      <Input label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} />
      <Input label="CNPJ / Observacoes" value={form.mensagem} onChangeText={(mensagem) => setForm({ ...form, mensagem })} />
      <View style={styles.checkRow}><View style={styles.emptyCheck} /><Text style={styles.checkText}>Concordo com contato comercial da Briland sobre promocoes e lancamentos.</Text></View>
      <Pressable style={styles.yellowButton} onPress={() => onSubmit({ ...form, origem: "cadastro", mensagem: form.mensagem || "Solicitacao de cadastro empresarial pelo app." })}><Text style={styles.yellowButtonText}>Cadastrar</Text></Pressable>
      <Pressable onPress={onLogin}><Text style={styles.loginLink}>Ja tem uma conta? <Text style={styles.yellowText}>Entrar</Text></Text></Pressable>
      <SocialDock links={links} />
    </ScrollView>
  );
}

function AboutScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Sobre a Briland" subtitle="Informacoes institucionais editaveis no painel administrativo." />
      <View style={styles.aboutCard}>
        <Text style={styles.aboutText}>A Briland oferece soluções automotivas com catálogo conectado ao Supabase, atendimento comercial e gestão administrativa centralizada.</Text>
        <Text style={styles.aboutBody}>Esta primeira versao ja consome dados reais do banco e esta preparada para evoluir com autenticacao segura, RLS refinado, Storage, importacao e exportacao.</Text>
      </View>
    </ScrollView>
  );
}

function AdminScreen({ data, active, setActive, onBack, onLogout, reload, authToken, socialLinks, setSocialLinks, mediaSettings, setMediaSettings, onAction }: { data: AppData; active: string; setActive: (tab: string) => void; onBack: () => void; onLogout: () => void; reload: () => void; authToken?: string; socialLinks: SocialLinks; setSocialLinks: (links: SocialLinks) => void; mediaSettings: MediaSettings; setMediaSettings: (settings: MediaSettings) => void; onAction: (message: string) => void }) {
  const tabs = ["Dashboard", "Produtos", "Categorias", "Marcas", "Aplicações", "Usuários", "Permissões", "Leads", "Mídia", "Links"];
  return (
    <SafeAreaView style={styles.adminSafe}>
      <View style={styles.adminHeader}>
        <Pressable style={styles.adminBack} onPress={onBack}><Ionicons name="chevron-back" size={24} color={colors.white} /></Pressable>
        <Image source={logo} style={styles.adminLogo} resizeMode="contain" />
        <View style={styles.adminHeaderActions}>
          <Pressable style={styles.adminBadge} onPress={reload}><Text style={styles.adminBadgeText}>SYNC</Text></Pressable>
          <Pressable style={styles.adminLogout} onPress={onLogout}><Ionicons name="log-out-outline" size={20} color={colors.white} /></Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.adminTabs} contentContainerStyle={styles.adminTabsContent}>
        {tabs.map((tab) => <Pressable key={tab} onPress={() => setActive(tab)} style={[styles.adminTab, active === tab && styles.adminTabActive]}><Text style={[styles.adminTabText, active === tab && styles.adminTabTextActive]}>{tab}</Text></Pressable>)}
      </ScrollView>
      <ScrollView style={styles.adminBody} contentContainerStyle={styles.adminContent}>
        {active === "Dashboard" && <AdminDashboard data={data} onAction={onAction} />}
        {active === "Produtos" && <AdminProducts products={data.produtos} categories={data.categorias} brands={data.marcas} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Categorias" && <AdminCrud title="Categorias" table="Categoria" items={data.categorias} icon="grid-outline" imageField="imagem" reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Marcas" && <AdminCrud title="Marcas" table="Marca" items={data.marcas} icon="shield-checkmark-outline" imageField="logo" reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Aplicações" && <AdminCrud title="Aplicações" items={data.aplicacoes.map((item) => ({ id: item.id, nome: `${item.nome} • ${item.tipo || "Tipo"}`, ativo: item.ativo }))} icon="git-branch-outline" onAction={onAction} />}
        {active === "Usuários" && <AdminUsers users={data.usuarios} onAction={onAction} />}
        {active === "Permissões" && <AdminPermissions permissions={data.permissoes} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Leads" && <AdminLeads leads={data.leads} products={data.produtos} />}
        {active === "Mídia" && <AdminMedia media={mediaSettings} setMedia={setMediaSettings} authToken={authToken} />}
        {active === "Links" && <AdminLinks links={socialLinks} setLinks={setSocialLinks} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function AdminDashboard({ data, onAction }: { data: AppData; onAction: (message: string) => void }) {
  const metrics: [string, string, IconName][] = [
    [String(data.produtos.length), "Total de produtos", "cube-outline"],
    [String(data.produtos.filter((p) => p.ativo !== false).length), "Produtos ativos", "checkmark-circle-outline"],
    [String(data.produtos.filter((p) => !p.imagemPrincipal).length), "Sem foto", "image-outline"],
    [String(data.leads.length), "Leads recebidos", "chatbubbles-outline"],
    [String(data.usuarios.filter((u) => u.status === "ACTIVE").length), "Usuários ativos", "people-outline"],
    [String(data.permissoes.length), "Campos permissionados", "lock-closed-outline"]
  ];
  return (
    <>
      <Text style={styles.adminTitle}>Dashboard</Text>
      <Text style={styles.adminSubtitle}>Metricas em tempo real das tabelas Supabase.</Text>
      <View style={styles.adminMetricGrid}>{metrics.map(([value, label, icon]) => <View key={label} style={styles.adminMetric}><Ionicons name={icon} size={23} color={colors.yellow} /><Text style={styles.adminMetricValue}>{value}</Text><Text style={styles.adminMetricLabel}>{label}</Text></View>)}</View>
      <AdminPanel title="Atalhos rapidos">
        <View style={styles.shortcutGrid}>{["Criar produto", "Importar XLSX", "Exportar Excel", "Permissões", "Leads", "Auditoria"].map((item) => <Pressable key={item} style={styles.shortcut} onPress={() => onAction(`${item}: pronto para conectar ao backend administrativo seguro.`)}><Ionicons name="arrow-forward" size={18} color={colors.navy} /><Text style={styles.shortcutText}>{item}</Text></Pressable>)}</View>
      </AdminPanel>
    </>
  );
}

function AdminProducts({ products, categories, brands, reload, authToken, onAction }: { products: Produto[]; categories: Categoria[]; brands: Marca[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<Produto | null>(null);
  const newProduct = () => {
    const id = createId("prod");
    setEditing({
      id,
      nome: "Novo produto",
      slug: id,
      codigoInterno: `BR-${Date.now()}`,
      categoriaId: categories[0]?.id || "",
      marcaId: brands[0]?.id || "",
      descricaoCurta: "",
      descricaoCompleta: "",
      imagensExtras: [],
      ativo: true,
      destaque: false,
      ordem: 0
    });
  };
  return (
    <>
      <Text style={styles.adminTitle}>Produtos</Text>
      <View style={styles.adminActions}><Pressable style={styles.adminYellowButton} onPress={newProduct}><Ionicons name="add" size={20} color={colors.navy} /><Text style={styles.adminYellowText}>Criar produto</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={() => onAction("Importacao XLSX deve rodar no backend.")}><Ionicons name="cloud-upload-outline" size={20} color={colors.navy} /><Text>Importar</Text></Pressable></View>
      {products.map((product) => <Pressable key={product.id} style={styles.adminListItem} onPress={() => setEditing(product)}>{product.imagemPrincipal ? <Image source={{ uri: product.imagemPrincipal }} style={styles.adminThumb} /> : <View style={styles.adminThumbPlaceholder}><Ionicons name="image-outline" size={24} color={colors.yellow} /></View>}<View style={styles.flex}><Text style={styles.productCode}>{product.codigoInterno || "Sem codigo"}</Text><Text style={styles.adminItemTitle}>{product.nome}</Text><Text style={styles.mutedSmall}>{product.ativo ? "Ativo" : "Inativo"} • Ordem {product.ordem ?? 0} • {money(product.preco)}</Text></View><Switch value={product.ativo !== false} onValueChange={async (value) => { try { await supabasePatch<Produto>("Produto", product.id, { ativo: value }, authToken); await reload(); } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao atualizar status."); } }} trackColor={{ true: colors.yellow, false: "#D7DAE1" }} /></Pressable>)}
      <ProductEditor product={editing} categories={categories} brands={brands} authToken={authToken} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />
    </>
  );
}

function ProductEditor({ product, categories, brands, authToken, onClose, onSaved }: { product: Produto | null; categories: Categoria[]; brands: Marca[]; authToken?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Produto | null>(product);
  useEffect(() => setDraft(product), [product]);
  if (!product || !draft) return null;
  const isNew = !product.createdAt;
  const set = (key: keyof Produto, value: string | boolean | number | string[] | null) => setDraft({ ...draft, [key]: value });
  const productImageHelp = "Imagem ideal: 1200 x 900 px (proporção 4:3), JPG/PNG/WEBP até 5MB. O app exibe com contain para não cortar no card nem no detalhe.";
  const payload = () => ({
    nome: draft.nome,
    slug: draft.slug || slugify(`${draft.codigoInterno || ""}-${draft.nome}`),
    codigoInterno: draft.codigoInterno,
    categoriaId: draft.categoriaId,
    marcaId: draft.marcaId,
    descricaoCurta: draft.descricaoCurta || null,
    descricaoCompleta: draft.descricaoCompleta || null,
    ean: draft.ean || null,
    ncm: draft.ncm || null,
    caixaMaster: draft.caixaMaster || null,
    imagemPrincipal: draft.imagemPrincipal || null,
    imagensExtras: draft.imagensExtras || [],
    preco: typeof draft.preco === "number" ? draft.preco : null,
    estoque: typeof draft.estoque === "number" ? draft.estoque : null,
    condicaoComercial: draft.condicaoComercial || null,
    prazoEntrega: draft.prazoEntrega || null,
    fichaTecnica: draft.fichaTecnica || null,
    manualPdf: draft.manualPdf || null,
    observacaoComercial: draft.observacaoComercial || null,
    observacaoInterna: draft.observacaoInterna || null,
    margem: typeof draft.margem === "number" ? draft.margem : null,
    ca: draft.ca || null,
    ativo: draft.ativo !== false,
    destaque: Boolean(draft.destaque),
    ordem: Number(draft.ordem || 0),
    updatedAt: new Date().toISOString()
  });
  const save = async () => {
    try {
      if (isNew) {
        await supabasePost<Produto>("Produto", { id: draft.id, ...payload() }, authToken);
      } else {
        await supabasePatch<Produto>("Produto", product.id, payload(), authToken);
      }
      await onSaved();
      notify("Produto salvo", "As alterações foram enviadas para o Supabase.");
    } catch (err) {
      notify("Falha ao salvar", err instanceof Error ? err.message : "Verifique RLS/permissoes do endpoint Produto.");
    }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{isNew ? "Criar produto" : "Editar produto"}</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <Text style={styles.adminSubtitle}>Todos os campos seguem o schema real da tabela Produto.</Text>
        <AdminTextInput label="Nome" value={draft.nome} onChangeText={(value) => set("nome", value)} />
        <AdminTextInput label="Slug" value={draft.slug || ""} onChangeText={(value) => set("slug", value)} />
        <AdminTextInput label="Codigo interno" value={draft.codigoInterno || ""} onChangeText={(value) => set("codigoInterno", value)} />
        <Text style={styles.sheetLabel}>Categoria</Text>
        <AdminChoicePills items={categories} selectedId={draft.categoriaId || null} onSelect={(id) => set("categoriaId", id)} />
        <Text style={styles.sheetLabel}>Marca</Text>
        <AdminChoicePills items={brands} selectedId={draft.marcaId || null} onSelect={(id) => set("marcaId", id)} />
        <ImageUploadField label="Imagem principal" value={draft.imagemPrincipal || ""} folder="produtos/principal" authToken={authToken} help={productImageHelp} onUploaded={(url) => set("imagemPrincipal", url)} />
        <ImageUploadField label="Imagem extra" value={(draft.imagensExtras || [])[0] || ""} folder="produtos/extras" authToken={authToken} help="Opcional: use também 1200 x 900 px para manter consistência no carrossel." onUploaded={(url) => set("imagensExtras", [url, ...(draft.imagensExtras || []).slice(1)])} />
        <AdminTextInput label="Descrição curta" value={draft.descricaoCurta || ""} onChangeText={(value) => set("descricaoCurta", value)} multiline />
        <AdminTextInput label="Descrição completa" value={draft.descricaoCompleta || ""} onChangeText={(value) => set("descricaoCompleta", value)} multiline />
        <AdminTextInput label="EAN" value={draft.ean || ""} onChangeText={(value) => set("ean", value)} />
        <AdminTextInput label="NCM" value={draft.ncm || ""} onChangeText={(value) => set("ncm", value)} />
        <AdminTextInput label="CA" value={draft.ca || ""} onChangeText={(value) => set("ca", value)} />
        <AdminTextInput label="Caixa master" value={draft.caixaMaster || ""} onChangeText={(value) => set("caixaMaster", value)} />
        <AdminTextInput label="Preco" value={String(draft.preco ?? "")} keyboard="numeric" onChangeText={(value) => set("preco", value ? Number(value.replace(",", ".")) : null)} />
        <AdminTextInput label="Estoque" value={String(draft.estoque ?? "")} keyboard="numeric" onChangeText={(value) => set("estoque", value ? Number(value) : null)} />
        <AdminTextInput label="Margem (%)" value={String(draft.margem ?? "")} keyboard="numeric" onChangeText={(value) => set("margem", value ? Number(value.replace(",", ".")) : null)} />
        <AdminTextInput label="Condição comercial" value={draft.condicaoComercial || ""} onChangeText={(value) => set("condicaoComercial", value)} multiline />
        <AdminTextInput label="Prazo de entrega" value={draft.prazoEntrega || ""} onChangeText={(value) => set("prazoEntrega", value)} />
        <AdminTextInput label="Ficha tecnica" value={draft.fichaTecnica || ""} onChangeText={(value) => set("fichaTecnica", value)} multiline />
        <AdminTextInput label="Manual PDF URL" value={draft.manualPdf || ""} onChangeText={(value) => set("manualPdf", value)} />
        <AdminTextInput label="Observação comercial" value={draft.observacaoComercial || ""} onChangeText={(value) => set("observacaoComercial", value)} multiline />
        <AdminTextInput label="Observação interna" value={draft.observacaoInterna || ""} onChangeText={(value) => set("observacaoInterna", value)} multiline />
        <AdminTextInput label="Ordem" value={String(draft.ordem ?? 0)} keyboard="numeric" onChangeText={(value) => set("ordem", Number(value || 0))} />
        <View style={styles.editorSwitch}><Text style={styles.bold}>Ativo</Text><Switch value={draft.ativo !== false} onValueChange={(value) => set("ativo", value)} /></View>
        <View style={styles.editorSwitch}><Text style={styles.bold}>Destaque</Text><Switch value={Boolean(draft.destaque)} onValueChange={(value) => set("destaque", value)} /></View>
        <Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar produto</Text></Pressable>
      </ScrollView>
    </Modal>
  );
}

function AdminCrud({ title, items, icon, table, imageField, reload, authToken, onAction }: { title: string; items: Array<{ id: string; nome: string; ativo?: boolean | null; imagem?: string | null; logo?: string | null }>; icon: IconName; table?: "Categoria" | "Marca"; imageField?: "imagem" | "logo"; reload?: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<{ id: string; nome: string; ativo?: boolean | null; imagem?: string | null; logo?: string | null } | null>(null);
  return (
    <>
      <Text style={styles.adminTitle}>{title}</Text>
      <View style={styles.adminActions}><Pressable style={styles.adminYellowButton} onPress={() => onAction(`Criar ${title.toLowerCase()} exige endpoint admin.`)}><Ionicons name="add" size={20} color={colors.navy} /><Text style={styles.adminYellowText}>Criar</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={() => onAction("Upload deve usar Supabase Storage com validacao no backend.")}><Ionicons name="image-outline" size={20} color={colors.navy} /><Text>Upload imagem</Text></Pressable></View>
      {items.length === 0 ? <EmptyState text={`Nenhum item em ${title}.`} /> : items.map((item) => <Pressable key={item.id} style={styles.adminListItem} onPress={() => setEditing(item)}><View style={styles.adminIconBox}><Ionicons name={icon} size={24} color={colors.yellow} /></View><View style={styles.flex}><Text style={styles.adminItemTitle}>{item.nome}</Text><Text style={styles.mutedSmall}>{table ? "Toque para editar imagem/nome" : "Registro vindo do Supabase"}</Text></View><Switch value={item.ativo !== false} onValueChange={async (value) => { if (!table || !reload) return onAction("Alteracao indisponivel para esta tabela."); try { await supabasePatch(table, item.id, { ativo: value }, authToken); await reload(); } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao atualizar status."); } }} trackColor={{ true: colors.yellow, false: "#D7DAE1" }} /></Pressable>)}
      {editing && table && imageField && reload && <CategoryBrandEditor title={title} table={table} imageField={imageField} item={editing} authToken={authToken} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

function CategoryBrandEditor({ title, table, imageField, item, authToken, onClose, onSaved }: { title: string; table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; item: { id: string; nome: string; ativo?: boolean | null; imagem?: string | null; logo?: string | null }; authToken?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [nome, setNome] = useState(item.nome);
  const [imageUrl, setImageUrl] = useState((imageField === "imagem" ? item.imagem : item.logo) || "");
  const [ativo, setAtivo] = useState(item.ativo !== false);
  const save = async () => {
    try {
      await supabasePatch(table, item.id, { nome, [imageField]: imageUrl || null, ativo }, authToken);
      await onSaved();
      notify(`${title} salvo`, "Registro atualizado no Supabase.");
    } catch (err) {
      notify("Falha ao salvar", err instanceof Error ? err.message : "Verifique RLS/permissoes.");
    }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Editar {title}</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <AdminTextInput label="Nome" value={nome} onChangeText={setNome} />
        <ImageUploadField
          label={imageField === "imagem" ? "Imagem da categoria" : "Logo da marca"}
          value={imageUrl}
          folder={imageField === "imagem" ? "categorias" : "marcas"}
          authToken={authToken}
          help={imageField === "imagem" ? "Categoria: 900 x 700 px, JPG/PNG/WEBP até 5MB." : "Marca: 600 x 300 px, PNG/WEBP com fundo limpo até 5MB."}
          onUploaded={setImageUrl}
        />
        <View style={styles.editorSwitch}><Text style={styles.bold}>Ativo</Text><Switch value={ativo} onValueChange={setAtivo} /></View>
        <Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar</Text></Pressable>
      </View>
    </Modal>
  );
}

function AdminUsers({ users, onAction }: { users: Usuario[]; onAction: (message: string) => void }) {
  return (
    <>
      <Text style={styles.adminTitle}>Usuários</Text>
      <Text style={styles.adminSubtitle}>Usuários vinculados ao Supabase Auth. A tabela User está protegida por RLS.</Text>
      {users.map((user) => <View key={user.id} style={styles.adminListItem}><View style={styles.avatar}><Text style={styles.avatarText}>{user.name[0]}</Text></View><View style={styles.flex}><Text style={styles.adminItemTitle}>{user.name}</Text><Text style={styles.mutedSmall}>{user.company || "Sem empresa"} • {user.role} • {user.status}</Text></View><Pressable onPress={() => onAction(`Editar ${user.name} exige backend admin.`)}><Ionicons name="create-outline" size={22} color={colors.navy} /></Pressable></View>)}
    </>
  );
}

function AdminPermissions({ permissions, reload, authToken, onAction }: { permissions: Permission[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const toggle = async (permission: Permission, key: keyof Pick<Permission, "visibleToVisitor" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">) => {
    try {
      await supabasePatch<Permission>("ProductFieldPermission", permission.id, { [key]: !permission[key] }, authToken);
      await reload();
    } catch (err) {
      onAction(err instanceof Error ? err.message : "Falha ao salvar permissao.");
    }
  };
  return (
    <>
      <Text style={styles.adminTitle}>Permissões</Text>
      <Text style={styles.adminSubtitle}>Tabela real ProductFieldPermission.</Text>
      <View style={styles.permissionHeader}><Text style={styles.permissionField}>Campo</Text>{["Vis.", "Cli.", "Rep.", "Adm."].map((r) => <Text key={r} style={styles.permissionRole}>{r}</Text>)}</View>
      {permissions.map((field) => <View key={field.id} style={styles.permissionRow}><Text style={styles.permissionField}>{field.fieldLabel}</Text>{([
        ["visibleToVisitor", field.visibleToVisitor],
        ["visibleToClient", field.visibleToClient],
        ["visibleToRepresentative", field.visibleToRepresentative],
        ["visibleToAdmin", field.visibleToAdmin]
      ] as Array<[keyof Pick<Permission, "visibleToVisitor" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">, boolean]>).map(([key, checked]) => <Pressable key={key} onPress={() => toggle(field, key)} style={[styles.permissionCheck, checked && styles.permissionCheckOn]}>{checked && <Ionicons name="checkmark" size={14} color={colors.navy} />}</Pressable>)}</View>)}
      <Text style={styles.mutedSmall}>As alteracoes sao salvas imediatamente no endpoint ProductFieldPermission.</Text>
    </>
  );
}

function AdminLeads({ leads, products }: { leads: Lead[]; products: Produto[] }) {
  const productById = new Map(products.map((item) => [item.id, item]));
  return (
    <>
      <Text style={styles.adminTitle}>Leads e orcamentos</Text>
      {leads.length === 0 ? <EmptyState text="Nenhum lead encontrado." /> : leads.map((lead) => <View key={lead.id} style={styles.leadCard}><View style={styles.leadTop}><Text style={styles.adminItemTitle}>{lead.nome}</Text><Text style={styles.leadStatus}>{lead.status || "NOVO"}</Text></View><Text style={styles.mutedSmall}>{lead.empresa || "Sem empresa"} • {lead.cidade || "Cidade"}/{lead.estado || "UF"} • {productById.get(lead.produtoId ?? "")?.codigoInterno || "Sem produto"}</Text><Text style={styles.detailText}>{lead.mensagem}</Text><Pressable style={styles.whatsLead} onPress={() => Linking.openURL(`https://wa.me/${lead.telefone || "5521973636891"}?text=${encodeURIComponent(`Olá ${lead.nome}, recebemos seu contato pela Briland.`)}`)}><Ionicons name="logo-whatsapp" size={18} color={colors.green} /><Text style={styles.whatsLeadText}>Abrir WhatsApp</Text></Pressable></View>)}
    </>
  );
}

function AdminMedia({ media, setMedia, authToken }: { media: MediaSettings; setMedia: (settings: MediaSettings) => void; authToken?: string }) {
  const [draft, setDraft] = useState(media);
  return (
    <>
      <Text style={styles.adminTitle}>Mídia do app</Text>
      <Text style={styles.adminSubtitle}>Envie imagens para o Supabase Storage. Quando vazio, o app usa um bloco Briland limpo.</Text>
      <AdminPanel title="Tela inicial">
        <ImageUploadField label="Imagem da primeira tela" value={draft.initialImage} folder="app/inicial" authToken={authToken} help="Recomendado: 1080 x 1440 px, área segura central, JPG/PNG/WEBP até 5MB." onUploaded={(initialImage) => setDraft({ ...draft, initialImage })} />
      </AdminPanel>
      <AdminPanel title="Home">
        <ImageUploadField label="Imagem da home" value={draft.homeImage} folder="app/home" authToken={authToken} help="Recomendado: 1200 x 760 px, área segura para chamada e botão, JPG/PNG/WEBP até 5MB." onUploaded={(homeImage) => setDraft({ ...draft, homeImage })} />
      </AdminPanel>
      <AdminPanel title="Categorias e marcas">
        <Text style={styles.mutedSmall}>Imagens de categorias: edite em Admin / Categorias. Logos de marcas: edite em Admin / Marcas. Recomendado: 900 x 700 px para categorias e 600 x 300 px para logos.</Text>
      </AdminPanel>
      <Pressable style={styles.yellowButton} onPress={() => { setMedia(draft); notify("Mídia salva", "Configuração salva no AppSetting do Supabase."); }}><Text style={styles.yellowButtonText}>Aplicar midia</Text></Pressable>
    </>
  );
}

function AdminLinks({ links, setLinks }: { links: SocialLinks; setLinks: (links: SocialLinks) => void }) {
  const [draft, setDraft] = useState(links);
  const update = (key: keyof SocialLinks, value: string) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <Text style={styles.adminTitle}>Links e redes</Text>
      <Text style={styles.adminSubtitle}>Esses links alimentam os botoes sociais do app.</Text>
      <AdminTextInput label="Instagram URL" value={draft.instagram} onChangeText={(value) => update("instagram", value)} />
      <AdminTextInput label="LinkedIn URL" value={draft.linkedin} onChangeText={(value) => update("linkedin", value)} />
      <AdminTextInput label="WhatsApp URL" value={draft.whatsapp} onChangeText={(value) => update("whatsapp", value)} />
      <AdminTextInput label="Site URL" value={draft.site} onChangeText={(value) => update("site", value)} />
      <Pressable style={styles.yellowButton} onPress={() => { setLinks(draft); notify("Links salvos", "Links aplicados nesta sessão e persistidos no AppSetting do Supabase."); }}><Text style={styles.yellowButtonText}>Salvar links</Text></Pressable>
    </>
  );
}

function AdminChoicePills({ items, selectedId, onSelect }: { items: Array<{ id: string; nome: string }>; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
      {items.map((item) => <OptionPill key={item.id} label={item.nome} selected={selectedId === item.id} onPress={() => onSelect(item.id)} />)}
    </ScrollView>
  );
}

function ImageUploadField({ label, value, folder, authToken, help, onUploaded }: { label: string; value: string; folder: string; authToken?: string; help: string; onUploaded: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const pick = async () => {
    try {
      setUploading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const contentType = asset.mimeType || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const url = await uploadStorageObject(asset.uri, path, contentType, authToken);
      onUploaded(url);
      notify("Upload concluído", "Imagem enviada para o Supabase Storage.");
    } catch (err) {
      notify("Falha no upload", err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  };
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.mutedSmall}>{help}</Text>
      {value ? <Image source={{ uri: value }} style={styles.uploadPreview} resizeMode="contain" /> : <View style={styles.uploadEmpty}><Ionicons name="image-outline" size={26} color={colors.yellow} /><Text style={styles.mutedSmall}>Nenhuma imagem enviada.</Text></View>}
      <Pressable style={styles.adminSoftButtonWide} onPress={pick} disabled={uploading}>
        {uploading ? <ActivityIndicator color={colors.navy} /> : <Ionicons name="cloud-upload-outline" size={20} color={colors.navy} />}
        <Text style={styles.adminYellowText}>{uploading ? "Enviando..." : "Selecionar imagem"}</Text>
      </Pressable>
    </View>
  );
}

function AdminTextInput({ label, value, onChangeText, keyboard, multiline }: { label: string; value: string; onChangeText: (text: string) => void; keyboard?: "default" | "numeric"; multiline?: boolean }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.input, multiline && styles.inputMultiline]}>
        <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboard} placeholder={label} placeholderTextColor="#9BA0AA" style={[styles.inputText, multiline && styles.inputTextMultiline]} multiline={multiline} textAlignVertical={multiline ? "top" : "center"} />
      </View>
    </View>
  );
}

function SideMenu({ visible, onClose, go, role, user, setRole, setCurrentUser }: { visible: boolean; onClose: () => void; go: (route: Route) => void; role: Role; user: Usuario | null; setRole: (role: Role) => void; setCurrentUser: (user: Usuario | null) => void }) {
  const items: [Route, string, IconName][] = [["home", "Início", "home-outline"], ["categories", "Categorias", "grid-outline"], ["products", "Produtos", "bag-outline"], ["launches", "Lançamentos", "star-outline"], ["promotions", "Promoções", "pricetag-outline"], ["contact", "Contatos", "headset-outline"], ["about", "Sobre a Briland", "business-outline"]];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}><BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /></Pressable>
      <View style={styles.sideMenu}>
        <View style={styles.sideHeader}><Image source={logo} style={styles.sideLogo} resizeMode="contain" /></View>
        {user && <Text style={styles.sideUser}>{user.name} • {role}</Text>}
        {items.map(([target, label, icon]) => <Pressable key={label} style={styles.sideItem} onPress={() => go(target)}><Ionicons name={icon} size={25} color={label === "Início" ? colors.yellow : colors.navy} /><Text style={[styles.sideLabel, label === "Início" && styles.yellowText]}>{label}</Text></Pressable>)}
        {role === "ADMIN" && <Pressable style={styles.sideItem} onPress={() => go("admin")}><Ionicons name="speedometer-outline" size={25} color={colors.navy} /><Text style={styles.sideLabel}>Painel admin</Text></Pressable>}
        <Pressable style={styles.sideItem} onPress={() => { setRole("VISITANTE"); setCurrentUser(null); go(role === "VISITANTE" ? "login" : "initial"); }}><Ionicons name="log-in-outline" size={25} color={colors.navy} /><Text style={styles.sideLabel}>{role === "VISITANTE" ? "Login" : "Sair"}</Text></Pressable>
        <View style={styles.sidePromo}><Text style={styles.sidePromoText}>Qualidade e confiança que te levam mais longe.</Text></View>
      </View>
    </Modal>
  );
}

function PageTitle({ title, subtitle, badge }: { title: string; subtitle: string; badge?: string }) {
  return <View style={styles.titleBlock}><View style={styles.titleRow}><Text style={styles.pageTitle}>{title}</Text>{badge && <Text style={styles.badge}>{badge}</Text>}</View><Text style={styles.pageSubtitle}>{subtitle}</Text><View style={styles.titleAccent} /></View>;
}

function Chip({ text, onPress }: { text: string; onPress: () => void }) {
  return <Pressable style={styles.chip} onPress={onPress}><Text style={styles.chipText}>{text}</Text><Ionicons name="chevron-down" size={16} color={colors.navy} /></Pressable>;
}

function Segmented({ value, setValue }: { value: "grid" | "list"; setValue: (mode: "grid" | "list") => void }) {
  return <View style={styles.segment}><Pressable style={value === "grid" ? styles.segmentActive : styles.segmentLight} onPress={() => setValue("grid")}><Ionicons name="grid" size={20} color={value === "grid" ? colors.white : colors.navy} /></Pressable><Pressable style={value === "list" ? styles.segmentActive : styles.segmentLight} onPress={() => setValue("list")}><Ionicons name="list" size={20} color={value === "list" ? colors.white : colors.navy} /></Pressable></View>;
}

function Ribbon({ text, color }: { text: string; color: string }) {
  return <View style={[styles.ribbon, { backgroundColor: color }]}><Text style={styles.ribbonText}>{text}</Text></View>;
}

function Meta({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <View style={styles.meta}><Ionicons name={icon} size={18} color={colors.yellow} /><View><Text style={styles.metaLabel}>{label}</Text><Text style={styles.metaValue}>{value}</Text></View></View>;
}

function InfoCard({ icon, label, value, green, small }: { icon: IconName; label: string; value: string; green?: boolean; small?: string }) {
  return <View style={styles.infoCard}><Ionicons name={icon} size={30} color={colors.yellow} /><View><Text style={styles.metaLabel}>{label}</Text><Text style={[styles.infoValue, green && styles.greenText]}>{value}</Text>{small && <Text style={styles.mutedSmall}>{small}</Text>}</View></View>;
}

function Accordion({ title, children, open }: { title: string; children?: React.ReactNode; open?: boolean }) {
  const [expanded, setExpanded] = useState(Boolean(open));
  return <View style={styles.accordion}><Pressable style={styles.accordionHeader} onPress={() => setExpanded((value) => !value)}><Text style={styles.bold}>{title}</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={21} color={colors.navy} /></Pressable>{expanded && <View>{children || <Text style={styles.mutedSmall}>Nenhuma informacao cadastrada.</Text>}</View>}</View>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailItem}><Text style={styles.detailSub}>{label}</Text><Text style={styles.detailText}>{value}</Text></View>;
}

function Choice({ title, subtitle, selected, icon }: { title: string; subtitle: string; selected?: boolean; icon: IconName }) {
  return <View style={[styles.choice, selected && styles.choiceSelected]}>{selected && <View style={styles.choiceCheck}><Ionicons name="checkmark" size={15} color={colors.white} /></View>}<Ionicons name={icon} size={32} color={colors.navy} /><Text style={styles.choiceTitle}>{title}</Text><Text style={styles.choiceSub}>{subtitle}</Text></View>;
}

function Input({ label, value, onChangeText }: { label: string; value: string; onChangeText: (text: string) => void }) {
  return <View style={styles.inputGroup}><Text style={styles.label}>{label} <Text style={styles.required}>*</Text></Text><View style={styles.input}><Ionicons name="document-text-outline" size={21} color={colors.muted} /><TextInput value={value} onChangeText={onChangeText} placeholder={`Digite ${label.toLowerCase()}`} style={styles.inputText} placeholderTextColor="#9BA0AA" /></View></View>;
}

function DarkInput({ icon, value, onChangeText, placeholder, secure }: { icon: IconName; value?: string; onChangeText?: (text: string) => void; placeholder: string; secure?: boolean }) {
  return <View style={styles.darkInput}><Ionicons name={icon} size={25} color={colors.white} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={secure} placeholderTextColor="#8EA0BB" style={styles.darkInputText} /></View>;
}

function Divider({ text, dark }: { text: string; dark?: boolean }) {
  return <View style={styles.divider}><View style={[styles.dividerLine, dark && styles.dividerLineDark]} /><Text style={[styles.dividerText, dark && styles.dividerTextDark]}>{text}</Text><View style={[styles.dividerLine, dark && styles.dividerLineDark]} /></View>;
}

function SocialDock({ links }: { links: SocialLinks }) {
  const socialItems: [IconName, string, string][] = [
    ["logo-instagram", "Instagram", links.instagram],
    ["logo-linkedin", "LinkedIn", links.linkedin],
    ["logo-whatsapp", "WhatsApp", links.whatsapp],
    ["globe-outline", "Site", links.site]
  ];
  return <View style={styles.socialDock}>{socialItems.map(([icon, label, url]) => <Pressable key={label} style={styles.socialItem} onPress={() => Linking.openURL(url)}><Ionicons name={icon} size={31} color={colors.navy} /><Text style={styles.socialLabel}>{label}</Text></Pressable>)}</View>;
}

function AdminPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.adminPanel}><Text style={styles.adminPanelTitle}>{title}</Text>{children}</View>;
}

function EmptyState({ text }: { text: string }) {
  return <View style={styles.emptyState}><Ionicons name="alert-circle-outline" size={28} color={colors.yellow} /><Text style={styles.muted}>{text}</Text></View>;
}

const shadow = {
  shadowColor: "#00112A",
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.08,
  shadowRadius: 22,
  elevation: 4
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.soft },
  screen: { flex: 1, backgroundColor: colors.soft },
  contentWithDock: { paddingHorizontal: 20, paddingBottom: 122 },
  initialContent: { padding: 20, paddingBottom: 38, alignItems: "center" },
  loadingOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: "rgba(2,17,38,0.82)", alignItems: "center", justifyContent: "center" },
  loadingText: { color: colors.white, fontWeight: "800", marginTop: 14 },
  routeSplash: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 26, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", gap: 18 },
  routeSplashLogo: { width: 230, height: 84 },
  errorBanner: { backgroundColor: "#FFF4D6", borderBottomWidth: 1, borderColor: colors.yellow, padding: 12, gap: 8 },
  errorText: { color: colors.navy, fontSize: 12 },
  errorButton: { alignSelf: "flex-start", backgroundColor: colors.navy, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  errorButtonText: { color: colors.white, fontWeight: "800", fontSize: 12 },
  logoPlate: { width: "100%", height: 76, borderRadius: 8, backgroundColor: colors.navy, paddingHorizontal: 26, justifyContent: "center", ...shadow },
  logoPlateCompact: { width: 220, height: 70 },
  logo: { width: "100%", height: "100%" },
  tagline: { marginVertical: 22, fontSize: 21, color: colors.ink },
  bold: { fontWeight: "800", color: colors.navy },
  yellowText: { color: colors.yellow, fontWeight: "800" },
  initialMediaFrame: { width: "100%", height: 312, borderRadius: 18, overflow: "hidden", backgroundColor: colors.white },
  initialImage: { width: "100%", height: "100%", backgroundColor: colors.white },
  welcomeSheet: { width: "100%", marginTop: -34, borderTopLeftRadius: 38, borderTopRightRadius: 38, backgroundColor: colors.white, padding: 28, alignItems: "center", ...shadow },
  welcomeTitle: { fontSize: 25, fontWeight: "900", color: colors.navy },
  centerMuted: { color: colors.muted, textAlign: "center", fontSize: 17, lineHeight: 25, marginVertical: 16 },
  slideTrack: { width: "100%", height: 64, borderRadius: 34, backgroundColor: colors.navy, justifyContent: "center", overflow: "hidden", paddingHorizontal: 8, marginTop: 4 },
  slideText: { color: colors.white, fontWeight: "800", fontSize: 15, textAlign: "center", paddingLeft: 50 },
  slideThumb: { position: "absolute", left: 7, width: 51, height: 51, borderRadius: 26, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  primaryDarkButton: { width: "100%", height: 64, borderRadius: 34, backgroundColor: colors.navy, paddingLeft: 26, paddingRight: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryDarkText: { color: colors.white, fontWeight: "800", fontSize: 18 },
  roundYellow: { width: 53, height: 53, borderRadius: 27, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  secondaryButton: { width: "100%", height: 62, borderRadius: 31, backgroundColor: colors.white, flexDirection: "row", gap: 16, alignItems: "center", justifyContent: "center", ...shadow },
  secondaryText: { color: colors.navy, fontWeight: "800", fontSize: 18 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.soft },
  iconButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  heroCard: { height: 285, overflow: "hidden", borderRadius: 25, backgroundColor: colors.white, ...shadow },
  heroImage: { width: "100%", height: "100%" },
  heroCta: { position: "absolute", right: 18, bottom: 20, borderRadius: 28, backgroundColor: colors.yellow, paddingVertical: 13, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  heroCtaText: { color: colors.navy, fontWeight: "800", fontSize: 15 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginVertical: 18 },
  dotActive: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#DADDE4" },
  dotLight: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.white },
  menuCard: { minHeight: 82, borderRadius: 18, backgroundColor: colors.white, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 16, ...shadow },
  menuIcon: { width: 54, height: 54, borderRadius: 14, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  menuTitle: { fontSize: 22, color: colors.navy, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  titleBlock: { marginTop: 14, marginBottom: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pageTitle: { fontSize: 35, color: colors.navy, fontWeight: "900", letterSpacing: 0 },
  pageSubtitle: { color: colors.muted, fontSize: 17, lineHeight: 25, marginTop: 4 },
  titleAccent: { width: 58, height: 3, backgroundColor: colors.yellow, borderRadius: 4, marginTop: 14 },
  badge: { backgroundColor: colors.yellow, color: colors.white, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14 },
  list: { gap: 12 },
  categoryCard: { width: "47.4%", height: 166, borderRadius: 12, backgroundColor: colors.white, overflow: "hidden", ...shadow },
  categoryImage: { width: "100%", height: "100%" },
  categoryFooter: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 50, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  categoryName: { fontSize: 17, color: colors.navy, fontWeight: "900" },
  searchRow: { flexDirection: "row", gap: 12 },
  searchBox: { flex: 1, height: 58, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 10, ...shadow },
  searchInput: { flex: 1, fontSize: 15, color: colors.navy },
  filterButton: { height: 58, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 8, ...shadow },
  filterText: { color: colors.navy, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 14 },
  chip: { borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 8, ...shadow },
  chipText: { color: colors.navy, fontWeight: "600" },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  segment: { flexDirection: "row", borderRadius: 22, backgroundColor: colors.white, padding: 4, ...shadow },
  segmentActive: { width: 42, height: 36, borderRadius: 18, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  segmentLight: { width: 42, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  productCard: { width: "47.4%", borderRadius: 12, backgroundColor: colors.white, overflow: "hidden", borderWidth: 1, borderColor: colors.line, ...shadow },
  productListCard: { width: "100%", borderRadius: 14, backgroundColor: colors.white, overflow: "hidden", borderWidth: 1, borderColor: colors.line, flexDirection: "row", ...shadow },
  promoCard: { borderColor: "#F4A7B1" },
  launchCard: { borderColor: colors.yellow },
  listImageWrap: { width: 132 },
  productImage: { width: "100%", height: 128, backgroundColor: colors.white },
  productListImage: { width: 132, height: "100%", backgroundColor: colors.white },
  ribbon: { position: "absolute", left: 8, top: 8, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, transform: [{ rotate: "-9deg" }] },
  ribbonText: { color: colors.white, fontWeight: "900", fontSize: 11 },
  productBody: { flex: 1, padding: 13 },
  productCode: { color: colors.navy, fontSize: 16, fontWeight: "900" },
  productName: { color: colors.muted, fontSize: 13, minHeight: 34, marginTop: 2 },
  cardLine: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  meta: { flexDirection: "row", gap: 8, marginBottom: 8 },
  metaLabel: { color: colors.navy, fontSize: 12, fontWeight: "800" },
  metaValue: { color: colors.navy, fontSize: 12 },
  price: { color: colors.red, fontWeight: "900", fontSize: 16 },
  loginHint: { color: colors.yellow, fontWeight: "900", marginTop: 4 },
  detailMedia: { height: 390, borderRadius: 22, overflow: "hidden", backgroundColor: colors.white, marginBottom: 20, ...shadow },
  detailImage: { width: "100%", height: "100%", backgroundColor: colors.white },
  dotsOverlay: { position: "absolute", bottom: 22, alignSelf: "center", flexDirection: "row", gap: 8 },
  smallYellow: { color: colors.yellow, fontWeight: "900", marginBottom: 6 },
  detailTitle: { color: colors.navy, fontSize: 27, fontWeight: "900", lineHeight: 34 },
  statRow: { flexDirection: "row", gap: 12, marginVertical: 20 },
  infoCard: { flex: 1, minHeight: 78, borderRadius: 14, backgroundColor: colors.white, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, ...shadow },
  infoValue: { color: colors.navy, fontSize: 18, fontWeight: "900" },
  greenText: { color: colors.green },
  accordion: { backgroundColor: colors.white, borderRadius: 15, padding: 16, marginBottom: 10, ...shadow },
  accordionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 16 },
  detailItem: { width: "50%", borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  detailSub: { color: colors.muted, fontSize: 13, marginTop: 10 },
  detailText: { color: colors.navy, fontSize: 14, lineHeight: 21, marginTop: 8 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  yellowButton: { minHeight: 58, borderRadius: 13, backgroundColor: colors.yellow, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  yellowButtonText: { color: colors.navy, fontWeight: "900", fontSize: 17 },
  whatsButton: { width: 58, height: 58, borderRadius: 14, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow },
  formCard: { backgroundColor: colors.white, borderRadius: 18, padding: 18, ...shadow },
  label: { color: colors.navy, fontWeight: "800", fontSize: 15, marginBottom: 8 },
  required: { color: colors.red },
  choiceRow: { flexDirection: "row", gap: 12, marginBottom: 18 },
  choice: { flex: 1, minHeight: 145, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", padding: 10 },
  choiceSelected: { borderColor: colors.yellow },
  choiceCheck: { position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  choiceTitle: { color: colors.navy, fontWeight: "900", marginTop: 12 },
  choiceSub: { color: colors.muted, textAlign: "center", fontSize: 12, lineHeight: 17, marginTop: 4 },
  inputGroup: { marginBottom: 14 },
  input: { height: 58, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  inputMultiline: { minHeight: 112, alignItems: "flex-start", paddingVertical: 12 },
  inputText: { flex: 1, color: colors.navy, fontSize: 15 },
  inputTextMultiline: { minHeight: 88, width: "100%" },
  textArea: { minHeight: 128, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, color: colors.navy, textAlignVertical: "top" },
  securityBox: { borderRadius: 13, backgroundColor: colors.soft, padding: 14, flexDirection: "row", gap: 12, alignItems: "center", marginVertical: 18 },
  mutedSmall: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  loginScreen: { flex: 1, backgroundColor: colors.navy },
  loginContent: { minHeight: "100%", paddingHorizontal: 24, paddingTop: 62, paddingBottom: 34, justifyContent: "center" },
  loginLogoButton: { alignSelf: "center", width: "78%", height: 86, marginBottom: 34, justifyContent: "center" },
  loginLogo: { width: "100%", height: "100%" },
  loginLabel: { color: colors.white, fontSize: 18, fontWeight: "800", marginBottom: 10, marginTop: 18 },
  darkInput: { height: 64, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 12 },
  darkInputText: { flex: 1, color: colors.white, fontSize: 17 },
  loginErrorBox: { width: "100%", borderRadius: 12, backgroundColor: "#FFE8EC", borderWidth: 1, borderColor: "#F6B4BE", padding: 12, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  loginErrorText: { color: colors.red, fontWeight: "800", flex: 1 },
  loginButton: { height: 64, borderRadius: 12, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", marginTop: 32 },
  loginButtonText: { color: colors.navy, fontSize: 21, fontWeight: "900" },
  forgotText: { color: colors.yellow, textAlign: "center", fontWeight: "800", fontSize: 16, marginTop: 20 },
  supportButton: { height: 60, borderRadius: 12, borderWidth: 1, borderColor: "#86C36C", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 12 },
  supportText: { color: colors.white, fontSize: 18, fontWeight: "800" },
  catalogBackButton: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, marginTop: 14 },
  catalogBackText: { color: colors.white, fontWeight: "800" },
  loginMuted: { color: "#AAB6C8", textAlign: "center", marginTop: 24, marginBottom: 14 },
  signupDarkButton: { height: 60, borderRadius: 12, borderWidth: 1, borderColor: colors.yellow, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 12 },
  signupDarkText: { color: colors.yellow, fontSize: 19, fontWeight: "900" },
  divider: { flexDirection: "row", alignItems: "center", gap: 14, width: "100%", marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#D6D8DE" },
  dividerLineDark: { backgroundColor: "rgba(255,255,255,0.18)" },
  dividerText: { color: colors.muted },
  dividerTextDark: { color: "#AAB6C8" },
  signupContent: { paddingHorizontal: 22, paddingBottom: 122 },
  checkRow: { flexDirection: "row", gap: 12, marginVertical: 12 },
  emptyCheck: { width: 28, height: 28, borderRadius: 5, borderWidth: 2, borderColor: colors.navy },
  checkText: { flex: 1, color: colors.navy, lineHeight: 22 },
  loginLink: { textAlign: "center", color: colors.navy, marginVertical: 16 },
  aboutCard: { minHeight: 520, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 22, ...shadow },
  aboutText: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  aboutBody: { color: colors.navy, fontSize: 16, lineHeight: 25, marginTop: 28 },
  socialDock: { position: "absolute", left: 32, right: 32, bottom: 22, height: 78, borderRadius: 38, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "space-around", ...shadow },
  socialItem: { alignItems: "center", gap: 4 },
  socialLabel: { color: colors.navy, fontSize: 12 },
  adminSafe: { flex: 1, backgroundColor: colors.navy },
  adminHeader: { height: 78, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  adminBack: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  adminLogo: { width: 174, height: 54 },
  adminHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  adminBadge: { borderRadius: 14, backgroundColor: colors.yellow, paddingHorizontal: 10, paddingVertical: 5 },
  adminBadgeText: { color: colors.navy, fontSize: 11, fontWeight: "900" },
  adminLogout: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  adminTabs: { maxHeight: 58 },
  adminTabsContent: { paddingHorizontal: 16, gap: 9 },
  adminTab: { height: 42, borderRadius: 21, paddingHorizontal: 16, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.09)" },
  adminTabActive: { backgroundColor: colors.yellow },
  adminTabText: { color: colors.white, fontWeight: "800" },
  adminTabTextActive: { color: colors.navy },
  adminBody: { flex: 1, backgroundColor: colors.soft, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  adminContent: { padding: 20, paddingBottom: 50 },
  adminTitle: { fontSize: 30, fontWeight: "900", color: colors.navy },
  adminSubtitle: { color: colors.muted, marginTop: 4, marginBottom: 16 },
  adminMetricGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  adminMetric: { width: "48%", minHeight: 120, borderRadius: 14, backgroundColor: colors.white, padding: 16, ...shadow },
  adminMetricValue: { color: colors.navy, fontSize: 28, fontWeight: "900", marginTop: 8 },
  adminMetricLabel: { color: colors.muted, marginTop: 4 },
  adminPanel: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginTop: 18, ...shadow },
  adminPanelTitle: { color: colors.navy, fontSize: 18, fontWeight: "900", marginBottom: 12 },
  shortcutGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  shortcut: { width: "48%", minHeight: 54, borderRadius: 12, backgroundColor: colors.soft, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  shortcutText: { color: colors.navy, fontWeight: "800" },
  adminActions: { flexDirection: "row", gap: 10, marginVertical: 16 },
  adminYellowButton: { height: 48, borderRadius: 12, backgroundColor: colors.yellow, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7 },
  adminYellowText: { color: colors.navy, fontWeight: "900" },
  adminSoftButton: { height: 48, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, ...shadow },
  adminSoftButtonWide: { minHeight: 48, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.line, ...shadow },
  uploadPreview: { width: "100%", height: 170, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, marginVertical: 10 },
  uploadEmpty: { width: "100%", minHeight: 92, borderRadius: 12, backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line, marginVertical: 10, alignItems: "center", justifyContent: "center", gap: 6 },
  adminListItem: { borderRadius: 15, backgroundColor: colors.white, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12, ...shadow },
  adminThumb: { width: 62, height: 62, borderRadius: 10 },
  adminItemTitle: { color: colors.navy, fontWeight: "900", fontSize: 15 },
  adminIconBox: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.yellow, fontWeight: "900", fontSize: 20 },
  permissionHeader: { flexDirection: "row", backgroundColor: colors.navy, borderRadius: 12, padding: 12, marginTop: 10 },
  permissionRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.white, borderRadius: 12, padding: 12, marginTop: 8, ...shadow },
  permissionField: { flex: 1.5, color: colors.navy, fontWeight: "800" },
  permissionRole: { flex: 0.5, color: colors.white, textAlign: "center", fontWeight: "900" },
  permissionCheck: { flex: 0.5, width: 24, height: 24, marginHorizontal: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  permissionCheckOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  leadCard: { borderRadius: 16, backgroundColor: colors.white, padding: 16, marginTop: 12, ...shadow },
  leadTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  leadStatus: { color: colors.navy, backgroundColor: colors.yellow, overflow: "hidden", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, fontWeight: "900" },
  whatsLead: { marginTop: 14, flexDirection: "row", gap: 8, alignItems: "center" },
  whatsLeadText: { color: colors.green, fontWeight: "900" },
  menuOverlay: { flex: 1 },
  sideMenu: { position: "absolute", left: 0, top: 0, bottom: 0, width: "82%", backgroundColor: colors.white, paddingBottom: 24 },
  sideHeader: { height: 145, backgroundColor: colors.navy, borderBottomRightRadius: 34, justifyContent: "center", paddingHorizontal: 26, borderBottomWidth: 4, borderBottomColor: colors.yellow },
  sideLogo: { width: "100%", height: 60 },
  sideUser: { marginHorizontal: 24, marginTop: 14, color: colors.muted, fontWeight: "800" },
  sideItem: { height: 58, marginHorizontal: 24, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 18 },
  sideLabel: { color: colors.navy, fontWeight: "900", fontSize: 17 },
  sidePromo: { margin: 24, height: 126, borderRadius: 14, backgroundColor: colors.navy, borderBottomWidth: 4, borderBottomColor: colors.yellow, justifyContent: "flex-end", padding: 18 },
  sidePromoText: { color: colors.white, fontWeight: "900", fontSize: 16, lineHeight: 23 },
  emptyState: { minHeight: 120, borderRadius: 16, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", gap: 10, padding: 18, ...shadow }
  ,
  sheetOverlay: { flex: 1, backgroundColor: "rgba(2,17,38,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.white, padding: 20, ...shadow },
  editorSheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "90%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.white },
  editorContent: { padding: 20, paddingBottom: 38 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sheetTitle: { color: colors.navy, fontSize: 22, fontWeight: "900" },
  sheetLabel: { color: colors.navy, fontWeight: "900", marginTop: 14, marginBottom: 8 },
  sheetOptions: { gap: 8, paddingRight: 20 },
  wrapOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  optionPill: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  optionPillSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  optionPillText: { color: colors.navy, fontWeight: "800" },
  optionPillTextSelected: { color: colors.white },
  brandedMedia: { width: "100%", height: "100%", minHeight: 128, alignItems: "center", justifyContent: "center", padding: 16 },
  brandedMediaTall: { minHeight: 390 },
  brandedMediaCompact: { width: 132, minHeight: 132 },
  brandedMediaLogo: { width: "72%", height: 54, marginBottom: 10 },
  brandedMediaTitle: { color: colors.white, fontWeight: "900", fontSize: 18, textAlign: "center" },
  brandedMediaSub: { color: "#D9E2F2", fontSize: 12, marginTop: 4, textAlign: "center" },
  adminThumbPlaceholder: { width: 62, height: 62, borderRadius: 10, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  editorSwitch: { height: 48, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }
});
