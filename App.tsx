import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

import { CONFIG_STORAGE_KEY, getPersistedSession, signInWithPassword, signOutSession, signUpRegistration, supabaseDelete, supabaseGet, supabasePatch, supabasePost, supabasePostMinimal, supabaseRealtime, supabaseRpc, trackTelemetry, uploadStorageObject } from "./src/api/supabase";
import { colors, defaultAbout, defaultSocialLinks } from "./src/config/brand";
import type { AboutSettings, Aplicacao, AppData, CatalogAppearance, CatalogPdfRole, CatalogPdfSettings, Categoria, Lead, Marca, MediaSettings, ModeloVeiculo, Montadora, Permission, Produto, ProdutoModeloVeiculo, ProdutoModeloVeiculoView, Role, Route, SocialLinks, Usuario } from "./src/types/domain";
import { createId, csvEscape, leadDepartment, leadMessageBody, loginErrorMessage, money, optimizedImageUrl, parseCsv, slugify } from "./src/utils/helpers";

type IconName = keyof typeof Ionicons.glyphMap;
type RegistrationRequest = { nome: string; empresa: string; telefone: string; email: string; cnpj: string; observacoes: string; senha: string; confirmarSenha: string };
type CachedImageProps = ImageProps & { resizeMode?: ImageProps["contentFit"] };

const logo = require("./assets/briland-logo.png");
const loadingBlueprint = require("./assets/loading-automotive-blueprint.png");
const PRIVACY_POLICY_URL = "https://briland-catalogo.vercel.app/privacidade.html";
const ACCOUNT_DELETION_URL = "https://briland-catalogo.vercel.app/excluir-conta.html";
function initialAppRoute(): Route {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const action = new URL(window.location.href).searchParams.get("acao");
    if (action === "excluir-conta") return "accountDeletion";
    if (action === "privacidade") return "privacy";
    if (action === "login") return "login";
  }
  return "initial";
}
const defaultAppearance: CatalogAppearance = { version: 1, primaryColor: "#021126", accentColor: "#FCB900", backgroundColor: "#F4F6FA", surfaceColor: "#FFFFFF", textColor: "#021126", fontFamily: "system", cardRadius: 12, dockOpacity: 72, dockHeight: 62, dockPosition: "bottom", showProductCategory: true, showProductBrand: true, logoUrl: "" };
function safeAppearance(value?: Partial<CatalogAppearance> | null): CatalogAppearance {
  const merged = { ...defaultAppearance, ...(value || {}) };
  const color = (candidate: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
  return { ...merged, primaryColor: color(merged.primaryColor, defaultAppearance.primaryColor), accentColor: color(merged.accentColor, defaultAppearance.accentColor), backgroundColor: color(merged.backgroundColor, defaultAppearance.backgroundColor), surfaceColor: color(merged.surfaceColor, defaultAppearance.surfaceColor), textColor: color(merged.textColor, defaultAppearance.textColor), cardRadius: Math.min(32, Math.max(0, Number(merged.cardRadius) || 0)), dockOpacity: Math.min(100, Math.max(35, Number(merged.dockOpacity) || 72)), dockHeight: Math.min(90, Math.max(52, Number(merged.dockHeight) || 62)), dockPosition: merged.dockPosition === "top" ? "top" : "bottom", logoUrl: String(merged.logoUrl || "").slice(0, 1000) };
}

function Image({ resizeMode, contentFit, transition = 160, cachePolicy = "memory-disk", ...props }: CachedImageProps) {
  return <ExpoImage {...props} contentFit={contentFit ?? resizeMode ?? "cover"} transition={transition} cachePolicy={cachePolicy} />;
}

function liveImageUrl(url: string | null | undefined, options: Parameters<typeof optimizedImageUrl>[1], version: number) {
  return optimizedImageUrl(url, options ? { ...options, version } : options);
}

function versionedRawUrl(url: string | null | undefined, version: number) {
  if (!url) return "";
  if (!version) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("_v", String(version));
    return parsed.toString();
  } catch {
    return url;
  }
}

const imageSize = {
  home: { width: 960, height: 610, resize: "cover", quality: 78 } as const,
  category: { width: 480, height: 360, resize: "cover", quality: 72 } as const,
  categoryIcon: { width: 256, height: 256, resize: "contain", quality: 70 } as const,
  productCard: { width: 640, height: 480, resize: "contain", quality: 82 } as const,
  productDetail: { width: 1600, height: 1200, resize: "contain", quality: 92 } as const,
  thumb: { width: 360, height: 280, resize: "contain", quality: 84 } as const
};

function productImageUrl(product: Produto, variant: "card" | "detail" | "thumb", version: number) {
  const permanent = variant === "detail" ? product.imagemDetalhe : product.imagemCard;
  if (permanent) return versionedRawUrl(permanent, version);
  const fallbackSize = variant === "detail" ? imageSize.productDetail : variant === "thumb" ? imageSize.thumb : imageSize.productCard;
  return liveImageUrl(product.imagemPrincipal, fallbackSize, version);
}

const realtimeCatalogTables = [
  "Produto",
  "Categoria",
  "Marca",
  "Aplicacao",
  "Montadora",
  "ModeloVeiculo",
  "ProdutoModeloVeiculo",
  "ProdutoAplicacao",
  "ProductFieldPermission",
  "AppSetting"
] as const;

const userSelect = "id,name,company,email,role,status,notes,phone,cnpj,address,city,state,registrationNotes,approvedAt,approvedBy,lastLoginAt,createdAt,updatedAt,authUserId";
function notify(title: string, message: string) {
  Alert.alert(title, message);
}

const isAdminRole = (value: Role) => value === "ADMIN_MASTER" || value === "ADMIN_COLABORADOR" || value === "ADMIN";
const isMasterRole = (value: Role) => value === "ADMIN_MASTER" || value === "ADMIN";
const catalogPdfRoleFor = (value: Role): CatalogPdfRole => {
  if (value === "NAO_CLIENTE" || value === "CLIENTE" || value === "REPRESENTANTE") return value;
  if (value === "VISITANTE") return "VISITANTE";
  return "REPRESENTANTE";
};

export default function App() {
  const [route, setRoute] = useState<Route>(initialAppRoute);
  const [routeHistory, setRouteHistory] = useState<Route[]>([]);
  const [role, setRole] = useState<Role>("VISITANTE");
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [authToken, setAuthToken] = useState<string | undefined>();
  const [loginMessage, setLoginMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [montadoraFilter, setMontadoraFilter] = useState<string | null>(null);
  const [modeloFilter, setModeloFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"order" | "name" | "newest">("order");
  const [listMode, setListMode] = useState<"grid" | "list">("grid");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Produto | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(defaultSocialLinks);
  const [mediaSettings, setMediaSettings] = useState<MediaSettings>({ initialImage: "", homeImage: "" });
  const [catalogPdfSettings, setCatalogPdfSettings] = useState<CatalogPdfSettings>({});
  const [aboutSettings, setAboutSettings] = useState<AboutSettings>(defaultAbout);
  const [appearance, setAppearance] = useState<CatalogAppearance>(defaultAppearance);
  const [loading, setLoading] = useState(true);
  const [imageRefreshVersion, setImageRefreshVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const initialLoadCompleted = useRef(false);
  const realtimeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalogScrollOffsets = useRef<Record<"products" | "promotions" | "launches", number>>({ products: 0, promotions: 0, launches: 0 });
  const appState = useRef(AppState.currentState);
  const [data, setData] = useState<AppData>({
    produtos: [],
    categorias: [],
    marcas: [],
    aplicacoes: [],
    montadoras: [],
    modelosVeiculo: [],
    produtoModelosVeiculo: [],
    usuarios: [],
    leads: [],
    permissoes: []
  });

  const reload = async (nextRole = role, token = authToken, options?: { silent?: boolean; refreshImages?: boolean }) => {
    const startedAt = Date.now();
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const isPanelRole = isAdminRole(nextRole);
      const [produtos, categorias, marcas, aplicacoes, montadoras, modelosVeiculo, produtoModelosVeiculo, appSettings] = await Promise.all([
        supabaseRpc<Produto[]>("get_visible_products", { requested_role: nextRole }, token),
        supabaseGet<Categoria>("Categoria", "select=*&order=ordem.asc", token),
        supabaseGet<Marca>("Marca", "select=*", token),
        supabaseGet<Aplicacao>("Aplicacao", "select=*", token),
        supabaseGet<Montadora>("Montadora", "select=*&order=nome.asc", token),
        supabaseGet<ModeloVeiculo>("ModeloVeiculo", "select=*&order=nome.asc", token),
        supabaseRpc<ProdutoModeloVeiculoView[]>("get_visible_vehicle_applications", {}, token),
        supabaseRpc<Record<string, unknown>>("get_app_settings", {}, token)
      ]);
      const [usuarios, leads, permissoes] = isPanelRole
        ? await Promise.all([
            supabaseGet<Usuario>("User", `select=${userSelect}`, token),
            supabaseGet<Lead>("LeadOrcamento", "select=*&order=createdAt.desc&limit=80", token),
            supabaseGet<Permission>("ProductFieldPermission", "select=*&order=fieldLabel.asc", token)
          ])
        : [[], [], []] as [Usuario[], Lead[], Permission[]];

      const settings = appSettings as { media?: MediaSettings; socialLinks?: SocialLinks; about?: AboutSettings; catalogPdf?: CatalogPdfSettings; catalogAppearance?: CatalogAppearance };
      if (settings.socialLinks) setSocialLinks({ ...defaultSocialLinks, ...settings.socialLinks });
      if (settings.media) setMediaSettings({ initialImage: settings.media.initialImage || "", homeImage: settings.media.homeImage || "" });
      if (settings.catalogPdf) setCatalogPdfSettings(settings.catalogPdf);
      if (settings.about) setAboutSettings({ ...defaultAbout, ...settings.about });
      setAppearance(safeAppearance(settings.catalogAppearance));

      setData({
        produtos,
        categorias,
        marcas,
        aplicacoes,
        montadoras,
        modelosVeiculo,
        produtoModelosVeiculo,
        usuarios,
        leads,
        permissoes
      });
      setSelectedProduct((current) => current ? produtos.find((product) => product.id === current.id) ?? null : produtos[0] ?? null);
      void trackTelemetry({
        eventType: "load_time",
        screen: route,
        route,
        userId: currentUser?.id ?? null,
        userRole: nextRole,
        durationMs: Date.now() - startedAt,
        success: true,
        metadata: { products: produtos.length, categories: categorias.length }
      }, token);
      if (options?.refreshImages) setImageRefreshVersion(Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar dados do catálogo.";
      setError(message);
      void trackTelemetry({
        eventType: "api_error",
        screen: route,
        route,
        userId: currentUser?.id ?? null,
        userRole: nextRole,
        durationMs: Date.now() - startedAt,
        success: false,
        message
      }, token);
    } finally {
      if (!options?.silent) {
        if (!initialLoadCompleted.current) {
          const remainingIntroTime = Math.max(0, 1000 - (Date.now() - startedAt));
          if (remainingIntroTime > 0) await new Promise((resolve) => setTimeout(resolve, remainingIntroTime));
          initialLoadCompleted.current = true;
        }
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    const restoreLogin = async () => {
      try {
        const session = await getPersistedSession();
        if (session) {
          const users = await supabaseGet<Usuario>("User", `select=${userSelect}&authUserId=eq.${session.user.id}`, session.access_token);
          const user = users[0];
          if (user && user.status === "ACTIVE") {
            if (!active) return;
            setAuthToken(session.access_token);
            setCurrentUser(user);
            setRole(user.role);
            await reload(user.role, session.access_token);
            if (active && initialAppRoute() === "initial") setRoute(isAdminRole(user.role) ? "admin" : "products");
            return;
          }
          await signOutSession();
        }
      } catch {
        // Mantém a sessão armazenada para uma nova tentativa se a rede estiver indisponível.
      }
      if (active) await reload("VISITANTE", undefined);
    };
    void restoreLogin();
    void AsyncStorage.getItem(CONFIG_STORAGE_KEY).then((stored) => {
      if (!stored) return;
      const parsed = JSON.parse(stored) as { socialLinks?: SocialLinks; aboutSettings?: AboutSettings };
      if (parsed.socialLinks) setSocialLinks(parsed.socialLinks);
      if (parsed.aboutSettings) setAboutSettings({ ...defaultAbout, ...parsed.aboutSettings });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabaseRealtime.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) setAuthToken(session.access_token);
      if (event === "SIGNED_OUT") setAuthToken(undefined);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authToken) supabaseRealtime.realtime.setAuth(authToken);

    const scheduleRealtimeReload = () => {
      if (realtimeReloadTimer.current) clearTimeout(realtimeReloadTimer.current);
      realtimeReloadTimer.current = setTimeout(() => {
        void reload(role, authToken, { silent: true });
      }, 800);
    };

    const channel = supabaseRealtime.channel(`catalog-live-${role}`);
    realtimeCatalogTables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRealtimeReload);
    });
    void channel.subscribe();

    return () => {
      if (realtimeReloadTimer.current) clearTimeout(realtimeReloadTimer.current);
      void supabaseRealtime.removeChannel(channel);
    };
  }, [authToken, role]);

  useEffect(() => {
    if (Platform.OS !== "web" && appState.current === "active") supabaseRealtime.auth.startAutoRefresh();
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasInBackground = appState.current === "inactive" || appState.current === "background";
      appState.current = nextState;
      if (Platform.OS !== "web") {
        if (nextState === "active") supabaseRealtime.auth.startAutoRefresh();
        else supabaseRealtime.auth.stopAutoRefresh();
      }
      if (wasInBackground && nextState === "active") {
        void reload(role, authToken, { silent: true });
      }
    });
    return () => {
      subscription.remove();
      if (Platform.OS !== "web") supabaseRealtime.auth.stopAutoRefresh();
    };
  }, [authToken, role]);

  useEffect(() => {
    const urls = [
      versionedRawUrl(mediaSettings.initialImage, imageRefreshVersion),
      optimizedImageUrl(mediaSettings.homeImage, { ...imageSize.home, version: imageRefreshVersion }),
      ...data.categorias.slice(0, 4).map((item) => optimizedImageUrl(item.imagem, { ...imageSize.categoryIcon, version: imageRefreshVersion })),
      ...data.produtos.slice(0, 4).map((item) => productImageUrl(item, "card", imageRefreshVersion))
    ].filter(Boolean);
    if (urls.length) void ExpoImage.prefetch(urls);
  }, [data.categorias, data.produtos, imageRefreshVersion, mediaSettings.homeImage, mediaSettings.initialImage]);

  useEffect(() => {
    void trackTelemetry({
      eventType: "screen_view",
      screen: route,
      route,
      userId: currentUser?.id ?? null,
      userRole: role,
      success: true
    }, authToken);
  }, [authToken, currentUser?.id, role, route]);

  const saveAdminConfig = async (nextSocialLinks = socialLinks, nextMediaSettings = mediaSettings, nextAboutSettings = aboutSettings) => {
    setSocialLinks(nextSocialLinks);
    setMediaSettings(nextMediaSettings);
    setAboutSettings(nextAboutSettings);
    if (authToken && isMasterRole(role)) {
      await Promise.all([
        supabaseRpc("save_app_setting", { setting_key: "socialLinks", setting_value: nextSocialLinks }, authToken),
        supabaseRpc("save_app_setting", { setting_key: "media", setting_value: nextMediaSettings }, authToken),
        supabaseRpc("save_app_setting", { setting_key: "about", setting_value: nextAboutSettings }, authToken)
      ]);
    }
    await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ socialLinks: nextSocialLinks, aboutSettings: nextAboutSettings }));
  };

  const activeProducts = useMemo(() => data.produtos.filter((item) => item.ativo !== false), [data.produtos]);
  const catalogPdfRole = catalogPdfRoleFor(role);
  const catalogPdfUrl = catalogPdfSettings[catalogPdfRole]?.url || "";
  const catalogPdfAllowed = Boolean(catalogPdfUrl) && (activeProducts[0]?.permissoesProduto?.catalogPdfDownload ?? role !== "VISITANTE");
  const categoryById = useMemo(() => new Map(data.categorias.map((item) => [item.id, item])), [data.categorias]);
  const brandById = useMemo(() => new Map(data.marcas.map((item) => [item.id, item])), [data.marcas]);
  const montadoraById = useMemo(() => new Map(data.montadoras.map((item) => [item.id, item])), [data.montadoras]);
  const modeloById = useMemo(() => new Map(data.modelosVeiculo.map((item) => [item.id, item])), [data.modelosVeiculo]);
  const vehicleApplicationsByProduct = useMemo(() => {
    const map = new Map<string, ProdutoModeloVeiculoView[]>();
    for (const link of data.produtoModelosVeiculo) {
      const montadora = montadoraById.get(link.montadoraId);
      const modelo = modeloById.get(link.modeloId);
      const view: ProdutoModeloVeiculoView = {
        ...link,
        montadoraNome: montadora?.nome,
        montadoraSlug: montadora?.slug,
        modeloNome: modelo?.nome,
        modeloSlug: modelo?.slug
      };
      map.set(link.produtoId, [...(map.get(link.produtoId) || []), view]);
    }
    return map;
  }, [data.produtoModelosVeiculo, montadoraById, modeloById]);
  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = activeProducts.filter((item) => {
      const categoria = categoryById.get(item.categoriaId ?? "")?.nome ?? "";
      const marca = brandById.get(item.marcaId ?? "")?.nome ?? "";
      const vehicleApplications = vehicleApplicationsByProduct.get(item.id) || item.aplicacoesVeiculo || [];
      const vehicleText = vehicleApplications.map((app) => `${app.montadoraNome || ""} ${app.modeloNome || ""}`).join(" ");
      const text = [item.nome, item.codigoInterno, item.descricaoCurta, item.ean, item.ncm, categoria, marca, vehicleText].join(" ").toLowerCase();
      const vehicleOk =
        (!montadoraFilter && !modeloFilter) ||
        vehicleApplications.some((app) =>
          (!montadoraFilter || app.montadoraId === montadoraFilter) &&
          (!modeloFilter || app.modeloId === modeloFilter)
        );
      return (!q || text.includes(q)) && (!categoryFilter || item.categoriaId === categoryFilter) && (!brandFilter || item.marcaId === brandFilter) && vehicleOk;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "name") return a.nome.localeCompare(b.nome);
      if (sortMode === "newest") return String(b.createdAt).localeCompare(String(a.createdAt));
      return (a.ordem ?? 0) - (b.ordem ?? 0);
    });
  }, [activeProducts, query, categoryFilter, brandFilter, montadoraFilter, modeloFilter, sortMode, categoryById, brandById, vehicleApplicationsByProduct]);

  const transitionTo = (next: Route) => {
    if (next === route) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(false);
    setRoute(next);
  };

  const go = (next: Route, options?: { replace?: boolean; resetHistory?: boolean }) => {
    if (next === route) {
      setMenuOpen(false);
      return;
    }
    setRouteHistory((history) => {
      if (options?.resetHistory) return [];
      if (options?.replace) return history;
      return [...history, route];
    });
    transitionTo(next);
  };

  const clearCatalogFilters = () => {
    setQuery("");
    setCategoryFilter(null);
    setBrandFilter(null);
    setMontadoraFilter(null);
    setModeloFilter(null);
    setSortMode("order");
  };

  const openDirectCatalogRoute = (target: Route) => {
    if (target === "products" || target === "promotions" || target === "launches") clearCatalogFilters();
    go(target);
  };

  const goBack = () => {
    const previous = routeHistory[routeHistory.length - 1] || "home";
    setRouteHistory((history) => history.slice(0, -1));
    transitionTo(previous);
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
      if (!user || user.status !== "ACTIVE") {
        await signOutSession();
        if (!user) throw new Error("Usuário Auth sem vínculo na tabela User.");
        if (user.status === "PENDING") throw new Error("Seu cadastro ainda está aguardando aprovação.");
        throw new Error("Este usuário está inativo.");
      }
      setAuthToken(session.access_token);
      setCurrentUser(user);
      setRole(user.role);
      await reload(user.role, session.access_token);
      setRoute(isAdminRole(user.role) ? "admin" : "products");
      void trackTelemetry({
        eventType: "login",
        screen: "login",
        route: "login",
        userId: user.id,
        userRole: user.role,
        success: true
      }, session.access_token);
    } catch (err) {
      const message = loginErrorMessage(err);
      setLoginMessage(message);
      notify("Falha no login", message);
      void trackTelemetry({
        eventType: "login",
        screen: "login",
        route: "login",
        success: false,
        message
      });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOutSession();
    } catch {
      // A limpeza local abaixo mantém a saída funcional mesmo sem conexão.
    }
    setAuthToken(undefined);
    setCurrentUser(null);
    setRole("VISITANTE");
    setLoginMessage("");
    go("initial");
  };

  const createLead = async (payload: Partial<Lead>) => {
    try {
      await supabasePostMinimal("LeadOrcamento", {
        id: createId("lead"),
        nome: payload.nome || currentUser?.name || "Visitante Briland",
        empresa: payload.empresa || currentUser?.company || "Não informado",
        telefone: payload.telefone || "5521973636891",
        email: payload.email || currentUser?.email || "catalogo@briland.com.br",
        cidade: payload.cidade || "Não informado",
        estado: payload.estado || "NA",
        produtoId: payload.produtoId ?? null,
        mensagem: payload.mensagem || "Solicitação enviada pelo app Briland.",
        origem: payload.origem || "app-mobile",
        status: "NOVO"
      });
      notify("Solicitação enviada", "Recebemos sua mensagem no painel de leads.");
      void reload();
    } catch (err) {
      notify("Não foi possível salvar", err instanceof Error ? err.message : "Verifique as permissões RLS da tabela LeadOrcamento.");
    }
  };

  const requestRegistration = async (payload: RegistrationRequest) => {
    try {
      await signUpRegistration(payload);
      notify("Cadastro recebido", "Confirme o e-mail enviado para você e aguarde a aprovação da equipe Briland.");
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const normalized = raw.toLowerCase();
      const duplicate = normalized.includes("already") || normalized.includes("já possui") || normalized.includes("database error saving new user");
      notify("Não foi possível cadastrar", duplicate ? "Este e-mail já possui conta ou solicitação em análise." : raw);
      return false;
    }
  };

  const requestAccountDeletion = async (email: string, reason: string) => {
    try {
      await supabaseRpc<{ accepted: boolean; message?: string }>("request_account_deletion", {
        p_email: email.trim().toLowerCase(),
        p_reason: reason.trim() || "Solicitação enviada pelo aplicativo Briland."
      }, authToken);
      if (currentUser) {
        try { await signOutSession(); } catch { /* A solicitação já foi registrada. */ }
        setAuthToken(undefined);
        setCurrentUser(null);
        setRole("VISITANTE");
      }
      notify("Solicitação recebida", currentUser ? "O acesso foi desativado e a exclusão dos dados será concluída em até 30 dias." : "A equipe confirmará a identidade antes de concluir a exclusão em até 30 dias.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível registrar a solicitação.";
      notify("Falha na solicitação", message);
      throw err;
    }
  };

  const previousRoute = routeHistory[routeHistory.length - 1];
  const retainedCatalogRoute = route === "products" || route === "promotions" || route === "launches"
    ? route
    : route === "detail" && (previousRoute === "products" || previousRoute === "promotions" || previousRoute === "launches")
      ? previousRoute
      : null;
  const pageTransitionKey = route === "detail" && retainedCatalogRoute ? retainedCatalogRoute : route;

  return (
    <View style={[styles.appRoot, { backgroundColor: appearance.backgroundColor }]}>
      <StatusBar hidden={route === "initial" && !loading} style={loading || route === "login" || route === "admin" ? "light" : "dark"} />
      {loading && <LoadingOverlay />}
      <PageTransition key={pageTransitionKey}>
        {route === "initial" ? (
          <InitialScreen media={mediaSettings} imageVersion={imageRefreshVersion} onCatalog={() => go("home")} onLogin={() => go("login")} />
        ) : (
        <SafeAreaView style={[styles.safe, { backgroundColor: appearance.backgroundColor }]}>
          {route === "login" ? (
            <LoginScreen onLogin={login} onSignup={() => go("signup")} onCatalog={() => go("initial")} onPrivacy={() => go("privacy")} onDelete={() => go("accountDeletion")} links={socialLinks} error={loginMessage} />
          ) : route === "admin" ? (
            <AdminScreen role={role} data={data} active={adminTab} setActive={setAdminTab} onBack={() => go("home")} onLogout={logout} reload={() => reload(role, authToken)} authToken={authToken} socialLinks={socialLinks} setSocialLinks={(links) => void saveAdminConfig(links, mediaSettings, aboutSettings)} mediaSettings={mediaSettings} setMediaSettings={(settings) => void saveAdminConfig(socialLinks, settings, aboutSettings)} aboutSettings={aboutSettings} setAboutSettings={(settings) => void saveAdminConfig(socialLinks, mediaSettings, settings)} onAction={(text) => notify("Painel admin", text)} />
          ) : (
            <>
              <Header back={route !== "home"} onBack={goBack} onMenu={() => setMenuOpen(true)} whatsappUrl={socialLinks.whatsapp} appearance={appearance} />
              {error && <ErrorBanner message={error} onRetry={reload} />}
              {route === "home" && <HomeScreen go={openDirectCatalogRoute} products={activeProducts} categories={data.categorias} montadoras={data.montadoras} media={mediaSettings} catalogPdfUrl={catalogPdfAllowed ? catalogPdfUrl : ""} imageVersion={imageRefreshVersion} />}
              {route === "categories" && <CategoriesScreen categories={data.categorias} imageVersion={imageRefreshVersion} onPick={(id) => { clearCatalogFilters(); setCategoryFilter(id); go("products"); }} />}
              {route === "vehicleBrands" && <VehicleBrandsScreen montadoras={data.montadoras} applications={data.produtoModelosVeiculo} imageVersion={imageRefreshVersion} onPick={(id) => { clearCatalogFilters(); setMontadoraFilter(id); go("products"); }} />}
              {retainedCatalogRoute && (
                <View style={styles.catalogStage}>
              {retainedCatalogRoute === "products" && (
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
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  sortMode={sortMode}
                  setSortMode={setSortMode}
                  brands={data.marcas}
                  montadoras={data.montadoras}
                  modelosVeiculo={data.modelosVeiculo}
                  filterOpen={filterOpen}
                  setFilterOpen={setFilterOpen}
                  listMode={listMode}
                  setListMode={setListMode}
                  onOpen={openProduct}
                  role={role}
                  catalogPdfUrl={catalogPdfAllowed ? catalogPdfUrl : ""}
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                  savedScrollOffset={catalogScrollOffsets.current.products}
                  onScrollOffset={(offset) => { catalogScrollOffsets.current.products = offset; }}
                />
              )}
              {retainedCatalogRoute === "promotions" && (
                <ProductList
                  title="Promoções"
                  subtitle="Ofertas selecionadas pela equipe Briland."
                  products={filteredProducts.filter((item) => item.promocao)}
                  allCategories={data.categorias}
                  categoryById={categoryById}
                  brandById={brandById}
                  query={query}
                  setQuery={setQuery}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  brandFilter={brandFilter}
                  setBrandFilter={setBrandFilter}
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  sortMode={sortMode}
                  setSortMode={setSortMode}
                  brands={data.marcas}
                  montadoras={data.montadoras}
                  modelosVeiculo={data.modelosVeiculo}
                  filterOpen={filterOpen}
                  setFilterOpen={setFilterOpen}
                  listMode={listMode}
                  setListMode={setListMode}
                  onOpen={openProduct}
                  role={role}
                  catalogPdfUrl={catalogPdfAllowed ? catalogPdfUrl : ""}
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                  savedScrollOffset={catalogScrollOffsets.current.promotions}
                  onScrollOffset={(offset) => { catalogScrollOffsets.current.promotions = offset; }}
                  promo
                />
              )}
              {retainedCatalogRoute === "launches" && (
                <ProductList
                  title="Lançamentos"
                  subtitle="Novidades selecionadas pela equipe Briland."
                  products={filteredProducts.filter((item) => item.lancamento).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))}
                  allCategories={data.categorias}
                  categoryById={categoryById}
                  brandById={brandById}
                  query={query}
                  setQuery={setQuery}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  brandFilter={brandFilter}
                  setBrandFilter={setBrandFilter}
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  sortMode={sortMode}
                  setSortMode={setSortMode}
                  brands={data.marcas}
                  montadoras={data.montadoras}
                  modelosVeiculo={data.modelosVeiculo}
                  filterOpen={filterOpen}
                  setFilterOpen={setFilterOpen}
                  listMode={listMode}
                  setListMode={setListMode}
                  onOpen={openProduct}
                  role={role}
                  catalogPdfUrl={catalogPdfAllowed ? catalogPdfUrl : ""}
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                  savedScrollOffset={catalogScrollOffsets.current.launches}
                  onScrollOffset={(offset) => { catalogScrollOffsets.current.launches = offset; }}
                  launch
                />
              )}
              {route === "detail" && selectedProduct && <View style={[styles.detailOverlay, { backgroundColor: appearance.backgroundColor }]}><ProductDetail product={selectedProduct} role={role} category={categoryById.get(selectedProduct.categoriaId ?? "")} brand={brandById.get(selectedProduct.marcaId ?? "")} vehicleApplications={vehicleApplicationsByProduct.get(selectedProduct.id) || selectedProduct.aplicacoesVeiculo || []} whatsappUrl={socialLinks.whatsapp} imageVersion={imageRefreshVersion} onQuote={() => createLead({ produtoId: selectedProduct.id, mensagem: `Tenho interesse no produto ${selectedProduct.codigoInterno} - ${selectedProduct.nome}.`, origem: "produto" })} /></View>}
                </View>
              )}
              {route === "detail" && !retainedCatalogRoute && selectedProduct && <ProductDetail product={selectedProduct} role={role} category={categoryById.get(selectedProduct.categoriaId ?? "")} brand={brandById.get(selectedProduct.marcaId ?? "")} vehicleApplications={vehicleApplicationsByProduct.get(selectedProduct.id) || selectedProduct.aplicacoesVeiculo || []} whatsappUrl={socialLinks.whatsapp} imageVersion={imageRefreshVersion} onQuote={() => createLead({ produtoId: selectedProduct.id, mensagem: `Tenho interesse no produto ${selectedProduct.codigoInterno} - ${selectedProduct.nome}.`, origem: "produto" })} />}
              {route === "contact" && <ContactScreen onSubmit={createLead} />}
              {route === "about" && <AboutScreen settings={aboutSettings} />}
              {route === "privacy" && <PrivacyScreen />}
              {route === "accountDeletion" && <AccountDeletionScreen initialEmail={currentUser?.email || ""} onSubmit={requestAccountDeletion} />}
              {route === "signup" && <SignupScreen onSubmit={requestRegistration} onLogin={() => go("login")} onPrivacy={() => go("privacy")} onDelete={() => go("accountDeletion")} />}
            </>
          )}
        </SafeAreaView>
        )}
      </PageTransition>
      <SideMenu visible={menuOpen} role={role} user={currentUser} links={socialLinks} onClose={() => setMenuOpen(false)} go={openDirectCatalogRoute} onLogout={() => void logout()} />
    </View>
  );
}

function LoadingOverlay() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 750, easing: Easing.in(Easing.quad), useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <View style={styles.loadingOverlay} accessibilityRole="progressbar" accessibilityLabel="Carregando o catálogo Briland">
      <ExpoImage source={loadingBlueprint} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      <View style={styles.loadingCenter}>
        <ExpoImage source={logo} style={styles.loadingLogo} contentFit="contain" />
        <Text style={styles.loadingTitle}>Seu catálogo está a caminho</Text>
        <Text style={styles.loadingText}>Carregando produtos e aplicações...</Text>
      </View>

      <View style={styles.loadingRoute} accessibilityElementsHidden>
        <View style={styles.loadingRouteStart} />
        <View style={styles.loadingRouteDown} />
        <View style={styles.loadingRouteMiddle} />
        <View style={styles.loadingRouteUp} />
        <View style={styles.loadingRouteEnd} />
        <Animated.View
          style={[
            styles.loadingRouteGlow,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0.9] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] }) }]
            }
          ]}
        />
        <View style={styles.loadingRouteDot} />
      </View>

      <View style={styles.loadingFooter}>
        <Text style={styles.loadingFooterText}>Produtos</Text>
        <View style={styles.loadingFooterDot} />
        <Text style={styles.loadingFooterText}>Aplicações</Text>
        <View style={styles.loadingFooterDot} />
        <Text style={styles.loadingFooterText}>Novidades</Text>
      </View>
    </View>
  );
}

function PageTransition({ children }: { children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [progress]);
  return (
    <Animated.View style={[styles.pageTransition, {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }]
    }]}>
      {children}
    </Animated.View>
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

function Header({ back, onBack, onMenu, whatsappUrl, appearance }: { back?: boolean; onBack: () => void; onMenu: () => void; whatsappUrl: string; appearance: CatalogAppearance }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.iconButton} onPress={back ? onBack : onMenu}>
        <Ionicons name={back ? "chevron-back" : "menu"} size={28} color={colors.navy} />
      </Pressable>
      <LogoPlate compact logoUrl={appearance.logoUrl} />
      <Pressable style={styles.iconButton} onPress={() => Linking.openURL(whatsappUrl)}>
        <Ionicons name="logo-whatsapp" size={25} color={colors.navy} />
      </Pressable>
    </View>
  );
}

function LogoPlate({ compact = false, logoUrl }: { compact?: boolean; logoUrl?: string }) {
  return (
    <View style={[styles.logoPlate, compact && styles.logoPlateCompact]}>
      <Image source={logoUrl ? { uri: logoUrl } : logo} style={styles.logo} resizeMode="contain" />
    </View>
  );
}

function InitialScreen({ media, imageVersion, onCatalog, onLogin }: { media: MediaSettings; imageVersion: number; onCatalog: () => void; onLogin: () => void }) {
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const roomy = height > 890;
  return (
    <View style={styles.initialScreen}>
      {media.initialImage ? (
        <Image source={{ uri: versionedRawUrl(media.initialImage, imageVersion) }} style={styles.initialBackgroundImage} resizeMode="cover" />
      ) : (
        <View style={styles.initialFallback}>
          <BrandedMedia title="Imagem inicial" subtitle="Recomendado 1080 x 1920 px" />
        </View>
      )}
      <LinearGradient colors={["rgba(255,255,255,0.02)", "rgba(255,255,255,0.02)", "rgba(2,17,38,0.26)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.welcomeSheet, compact && styles.welcomeSheetCompact, roomy && styles.welcomeSheetRoomy]}>
        <Text style={[styles.welcomeTitle, compact && styles.welcomeTitleCompact]} numberOfLines={1} adjustsFontSizeToFit>Bem-vindo a <Text style={styles.yellowText}>Briland</Text></Text>
        <Text style={[styles.centerMuted, compact && styles.centerMutedCompact]}>Acesse o catálogo real de produtos e soluções automotivas.</Text>
        <SlideToEnter onComplete={onCatalog} />
        <Divider text="ou" compact={compact} />
        <Pressable style={styles.secondaryButton} onPress={onLogin}>
          <Ionicons name="person" size={24} color={colors.navy} />
          <Text style={styles.secondaryText}>Login com e-mail</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SlideToEnter({ onComplete }: { onComplete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const completed = useRef(false);
  const thumbSize = 51;
  const maxDrag = Math.max(0, trackWidth - thumbSize - 14);
  const fillWidth = translateX.interpolate({
    inputRange: [0, Math.max(maxDrag, 1)],
    outputRange: [thumbSize + 14, Math.max(trackWidth, thumbSize + 14)],
    extrapolate: "clamp"
  });
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => {
      const currentMax = Math.max(0, trackWidth - thumbSize - 14);
      translateX.setValue(Math.max(0, Math.min(currentMax, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const currentMax = Math.max(0, trackWidth - thumbSize - 14);
      if (currentMax > 0 && gesture.dx >= currentMax * 0.96 && !completed.current) {
        completed.current = true;
        Animated.timing(translateX, { toValue: currentMax, duration: 160, useNativeDriver: false }).start(() => onComplete());
        return;
      }
      Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
    }
  }), [onComplete, trackWidth, translateX]);
  return (
    <View style={styles.slideTrack} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} {...panResponder.panHandlers}>
      <Animated.View style={[styles.slideFill, { width: fillWidth }]} />
      <Text style={styles.slideText}>Deslize para entrar no catálogo</Text>
      <Animated.View style={[styles.slideThumb, { transform: [{ translateX }] }]}>
        <Ionicons name="arrow-forward" size={27} color={colors.navy} />
      </Animated.View>
    </View>
  );
}
function HomeScreen({ go, products, categories, montadoras, media, catalogPdfUrl, imageVersion }: { go: (route: Route) => void; products: Produto[]; categories: Categoria[]; montadoras: Montadora[]; media: MediaSettings; catalogPdfUrl: string; imageVersion: number }) {
  const items: [Route, string, string, IconName][] = [
    ["categories", "Categorias", `${categories.length} categorias ativas`, "grid-outline"],
    ["vehicleBrands", "Filtrar por montadora", `${montadoras.length} montadoras disponíveis`, "car-sport-outline"],
    ["products", "Produtos", `${products.length} produtos no catálogo`, "cube-outline"],
    ["launches", "Lançamentos", "Lançamentos Briland", "star-outline"],
    ["promotions", "Promoções", "Produtos em destaque", "pricetag-outline"],
    ["contact", "Contatos", "Fale com nossa equipe", "headset-outline"]
  ];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <View style={styles.heroCard}>
        {media.homeImage ? <Image source={{ uri: liveImageUrl(media.homeImage, imageSize.home, imageVersion) }} style={styles.heroImage} resizeMode="cover" /> : <BrandedMedia title="Home Briland" subtitle="Recomendado 1200 x 760 px" />}
        <Pressable style={styles.heroCta} onPress={() => go("products")}>
          <Text style={styles.heroCtaText}>Ver catálogo completo</Text>
          <Ionicons name="arrow-forward" size={25} color={colors.navy} />
        </Pressable>
      </View>
      <View style={styles.dots}><View style={styles.dotActive} /><View style={styles.dot} /><View style={styles.dot} /></View>
      {catalogPdfUrl ? <CatalogPdfButton url={catalogPdfUrl} /> : null}
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

function CategoriesScreen({ categories, imageVersion, onPick }: { categories: Categoria[]; imageVersion: number; onPick: (id: string) => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Categorias" subtitle="Explore todas as nossas linhas de produtos." />
      {categories.length === 0 ? <EmptyState text="Nenhuma categoria disponível." /> : (
        <View style={styles.grid}>
          {categories.map((item) => (
            <Pressable style={styles.categoryCard} key={item.id} onPress={() => onPick(item.id)}>
              <View style={styles.categoryIcon}>
                {item.imagem ? <Image source={{ uri: liveImageUrl(item.imagem, imageSize.categoryIcon, imageVersion) }} style={styles.categoryImage} resizeMode="contain" /> : <Ionicons name="grid-outline" size={34} color={colors.navy} />}
              </View>
              <Text style={styles.categoryName} numberOfLines={3}>{item.nome}</Text>
              <Ionicons name="arrow-forward-outline" size={24} color={colors.navy} style={styles.categoryArrow} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function VehicleBrandsScreen({ montadoras, applications, imageVersion, onPick }: { montadoras: Montadora[]; applications: ProdutoModeloVeiculoView[]; imageVersion: number; onPick: (id: string) => void }) {
  const productCountByBrand = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of applications) {
      if (!item.montadoraId || !item.produtoId) continue;
      const products = map.get(item.montadoraId) || new Set<string>();
      products.add(item.produtoId);
      map.set(item.montadoraId, products);
    }
    return map;
  }, [applications]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Filtrar por montadora" subtitle="Selecione uma montadora para ver todos os produtos vinculados." />
      {montadoras.length === 0 ? <EmptyState text="Nenhuma montadora disponível." /> : (
        <View style={styles.grid}>
          {montadoras.map((item) => {
            const count = productCountByBrand.get(item.id)?.size ?? 0;
            return (
              <Pressable style={styles.vehicleBrandCard} key={item.id} onPress={() => onPick(item.id)}>
                <View style={styles.vehicleBrandIcon}>
                  {item.imagem ? <Image source={{ uri: liveImageUrl(item.imagem, imageSize.categoryIcon, imageVersion) }} style={styles.vehicleBrandImage} resizeMode="contain" /> : <Ionicons name="car-sport-outline" size={34} color={colors.navy} />}
                </View>
                <Text style={styles.vehicleBrandName} numberOfLines={2}>{item.nome}</Text>
                <Text style={styles.mutedSmall}>{count} produtos vinculados</Text>
                <Ionicons name="arrow-forward" size={24} color={colors.yellow} style={styles.vehicleBrandArrow} />
              </Pressable>
            );
          })}
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
  montadoraFilter,
  setMontadoraFilter,
  modeloFilter,
  setModeloFilter,
  sortMode,
  setSortMode,
  brands,
  montadoras,
  modelosVeiculo,
  filterOpen,
  setFilterOpen,
  listMode,
  setListMode,
  onOpen,
  role,
  catalogPdfUrl,
  imageVersion,
  appearance,
  savedScrollOffset,
  onScrollOffset,
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
  montadoraFilter: string | null;
  setMontadoraFilter: (id: string | null) => void;
  modeloFilter: string | null;
  setModeloFilter: (id: string | null) => void;
  sortMode: "order" | "name" | "newest";
  setSortMode: (mode: "order" | "name" | "newest") => void;
  brands: Marca[];
  montadoras: Montadora[];
  modelosVeiculo: ModeloVeiculo[];
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  listMode: "grid" | "list";
  setListMode: (mode: "grid" | "list") => void;
  onOpen: (product: Produto) => void;
  role: Role;
  catalogPdfUrl: string;
  imageVersion: number;
  appearance: CatalogAppearance;
  savedScrollOffset: number;
  onScrollOffset: (offset: number) => void;
  promo?: boolean;
  launch?: boolean;
}) {
  const listRef = useRef<FlatList<Produto>>(null);
  const latestScrollOffset = useRef(savedScrollOffset);
  const restoringScroll = useRef(savedScrollOffset > 0);
  useEffect(() => {
    if (savedScrollOffset <= 0) {
      restoringScroll.current = false;
      return;
    }

    let active = true;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: savedScrollOffset, animated: false });
      secondFrame = requestAnimationFrame(() => {
        if (active) restoringScroll.current = false;
      });
    });

    return () => {
      active = false;
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, []);
  const activeCategory = categoryFilter ? categoryById.get(categoryFilter)?.nome : "Todas categorias";
  const activeBrand = brandFilter ? brands.find((item) => item.id === brandFilter)?.nome : "Todas marcas";
  const activeMontadora = montadoraFilter ? montadoras.find((item) => item.id === montadoraFilter)?.nome : "Todas montadoras";
  const activeModelo = modeloFilter ? modelosVeiculo.find((item) => item.id === modeloFilter)?.nome : "Todos modelos";
  const availableModels = montadoraFilter ? modelosVeiculo.filter((item) => item.montadoraId === montadoraFilter) : [];
  const listHeader = (
    <>
      <PageTitle title={title} subtitle={subtitle} badge={launch ? "NOVO" : undefined} />
      <View style={styles.searchRow}>
        <View style={styles.searchBox}><Ionicons name="search" size={22} color={colors.navy} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar código, EAN, NCM ou descricao..." placeholderTextColor="#9BA0AA" style={styles.searchInput} /></View>
        <Pressable style={styles.filterButton} onPress={() => setFilterOpen(true)}><Ionicons name="filter" size={22} color={colors.navy} /><Text style={styles.filterText}>Filtros</Text></Pressable>
      </View>
      {catalogPdfUrl ? <CatalogPdfButton url={catalogPdfUrl} /> : null}
      <View style={styles.chips}>
        <Chip text={activeCategory ?? "Categorias"} onPress={() => setFilterOpen(true)} />
        <Chip text={activeBrand ?? "Marcas"} onPress={() => setFilterOpen(true)} />
        <Chip text={activeMontadora ?? "Montadoras"} onPress={() => setFilterOpen(true)} />
        {montadoraFilter && <Chip text={activeModelo ?? "Modelos"} onPress={() => setFilterOpen(true)} />}
        <Chip text="Limpar" onPress={() => { setQuery(""); setCategoryFilter(null); setBrandFilter(null); setMontadoraFilter(null); setModeloFilter(null); setSortMode("order"); }} />
      </View>
      {montadoraFilter && availableModels.length > 0 && (
        <View style={styles.modelFilterPanel}>
          <Text style={styles.sheetLabel}>Modelo do veículo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
            <OptionPill label="Todos" selected={!modeloFilter} onPress={() => setModeloFilter(null)} />
            {availableModels.map((item) => <OptionPill key={item.id} label={item.nome} selected={modeloFilter === item.id} onPress={() => setModeloFilter(item.id)} />)}
          </ScrollView>
        </View>
      )}
      <View style={styles.resultRow}><Text style={styles.muted}>{products.length} produtos encontrados</Text><Segmented value={listMode} setValue={setListMode} /></View>
    </>
  );
  return (
    <View style={[styles.screen, { backgroundColor: appearance.backgroundColor }]}>
      <FlatList
        ref={listRef}
        key={listMode}
        data={products}
        keyExtractor={(product) => product.id}
        numColumns={listMode === "grid" ? 2 : 1}
        columnWrapperStyle={listMode === "grid" ? styles.productColumns : undefined}
        contentContainerStyle={styles.contentWithDock}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<EmptyState text="Nenhum produto encontrado com os filtros atuais." />}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={Platform.OS === "android"}
        contentOffset={{ x: 0, y: savedScrollOffset }}
        onScroll={(event) => {
          const offset = Math.max(0, event.nativeEvent.contentOffset.y);
          latestScrollOffset.current = offset;
          if (!restoringScroll.current) onScrollOffset(offset);
        }}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: product }) => (
          <Pressable style={[listMode === "grid" ? styles.productCard : styles.productListCard, { backgroundColor: appearance.surfaceColor, borderRadius: appearance.cardRadius }, promo && styles.promoCard, launch && styles.launchCard]} onPressIn={() => { const detailUrl = productImageUrl(product, "detail", imageVersion); if (detailUrl) void ExpoImage.prefetch(detailUrl); }} onPress={() => { onScrollOffset(latestScrollOffset.current); onOpen(product); }}>
            <View style={listMode === "grid" ? undefined : styles.listImageWrap}>
              {product.imagemPrincipal ? <Image recyclingKey={product.id} source={{ uri: productImageUrl(product, "card", imageVersion) }} style={listMode === "grid" ? styles.productImage : styles.productListImage} resizeMode="contain" /> : listMode === "grid" ? <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Sem foto cadastrada" card /> : <View style={styles.productListPlaceholder}><Ionicons name="image-outline" size={28} color={colors.yellow} /></View>}
              {promo && <Ribbon text="PROMOÇÃO" color={colors.red} />}
              {launch && <Ribbon text="NOVO" color={colors.yellow} />}
            </View>
            <View style={styles.productBody}>
              <Text style={[styles.productCode, { color: appearance.primaryColor }]}>{product.codigoInterno || "Sem código"}</Text>
              <Text style={styles.productName} numberOfLines={3}>{product.nome}</Text>
              {appearance.showProductCategory && <Text style={styles.mutedSmall}>{categoryById.get(product.categoriaId ?? "")?.nome || "Sem categoria"}{appearance.showProductBrand && productPermission(product, "marca", true) ? ` • ${brandById.get(product.marcaId ?? "")?.nome || "Sem marca"}` : ""}</Text>}
              <View style={styles.cardLine} />
              <Meta icon="cube-outline" label="Caixa master" value={product.caixaMaster || "A cadastrar"} />
              {productPermission(product, "ncm", role !== "VISITANTE") && <Meta icon="document-text-outline" label="NCM" value={product.ncm || "A cadastrar"} />}
              {role === "VISITANTE" ? <Text style={[styles.loginHint, { color: appearance.accentColor }]}>Entrar para ver mais informações</Text> : <Text style={styles.price}>{money(product.preco)}</Text>}
            </View>
          </Pressable>
        )}
      />
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        categories={allCategories}
        brands={brands}
        montadoras={montadoras}
        modelosVeiculo={modelosVeiculo}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        montadoraFilter={montadoraFilter}
        setMontadoraFilter={(id) => { setMontadoraFilter(id); setModeloFilter(null); }}
        modeloFilter={modeloFilter}
        setModeloFilter={setModeloFilter}
        sortMode={sortMode}
        setSortMode={setSortMode}
      />
    </View>
  );
}

function productPermission(product: Produto, key: string, fallback = true) {
  if (product.permissoesProduto && key in product.permissoesProduto) return Boolean(product.permissoesProduto[key]);
  return fallback;
}

function ProductDetail({ product, role, category, brand, vehicleApplications, whatsappUrl, imageVersion, onQuote }: { product: Produto; role: Role; category?: Categoria; brand?: Marca; vehicleApplications: ProdutoModeloVeiculoView[]; whatsappUrl: string; imageVersion: number; onQuote: () => void }) {
  const gallery = [product.imagemPrincipal, ...(product.imagensExtras ?? [])].filter(Boolean) as string[];
  const cardImage = productImageUrl(product, "card", imageVersion);
  const detailImage = productImageUrl(product, "detail", imageVersion);
  const showBrand = productPermission(product, "marca", true);
  const showCa = productPermission(product, "ca", role !== "VISITANTE" && role !== "NAO_CLIENTE");
  const showManual = Boolean(product.manualPdf) && productPermission(product, "manualPdf", role !== "VISITANTE" && role !== "NAO_CLIENTE");
  const showVehicleApplications = vehicleApplications.length > 0 && productPermission(product, "aplicacoesVeiculo", true);
  const showQuote = productPermission(product, "botaoOrcamento", role !== "VISITANTE");
  const showWhatsApp = productPermission(product, "botaoWhatsApp", role !== "VISITANTE");
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <View style={styles.detailMedia}>
        {gallery[0] ? <View style={styles.detailImageStack}>
          <Image recyclingKey={`${product.id}-card-detail`} source={{ uri: cardImage }} transition={0} style={styles.detailImage} resizeMode="contain" />
          {detailImage !== cardImage && <Image recyclingKey={`${product.id}-high-detail`} source={{ uri: detailImage }} transition={140} style={[styles.detailImage, styles.detailImageOverlay]} resizeMode="contain" />}
        </View> : <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Cadastre a imagem principal no painel admin" tall />}
        <View style={styles.dotsOverlay}><View style={styles.dotActive} />{gallery.slice(1, 5).map((item) => <View key={item} style={styles.dotLight} />)}</View>
      </View>
      <Text style={styles.smallYellow}>{product.codigoInterno || "Sem código"}</Text>
      <Text style={styles.detailTitle}>{product.nome}</Text>
      <Text style={styles.muted}>{product.descricaoCurta || "Produto cadastrado no catálogo Briland."}</Text>
      <View style={styles.statRow}>
        <InfoCard icon="document-text-outline" label="Preço" value={role === "VISITANTE" ? "Login requerido" : money(product.preco)} />
        <InfoCard icon="cube-outline" label="Estoque" value={typeof product.estoque === "number" ? `${product.estoque}` : "Sob consulta"} green={Boolean(product.estoque && product.estoque > 0)} small="unidades" />
      </View>
      <Accordion title="Informações principais" open>
        <View style={styles.detailGrid}>
          <DetailItem label="Categoria" value={category?.nome || "A cadastrar"} />
          {showBrand && <DetailItem label="Marca" value={brand?.nome || "A cadastrar"} />}
          <DetailItem label="NCM" value={product.ncm || "A cadastrar"} />
          <DetailItem label="EAN" value={product.ean || "A cadastrar"} />
          <DetailItem label="Caixa Master" value={product.caixaMaster || "A cadastrar"} />
          {showCa && <DetailItem label="CA" value={product.ca || "A cadastrar"} />}
        </View>
      </Accordion>
      <Accordion title="Descrição completa" open={Boolean(product.descricaoCompleta)}>
        <Text style={styles.detailText}>{product.descricaoCompleta}</Text>
      </Accordion>
      <Accordion title="Ficha técnica" open={Boolean(product.fichaTecnica) || showVehicleApplications || showManual}>
        {product.fichaTecnica ? <Text style={styles.detailText}>{product.fichaTecnica}</Text> : null}
        {showVehicleApplications && <View style={styles.vehicleApplicationBox}>
          <Text style={styles.sheetLabel}>Montadora / Modelo</Text>
          {vehicleApplications.map((app) => (
            <View key={app.id} style={styles.vehicleApplicationItem}>
              <DetailItem label="Montadora" value={app.montadoraNome || "A cadastrar"} />
              <DetailItem label="Modelo" value={app.modeloNome || "A cadastrar"} />
              {app.observacaoComercial ? <Text style={styles.detailText}>{app.observacaoComercial}</Text> : null}
            </View>
          ))}
        </View>}
        {showManual && <Pressable style={styles.downloadButton} onPress={() => Linking.openURL(product.manualPdf || "")}><Ionicons name="download-outline" size={18} color={colors.navy} /><Text style={styles.downloadText}>download</Text></Pressable>}
      </Accordion>
      <Accordion title="Observação comercial" open={Boolean(product.observacaoComercial)}>
        <Text style={styles.detailText}>{product.observacaoComercial}</Text>
      </Accordion>
      <View style={styles.actionRow}>
        {showQuote && <Pressable style={styles.yellowButton} onPress={onQuote}><Ionicons name="document-text-outline" size={20} color={colors.navy} /><Text style={styles.yellowButtonText}>Solicitar orçamento</Text></Pressable>}
        {showWhatsApp && <Pressable style={styles.whatsButton} onPress={() => Linking.openURL(`${whatsappUrl}${whatsappUrl.includes("?") ? "&" : "?"}text=${encodeURIComponent(`Tenho interesse no produto ${product.codigoInterno} - ${product.nome}`)}`)}><Ionicons name="logo-whatsapp" size={24} color={colors.green} /></Pressable>}
      </View>
    </ScrollView>
  );
}

function FilterSheet({
  visible,
  onClose,
  categories,
  brands,
  montadoras,
  modelosVeiculo,
  categoryFilter,
  setCategoryFilter,
  brandFilter,
  setBrandFilter,
  montadoraFilter,
  setMontadoraFilter,
  modeloFilter,
  setModeloFilter,
  sortMode,
  setSortMode
}: {
  visible: boolean;
  onClose: () => void;
  categories: Categoria[];
  brands: Marca[];
  montadoras: Montadora[];
  modelosVeiculo: ModeloVeiculo[];
  categoryFilter: string | null;
  setCategoryFilter: (id: string | null) => void;
  brandFilter: string | null;
  setBrandFilter: (id: string | null) => void;
  montadoraFilter: string | null;
  setMontadoraFilter: (id: string | null) => void;
  modeloFilter: string | null;
  setModeloFilter: (id: string | null) => void;
  sortMode: "order" | "name" | "newest";
  setSortMode: (mode: "order" | "name" | "newest") => void;
}) {
  const sorts: Array<["order" | "name" | "newest", string]> = [["order", "Ordem"], ["name", "Nome"], ["newest", "Mais novos"]];
  const filteredModels = montadoraFilter ? modelosVeiculo.filter((item) => item.montadoraId === montadoraFilter) : modelosVeiculo;
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
        <Text style={styles.sheetLabel}>Filtrar por Montadora</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!montadoraFilter} onPress={() => { setMontadoraFilter(null); setModeloFilter(null); }} />
          {montadoras.map((item) => <OptionPill key={item.id} label={item.nome} selected={montadoraFilter === item.id} onPress={() => setMontadoraFilter(item.id)} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Modelo</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todos" selected={!modeloFilter} onPress={() => setModeloFilter(null)} />
          {filteredModels.map((item) => <OptionPill key={item.id} label={item.nome} selected={modeloFilter === item.id} onPress={() => setModeloFilter(item.id)} />)}
        </ScrollView>
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

function BrandedMedia({ title, subtitle, tall, compact, card }: { title: string; subtitle: string; tall?: boolean; compact?: boolean; card?: boolean }) {
  return (
    <LinearGradient colors={[colors.navy, "#0B2347"]} style={[styles.brandedMedia, tall && styles.brandedMediaTall, compact && styles.brandedMediaCompact, card && styles.brandedMediaCard]}>
      <Image source={logo} style={styles.brandedMediaLogo} resizeMode="contain" />
      <Text style={styles.brandedMediaTitle} numberOfLines={2}>{title}</Text>
      <Text style={styles.brandedMediaSub}>{subtitle}</Text>
    </LinearGradient>
  );
}

function ContactScreen({ onSubmit }: { onSubmit: (lead: Partial<Lead>) => void }) {
  const [form, setForm] = useState({ nome: "", empresa: "", telefone: "", email: "", mensagem: "" });
  const [department, setDepartment] = useState<"Comercial" | "Suporte">("Comercial");
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Contato" subtitle="Estamos aqui para te ajudar. Envie sua mensagem direto para o painel." />
      <View style={styles.formCard}>
        <Text style={styles.label}>Com quem você quer falar? *</Text>
        <View style={styles.choiceRow}>
          <Choice title="Comercial" subtitle="Dúvidas, orçamentos e parcerias" selected={department === "Comercial"} icon="briefcase-outline" onPress={() => setDepartment("Comercial")} />
          <Choice title="Suporte" subtitle="Atendimento técnico e suporte" selected={department === "Suporte"} icon="headset-outline" onPress={() => setDepartment("Suporte")} />
        </View>
        <Input label="Nome completo" value={form.nome} onChangeText={(nome) => setForm({ ...form, nome })} />
        <Input label="Empresa" value={form.empresa} onChangeText={(empresa) => setForm({ ...form, empresa })} />
        <Input label="Número de telefone / WhatsApp" value={form.telefone} onChangeText={(telefone) => setForm({ ...form, telefone })} />
        <Input label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} />
        <Text style={styles.label}>Mensagem *</Text>
        <TextInput value={form.mensagem} onChangeText={(mensagem) => setForm({ ...form, mensagem })} placeholder="Digite sua mensagem aqui..." style={styles.textArea} multiline placeholderTextColor="#9BA0AA" />
        <View style={styles.securityBox}><Ionicons name="shield-checkmark-outline" size={32} color={colors.yellow} /><View style={styles.flex}><Text style={styles.bold}>Seus dados estão protegidos</Text></View></View>
        <Pressable style={styles.yellowButton} onPress={() => onSubmit({ ...form, origem: department === "Suporte" ? "contato-suporte" : "contato-comercial", mensagem: "[" + department + "] " + form.mensagem })}><Ionicons name="paper-plane-outline" size={22} color={colors.navy} /><Text style={styles.yellowButtonText}>Enviar mensagem</Text></Pressable>
      </View>
    </ScrollView>
  );
}
function LoginScreen({ onLogin, onSignup, onCatalog, onPrivacy, onDelete, links, error }: { onLogin: (email: string, password: string) => void | Promise<void>; onSignup: () => void; onCatalog: () => void; onPrivacy: () => void; onDelete: () => void; links: SocialLinks; error?: string }) {
  const [email, setEmail] = useState("faturamento@briland.com.br");
  const [password, setPassword] = useState("");
  const supportUrl = links.whatsapp + (links.whatsapp.includes("?") ? "&" : "?") + "text=Preciso%20recuperar%20meu%20acesso%20Briland";
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
        <Pressable onPress={() => Linking.openURL(supportUrl)}><Text style={styles.forgotText}>Esqueci a senha  ›</Text></Pressable>
        <Divider text="ou" dark />
        <Pressable style={styles.supportButton} onPress={() => Linking.openURL(links.whatsapp)}><Ionicons name="logo-whatsapp" size={26} color="#22C55E" /><Text style={styles.supportText}>Falar com suporte</Text></Pressable>
        <Pressable style={styles.catalogBackButton} onPress={onCatalog}><Ionicons name="home-outline" size={22} color={colors.white} /><Text style={styles.catalogBackText}>Voltar ao catálogo</Text></Pressable>
        <Text style={styles.loginMuted}>Ainda não tem uma conta?</Text>
        <Pressable style={styles.signupDarkButton} onPress={onSignup}><Ionicons name="person-add-outline" size={26} color={colors.yellow} /><Text style={styles.signupDarkText}>Cadastrar</Text></Pressable>
        <View style={styles.legalLinksRow}><Pressable onPress={onPrivacy}><Text style={styles.loginLegalLink}>Política de Privacidade</Text></Pressable><Pressable onPress={onDelete}><Text style={styles.loginLegalLink}>Excluir cadastro</Text></Pressable></View>
      </ScrollView>
    </SafeAreaView>
  );
}
function SignupScreen({ onSubmit, onLogin, onPrivacy, onDelete }: { onSubmit: (request: RegistrationRequest) => Promise<boolean>; onLogin: () => void; onPrivacy: () => void; onDelete: () => void }) {
  const [form, setForm] = useState<RegistrationRequest>({ nome: "", empresa: "", telefone: "", email: "", cnpj: "", observacoes: "", senha: "", confirmarSenha: "" });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const passwordsMatch = form.senha === form.confirmarSenha;
  const passwordReady = form.senha.length >= 8 && passwordsMatch;
  const requiredFieldsReady = Boolean(form.empresa.trim() && form.nome.trim() && form.telefone.trim() && form.email.trim() && form.cnpj.trim() && passwordReady);
  const submit = async () => {
    setSubmitting(true);
    try {
      setSubmitted(await onSubmit(form));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.signupContent}>
      <PageTitle title="Cadastrar empresa" subtitle="Preencha os dados abaixo para solicitar seu cadastro empresarial." />
      {submitted ? <View style={styles.deletionSuccess}><Ionicons name="checkmark-circle" size={58} color={colors.green} /><Text style={styles.legalHeading}>Cadastro recebido</Text><Text style={styles.legalParagraph}>Enviamos uma confirmação para o seu e-mail. Confirme o endereço e aguarde a equipe Briland aprovar o cadastro. Depois, entre usando este e-mail e a senha que acabou de criar.</Text></View> : <>
        <Input label="Razão social" value={form.empresa} onChangeText={(empresa) => setForm({ ...form, empresa })} />
        <Input label="Nome do responsável" value={form.nome} onChangeText={(nome) => setForm({ ...form, nome })} />
        <Input label="Contato (Telefone / WhatsApp)" value={form.telefone} onChangeText={(telefone) => setForm({ ...form, telefone })} />
        <Input label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} />
        <Input label="CNPJ" value={form.cnpj} onChangeText={(cnpj) => setForm({ ...form, cnpj })} />
        <Input label="Observações" required={false} value={form.observacoes} onChangeText={(observacoes) => setForm({ ...form, observacoes })} />
        <Input label="Senha" secure value={form.senha} onChangeText={(senha) => setForm({ ...form, senha })} />
        <Input label="Confirmar senha" secure value={form.confirmarSenha} onChangeText={(confirmarSenha) => setForm({ ...form, confirmarSenha })} />
        <Text style={[styles.mutedSmall, form.confirmarSenha.length > 0 && !passwordsMatch && { color: colors.red }]}>Use no mínimo 8 caracteres{form.confirmarSenha.length > 0 && !passwordsMatch ? ". As senhas não coincidem." : "."}</Text>
        <Pressable style={styles.checkRow} onPress={() => setPrivacyAccepted((value) => !value)}><View style={[styles.emptyCheck, privacyAccepted && styles.checkedBox]}>{privacyAccepted && <Ionicons name="checkmark" size={20} color={colors.navy} />}</View><Text style={styles.checkText}>Li a Política de Privacidade e concordo com o tratamento dos dados para análise do cadastro.</Text></Pressable>
        <Pressable onPress={onPrivacy}><Text style={styles.inlineLegalLink}>Ler a Política de Privacidade</Text></Pressable>
        <Pressable disabled={!privacyAccepted || !requiredFieldsReady || submitting} style={[styles.yellowButton, (!privacyAccepted || !requiredFieldsReady || submitting) && styles.disabledButton]} onPress={() => void submit()}>{submitting ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.yellowButtonText}>Cadastrar</Text>}</Pressable>
      </>}
      <Pressable onPress={onLogin}><Text style={styles.loginLink}>Já tem uma conta? <Text style={styles.yellowText}>Entrar</Text></Text></Pressable>
      <Pressable onPress={onDelete}><Text style={styles.inlineLegalLink}>Solicitar exclusão de cadastro</Text></Pressable>
    </ScrollView>
  );
}

function PrivacyScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.legalContent}>
      <PageTitle title="Política de Privacidade" subtitle="Transparência sobre o uso dos seus dados no catálogo Briland." />
      <View style={styles.legalCard}>
        <Text style={styles.legalHeading}>Dados tratados</Text>
        <Text style={styles.legalParagraph}>Podemos tratar dados de cadastro empresarial, como nome, empresa, e-mail, telefone, CNPJ e endereço; dados enviados em contatos e orçamentos; e dados técnicos mínimos de uso e diagnóstico.</Text>
        <Text style={styles.legalHeading}>Finalidades</Text>
        <Text style={styles.legalParagraph}>Usamos esses dados para analisar cadastros, autenticar usuários, atender solicitações, apresentar o catálogo conforme o perfil de acesso, proteger o serviço e corrigir falhas.</Text>
        <Text style={styles.legalHeading}>Compartilhamento e segurança</Text>
        <Text style={styles.legalParagraph}>Os dados podem ser processados por fornecedores de infraestrutura necessários ao funcionamento do serviço, como Supabase, Expo e Vercel. Não vendemos dados pessoais e não usamos SDK de publicidade comportamental.</Text>
        <Text style={styles.legalHeading}>Seus direitos</Text>
        <Text style={styles.legalParagraph}>Você pode pedir confirmação, acesso, correção, portabilidade, oposição ou exclusão. Solicitações de exclusão são processadas em até 30 dias, ressalvadas retenções exigidas por lei ou necessárias à segurança.</Text>
        <Text style={styles.legalHeading}>Contato</Text>
        <Text style={styles.legalParagraph}>E-mail: catalogo@briland.com.br. Site: briland.com.br.</Text>
        <Pressable style={styles.legalAction} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}><Ionicons name="open-outline" size={20} color={colors.navy} /><Text style={styles.legalActionText}>Abrir política completa</Text></Pressable>
        <Pressable style={styles.legalActionSecondary} onPress={() => Linking.openURL(ACCOUNT_DELETION_URL)}><Ionicons name="person-remove-outline" size={20} color={colors.red} /><Text style={styles.dangerText}>Página pública de exclusão</Text></Pressable>
      </View>
    </ScrollView>
  );
}

function AccountDeletionScreen({ initialEmail, onSubmit }: { initialEmail: string; onSubmit: (email: string, reason: string) => Promise<void> }) {
  const [email, setEmail] = useState(initialEmail);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(email, reason);
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.legalContent}>
      <PageTitle title="Excluir cadastro" subtitle="Solicite a exclusão da conta e dos dados pessoais associados." />
      <View style={styles.legalCard}>
        {submitted ? (
          <View style={styles.deletionSuccess}><Ionicons name="checkmark-circle" size={52} color={colors.green} /><Text style={styles.legalHeading}>Solicitação registrada</Text><Text style={styles.legalParagraph}>Se necessário, a equipe confirmará sua identidade antes de concluir a exclusão em até 30 dias. Serão mantidas apenas informações exigidas por lei ou necessárias para prevenção de fraude e segurança.</Text></View>
        ) : (
          <>
            <Text style={styles.legalParagraph}>Informe o mesmo e-mail usado no cadastro. Se você estiver conectado, o acesso será desativado imediatamente após a confirmação.</Text>
            <Input label="E-mail do cadastro" value={email} onChangeText={setEmail} />
            <Text style={styles.label}>Motivo (opcional)</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="Conte brevemente o motivo, se desejar." style={styles.textArea} multiline maxLength={1000} placeholderTextColor="#9BA0AA" />
            <Pressable style={styles.checkRow} onPress={() => setConfirmed((value) => !value)}><View style={[styles.emptyCheck, confirmed && styles.checkedBox]}>{confirmed && <Ionicons name="checkmark" size={20} color={colors.navy} />}</View><Text style={styles.checkText}>Entendo que perderei o acesso à conta e desejo solicitar a exclusão dos dados associados.</Text></Pressable>
            <Pressable disabled={!validEmail || !confirmed || busy} style={[styles.dangerSubmitButton, (!validEmail || !confirmed || busy) && styles.disabledButton]} onPress={() => void submit()}>{busy ? <ActivityIndicator color={colors.white} /> : <><Ionicons name="trash-outline" size={20} color={colors.white} /><Text style={styles.dangerSubmitText}>Solicitar exclusão</Text></>}</Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function AboutScreen({ settings }: { settings: AboutSettings }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title={settings.title || defaultAbout.title} subtitle={settings.subtitle || defaultAbout.subtitle} />
      <View style={styles.aboutCard}>
        <Text style={styles.aboutText}>{settings.body || defaultAbout.body}</Text>
      </View>
    </ScrollView>
  );
}
function AdminScreen({ role, data, active, setActive, onBack, onLogout, reload, authToken, socialLinks, setSocialLinks, mediaSettings, setMediaSettings, aboutSettings, setAboutSettings, onAction }: { role: Role; data: AppData; active: string; setActive: (tab: string) => void; onBack: () => void; onLogout: () => void; reload: () => void; authToken?: string; socialLinks: SocialLinks; setSocialLinks: (links: SocialLinks) => void; mediaSettings: MediaSettings; setMediaSettings: (settings: MediaSettings) => void; aboutSettings: AboutSettings; setAboutSettings: (settings: AboutSettings) => void; onAction: (message: string) => void }) {
  const tabs = isMasterRole(role)
    ? ["Dashboard", "Produtos", "Categorias", "Marcas", "Aplicações", "Usuários", "Permissões", "Leads", "Mídia", "Links", "Conteúdo"]
    : ["Dashboard", "Produtos", "Categorias", "Marcas", "Aplicações", "Leads"];
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
        {active === "Dashboard" && <AdminDashboard role={role} data={data} onAction={onAction} setActive={setActive} />}
        {active === "Produtos" && <AdminProducts products={data.produtos} categories={data.categorias} brands={data.marcas} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Categorias" && <AdminCrud title="Categorias" table="Categoria" items={data.categorias} icon="grid-outline" imageField="imagem" reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Marcas" && <AdminCrud title="Marcas" table="Marca" items={data.marcas} icon="shield-checkmark-outline" imageField="logo" reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Aplicações" && <AdminApplications items={data.aplicacoes} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Usuários" && <AdminUsers users={data.usuarios} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Permissões" && <AdminPermissions permissions={data.permissoes} reload={reload} authToken={authToken} onAction={onAction} />}
        {active === "Leads" && <AdminLeads leads={data.leads} products={data.produtos} />}
        {active === "Mídia" && <AdminMedia media={mediaSettings} setMedia={setMediaSettings} authToken={authToken} />}
        {active === "Links" && <AdminLinks links={socialLinks} setLinks={setSocialLinks} />}
        {active === "Conteúdo" && <AdminContent settings={aboutSettings} setSettings={setAboutSettings} />}
      </ScrollView>
    </SafeAreaView>
  );
}
function AdminDashboard({ role, data, onAction, setActive }: { role: Role; data: AppData; onAction: (message: string) => void; setActive: (tab: string) => void }) {
  const master = isMasterRole(role);
  const metrics = ([
    [String(data.produtos.length), "Total de produtos", "cube-outline", "Produtos"],
    [String(data.produtos.filter((p) => p.ativo !== false).length), "Produtos ativos", "checkmark-circle-outline", "Produtos"],
    [String(data.produtos.filter((p) => !p.imagemPrincipal).length), "Sem foto", "image-outline", "Mídia", true],
    [String(data.leads.length), "Leads recebidos", "chatbubbles-outline", "Leads"],
    [String(data.usuarios.filter((u) => u.status === "ACTIVE").length), "Usuários ativos", "people-outline", "Usuários", true],
    [String(data.permissoes.length), "Campos permissionados", "lock-closed-outline", "Permissões", true]
  ] as [string, string, IconName, string, boolean?][]).filter((item) => !item[4] || master);
  const shortcuts = ([["Produtos", "Criar/editar produtos"], ["Categorias", "Categorias"], ["Marcas", "Marcas"], ["Permissões", "Permissões", true], ["Leads", "Leads"], ["Mídia", "Mídia", true]] as [string, string, boolean?][]).filter((item) => !item[2] || master);
  return (
    <>
      <Text style={styles.adminTitle}>Dashboard</Text>
      <Text style={styles.adminSubtitle}>Métricas em tempo real das tabelas Supabase.</Text>
      <View style={styles.adminMetricGrid}>{metrics.map(([value, label, icon, tab]) => <Pressable key={label} style={styles.adminMetric} onPress={() => setActive(tab)}><Ionicons name={icon} size={23} color={colors.yellow} /><Text style={styles.adminMetricValue}>{value}</Text><Text style={styles.adminMetricLabel}>{label}</Text></Pressable>)}</View>
      <AdminPanel title="Atalhos rápidos">
        <View style={styles.shortcutGrid}>{shortcuts.map(([tab, label]) => <Pressable key={tab} style={styles.shortcut} onPress={() => setActive(tab)}><Ionicons name="arrow-forward" size={18} color={colors.navy} /><Text style={styles.shortcutText}>{label}</Text></Pressable>)}</View>
      </AdminPanel>
    </>
  );
}
function AdminProducts({ products, categories, brands, reload, authToken, onAction }: { products: Produto[]; categories: Categoria[]; brands: Marca[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<Produto | null>(null);
  const categoryByName = new Map(categories.map((item) => [item.nome.toLowerCase(), item.id]));
  const brandByName = new Map(brands.map((item) => [item.nome.toLowerCase(), item.id]));
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
      lancamento: false,
      promocao: false,
      ordem: 0
    });
  };
  const exportProducts = () => {
    const headers = ["codigoInterno", "nome", "categoria", "marca", "descricaoCurta", "descricaoCompleta", "ean", "ncm", "caixaMaster", "preco", "estoque", "condicaoComercial", "prazoEntrega", "fichaTecnica", "observacaoComercial", "ca", "ativo", "destaque", "lancamento", "promocao", "ordem"];
    const lines = products.map((product) => headers.map((key) => {
      if (key === "categoria") return csvEscape(categories.find((item) => item.id === product.categoriaId)?.nome || product.categoriaId || "");
      if (key === "marca") return csvEscape(brands.find((item) => item.id === product.marcaId)?.nome || product.marcaId || "");
      return csvEscape((product as Record<string, unknown>)[key]);
    }).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    void Linking.openURL(`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`);
  };
  const importProducts = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel"], copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return;
      const text = await (await fetch(result.assets[0].uri)).text();
      const rows = parseCsv(text);
      let saved = 0;
      for (const row of rows) {
        const codigoInterno = row.codigoInterno || row.codigo || row.Codigo || row.Código;
        const nome = row.nome || row.Nome;
        if (!codigoInterno || !nome) continue;
        const current = products.find((item) => item.codigoInterno === codigoInterno);
        const categoriaId = row.categoriaId || row.categoria || row.Categoria;
        const marcaId = row.marcaId || row.marca || row.Marca;
        const payload = {
          nome,
          slug: row.slug || slugify(`${codigoInterno}-${nome}`),
          codigoInterno,
          categoriaId: categories.some((item) => item.id === categoriaId) ? categoriaId : categoryByName.get(String(categoriaId || "").toLowerCase()) || categories[0]?.id || "",
          marcaId: brands.some((item) => item.id === marcaId) ? marcaId : brandByName.get(String(marcaId || "").toLowerCase()) || brands[0]?.id || "",
          descricaoCurta: row.descricaoCurta || null,
          descricaoCompleta: row.descricaoCompleta || null,
          ean: row.ean || null,
          ncm: row.ncm || null,
          caixaMaster: row.caixaMaster || null,
          preco: row.preco ? Number(String(row.preco).replace(",", ".")) : null,
          estoque: row.estoque ? Number(row.estoque) : null,
          condicaoComercial: row.condicaoComercial || null,
          prazoEntrega: row.prazoEntrega || null,
          fichaTecnica: row.fichaTecnica || null,
          observacaoComercial: row.observacaoComercial || null,
          ca: row.ca || null,
          ativo: row.ativo ? row.ativo !== "false" && row.ativo !== "0" : true,
          destaque: row.destaque === "true" || row.destaque === "1",
          lancamento: row.lancamento === "true" || row.lancamento === "1",
          promocao: row.promocao === "true" || row.promocao === "1",
          ordem: row.ordem ? Number(row.ordem) : 0
        };
        if (current) await supabasePatch<Produto>("Produto", current.id, payload, authToken);
        else await supabasePost<Produto>("Produto", { id: createId("prod"), ...payload, updatedAt: new Date().toISOString() }, authToken);
        saved += 1;
      }
      await reload();
      onAction(`${saved} produtos importados/atualizados.`);
    } catch (err) {
      onAction(err instanceof Error ? err.message : "Falha ao importar planilha CSV.");
    }
  };
  return (
    <>
      <Text style={styles.adminTitle}>Produtos</Text>
      <View style={styles.adminActions}><Pressable style={styles.adminYellowButton} onPress={newProduct}><Ionicons name="add" size={20} color={colors.navy} /><Text style={styles.adminYellowText}>Criar produto</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={importProducts}><Ionicons name="cloud-upload-outline" size={20} color={colors.navy} /><Text>Importar CSV</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={exportProducts}><Ionicons name="download-outline" size={20} color={colors.navy} /><Text>Exportar</Text></Pressable></View>
      {products.map((product) => <Pressable key={product.id} style={styles.adminListItem} onPress={() => setEditing(product)}>{product.imagemPrincipal ? <Image source={{ uri: productImageUrl(product, "thumb", 0) }} style={styles.adminThumb} /> : <View style={styles.adminThumbPlaceholder}><Ionicons name="image-outline" size={24} color={colors.yellow} /></View>}<View style={styles.flex}><Text style={styles.productCode}>{product.codigoInterno || "Sem código"}</Text><Text style={styles.adminItemTitle}>{product.nome}</Text><Text style={styles.mutedSmall}>{product.ativo ? "Ativo" : "Inativo"} • Ordem {product.ordem ?? 0} • {money(product.preco)}</Text></View><Switch value={product.ativo !== false} onValueChange={async (value) => { try { await supabasePatch<Produto>("Produto", product.id, { ativo: value }, authToken); await reload(); } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao atualizar status."); } }} trackColor={{ true: colors.yellow, false: "#D7DAE1" }} /></Pressable>)}
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
  const productImageHelp = "Imagem ideal: 1200 x 900 px (proporção 4:3), JPG/PNG/WEBP até 5MB. O app usa contain para não cortar no card nem no detalhe.";
  const extras = draft.imagensExtras || [];
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
    imagensExtras: extras,
    preco: typeof draft.preco === "number" && !Number.isNaN(draft.preco) ? draft.preco : null,
    estoque: typeof draft.estoque === "number" && !Number.isNaN(draft.estoque) ? draft.estoque : null,
    condicaoComercial: draft.condicaoComercial || null,
    prazoEntrega: draft.prazoEntrega || null,
    fichaTecnica: draft.fichaTecnica || null,
    manualPdf: draft.manualPdf || null,
    observacaoComercial: draft.observacaoComercial || null,
    observacaoInterna: draft.observacaoInterna || null,
    margem: typeof draft.margem === "number" && !Number.isNaN(draft.margem) ? draft.margem : null,
    ca: draft.ca || null,
    ativo: draft.ativo !== false,
    destaque: Boolean(draft.destaque),
    lancamento: Boolean(draft.lancamento),
    promocao: Boolean(draft.promocao),
    ordem: Number(draft.ordem || 0),
    updatedAt: new Date().toISOString()
  });
  const save = async () => {
    try {
      if (!draft.nome.trim() || !draft.codigoInterno?.trim() || !draft.categoriaId || !draft.marcaId) {
        notify("Campos obrigatórios", "Preencha nome, código interno, categoria e marca.");
        return;
      }
      if (isNew) await supabasePost<Produto>("Produto", { id: draft.id, ...payload() }, authToken);
      else await supabasePatch<Produto>("Produto", product.id, payload(), authToken);
      await onSaved();
      notify("Produto salvo", "As alterações foram enviadas para o Supabase.");
    } catch (err) {
      notify("Falha ao salvar", err instanceof Error ? err.message : "Verifique RLS/permissões do endpoint Produto.");
    }
  };
  const remove = () => Alert.alert("Excluir produto", "Essa ação remove o produto da tabela Produto.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Excluir", style: "destructive", onPress: async () => { try { await supabaseDelete("Produto", product.id, authToken); await onSaved(); } catch (err) { notify("Falha ao excluir", err instanceof Error ? err.message : "Não foi possível excluir."); } } }
  ]);
  const addExtra = (url: string) => set("imagensExtras", [...extras, url]);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{isNew ? "Criar produto" : "Editar produto"}</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <Text style={styles.adminSubtitle}>Todos os campos seguem o schema real da tabela Produto.</Text>
        <AdminTextInput label="Nome" value={draft.nome} onChangeText={(value) => set("nome", value)} />
        <AdminTextInput label="Slug" value={draft.slug || ""} onChangeText={(value) => set("slug", value)} />
        <AdminTextInput label="Código interno" value={draft.codigoInterno || ""} onChangeText={(value) => set("codigoInterno", value)} />
        <Text style={styles.sheetLabel}>Categoria</Text>
        <AdminChoicePills items={categories} selectedId={draft.categoriaId || null} onSelect={(id) => set("categoriaId", id)} />
        <Text style={styles.sheetLabel}>Marca</Text>
        <AdminChoicePills items={brands} selectedId={draft.marcaId || null} onSelect={(id) => set("marcaId", id)} />
        <ImageUploadField label="Imagem principal" value={draft.imagemPrincipal || ""} folder="produtos/principal" authToken={authToken} help={productImageHelp} onUploaded={(url) => set("imagemPrincipal", url)} onClear={() => set("imagemPrincipal", null)} />
        <ImageUploadField label="Adicionar imagem extra" value="" folder="produtos/extras" authToken={authToken} help="Opcional: use também 1200 x 900 px para manter consistência no carrossel." onUploaded={addExtra} />
        {extras.length > 0 && <View style={styles.extraImageGrid}>{extras.map((url, index) => <View key={`${url}-${index}`} style={styles.extraImageItem}><Image source={{ uri: optimizedImageUrl(url, imageSize.thumb) }} style={styles.extraImage} resizeMode="contain" /><Pressable style={styles.extraRemove} onPress={() => set("imagensExtras", extras.filter((_, current) => current !== index))}><Ionicons name="trash-outline" size={16} color={colors.white} /></Pressable></View>)}</View>}
        <AdminTextInput label="Descrição curta" value={draft.descricaoCurta || ""} onChangeText={(value) => set("descricaoCurta", value)} multiline />
        <AdminTextInput label="Descrição completa" value={draft.descricaoCompleta || ""} onChangeText={(value) => set("descricaoCompleta", value)} multiline />
        <AdminTextInput label="EAN" value={draft.ean || ""} onChangeText={(value) => set("ean", value)} />
        <AdminTextInput label="NCM" value={draft.ncm || ""} onChangeText={(value) => set("ncm", value)} />
        <AdminTextInput label="CA" value={draft.ca || ""} onChangeText={(value) => set("ca", value)} />
        <AdminTextInput label="Caixa master" value={draft.caixaMaster || ""} onChangeText={(value) => set("caixaMaster", value)} />
        <AdminTextInput label="Preço" value={String(draft.preco ?? "")} keyboard="numeric" onChangeText={(value) => set("preco", value ? Number(value.replace(",", ".")) : null)} />
        <AdminTextInput label="Estoque" value={String(draft.estoque ?? "")} keyboard="numeric" onChangeText={(value) => set("estoque", value ? Number(value) : null)} />
        <AdminTextInput label="Margem (%)" value={String(draft.margem ?? "")} keyboard="numeric" onChangeText={(value) => set("margem", value ? Number(value.replace(",", ".")) : null)} />
        <AdminTextInput label="Condição comercial" value={draft.condicaoComercial || ""} onChangeText={(value) => set("condicaoComercial", value)} multiline />
        <AdminTextInput label="Prazo de entrega" value={draft.prazoEntrega || ""} onChangeText={(value) => set("prazoEntrega", value)} />
        <AdminTextInput label="Ficha técnica" value={draft.fichaTecnica || ""} onChangeText={(value) => set("fichaTecnica", value)} multiline />
        <AdminTextInput label="Manual PDF URL" value={draft.manualPdf || ""} onChangeText={(value) => set("manualPdf", value)} />
        <AdminTextInput label="Observação comercial" value={draft.observacaoComercial || ""} onChangeText={(value) => set("observacaoComercial", value)} multiline />
        <AdminTextInput label="Observação interna" value={draft.observacaoInterna || ""} onChangeText={(value) => set("observacaoInterna", value)} multiline />
        <AdminTextInput label="Ordem" value={String(draft.ordem ?? 0)} keyboard="numeric" onChangeText={(value) => set("ordem", Number(value || 0))} />
        <View style={styles.editorSwitch}><Text style={styles.bold}>Ativo</Text><Switch value={draft.ativo !== false} onValueChange={(value) => set("ativo", value)} /></View>
        <View style={styles.editorSwitch}><Text style={styles.bold}>Destaque</Text><Switch value={Boolean(draft.destaque)} onValueChange={(value) => set("destaque", value)} /></View>
        <View style={styles.editorSwitch}><Text style={styles.bold}>Lançamento</Text><Switch value={Boolean(draft.lancamento)} onValueChange={(value) => set("lancamento", value)} /></View>
        <View style={styles.editorSwitch}><Text style={styles.bold}>Promoção</Text><Switch value={Boolean(draft.promocao)} onValueChange={(value) => set("promocao", value)} /></View>
        <View style={styles.editorActions}>
          {!isNew && <Pressable style={styles.dangerButton} onPress={remove}><Ionicons name="trash-outline" size={20} color={colors.red} /><Text style={styles.dangerText}>Excluir</Text></Pressable>}
          <Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar produto</Text></Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
type CategoryBrandItem = { id: string; nome: string; slug?: string | null; descricao?: string | null; ordem?: number | null; ativo?: boolean | null; imagem?: string | null; logo?: string | null; createdAt?: string | null };

function AdminCrud({ title, items, icon, table, imageField, reload, authToken, onAction }: { title: string; items: CategoryBrandItem[]; icon: IconName; table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<CategoryBrandItem | null>(null);
  const create = () => {
    const id = createId(table === "Categoria" ? "cat" : "marca");
    setEditing({ id, nome: table === "Categoria" ? "Nova categoria" : "Nova marca", slug: id, ativo: true, ordem: items.length + 1 });
  };
  return (
    <>
      <Text style={styles.adminTitle}>{title}</Text>
      <View style={styles.adminActions}><Pressable style={styles.adminYellowButton} onPress={create}><Ionicons name="add" size={20} color={colors.navy} /><Text style={styles.adminYellowText}>Criar</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={reload}><Ionicons name="refresh" size={20} color={colors.navy} /><Text>Atualizar</Text></Pressable></View>
      {items.length === 0 ? <EmptyState text={"Nenhum item em " + title + "."} /> : items.map((item) => <Pressable key={item.id} style={styles.adminListItem} onPress={() => setEditing(item)}>{item[imageField] ? <Image source={{ uri: optimizedImageUrl(String(item[imageField]), imageSize.thumb) }} style={styles.adminThumb} resizeMode="contain" /> : <View style={styles.adminIconBox}><Ionicons name={icon} size={24} color={colors.yellow} /></View>}<View style={styles.flex}><Text style={styles.adminItemTitle}>{item.nome}</Text><Text style={styles.mutedSmall}>Toque para editar nome, slug, status e imagem</Text></View><Switch value={item.ativo !== false} onValueChange={async (value) => { try { await supabasePatch(table, item.id, { ativo: value }, authToken); await reload(); } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao atualizar status."); } }} trackColor={{ true: colors.yellow, false: "#D7DAE1" }} /></Pressable>)}
      {editing && <CategoryBrandEditor title={title} table={table} imageField={imageField} item={editing} authToken={authToken} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

function CategoryBrandEditor({ title, table, imageField, item, authToken, onClose, onSaved }: { title: string; table: "Categoria" | "Marca"; imageField: "imagem" | "logo"; item: CategoryBrandItem; authToken?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const isNew = !item.createdAt;
  const [draft, setDraft] = useState<CategoryBrandItem>(item);
  const currentImage = (imageField === "imagem" ? draft.imagem : draft.logo) || "";
  const set = (key: keyof CategoryBrandItem, value: string | boolean | number | null) => setDraft({ ...draft, [key]: value });
  const save = async () => {
    try {
      if (!draft.nome.trim()) { notify("Campo obrigatório", "Preencha o nome."); return; }
      const payload = table === "Categoria"
        ? { nome: draft.nome, slug: draft.slug || slugify(draft.nome), descricao: draft.descricao || null, imagem: draft.imagem || null, ordem: Number(draft.ordem || 0), ativo: draft.ativo !== false }
        : { nome: draft.nome, slug: draft.slug || slugify(draft.nome), logo: draft.logo || null, ativo: draft.ativo !== false };
      if (isNew) await supabasePost(table, { id: draft.id, ...payload }, authToken);
      else await supabasePatch(table, item.id, payload, authToken);
      await onSaved();
      notify(title + " salvo", "Registro atualizado no Supabase.");
    } catch (err) {
      notify("Falha ao salvar", err instanceof Error ? err.message : "Verifique RLS/permissões.");
    }
  };
  const remove = () => Alert.alert("Excluir " + title, "A exclusão pode falhar se existir produto usando esse registro.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Excluir", style: "destructive", onPress: async () => { try { await supabaseDelete(table, item.id, authToken); await onSaved(); } catch (err) { notify("Falha ao excluir", err instanceof Error ? err.message : "Não foi possível excluir."); } } }
  ]);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{isNew ? "Criar " + title : "Editar " + title}</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <AdminTextInput label="Nome" value={draft.nome} onChangeText={(value) => set("nome", value)} />
        <AdminTextInput label="Slug" value={draft.slug || ""} onChangeText={(value) => set("slug", value)} />
        {table === "Categoria" && <AdminTextInput label="Descrição" value={draft.descricao || ""} onChangeText={(value) => set("descricao", value)} multiline />}
        {table === "Categoria" && <AdminTextInput label="Ordem" value={String(draft.ordem ?? 0)} keyboard="numeric" onChangeText={(value) => set("ordem", Number(value || 0))} />}
        <ImageUploadField label={imageField === "imagem" ? "Imagem da categoria" : "Logo da marca"} value={currentImage} folder={imageField === "imagem" ? "categorias" : "marcas"} authToken={authToken} help={imageField === "imagem" ? "Categoria: 900 x 700 px, JPG/PNG/WEBP até 5MB." : "Marca: 600 x 300 px, PNG/WEBP com fundo limpo até 5MB."} onUploaded={(url) => set(imageField, url)} onClear={() => set(imageField, null)} />
        <View style={styles.editorSwitch}><Text style={styles.bold}>Ativo</Text><Switch value={draft.ativo !== false} onValueChange={(value) => set("ativo", value)} /></View>
        <View style={styles.editorActions}>
          {!isNew && <Pressable style={styles.dangerButton} onPress={remove}><Ionicons name="trash-outline" size={20} color={colors.red} /><Text style={styles.dangerText}>Excluir</Text></Pressable>}
          <Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar</Text></Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}
function AdminApplications({ items, reload, authToken, onAction }: { items: Aplicacao[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<Aplicacao | null>(null);
  const create = () => setEditing({ id: createId("app"), nome: "Nova aplicação", slug: "nova-aplicacao", tipo: "Geral", ativo: true });
  return (
    <>
      <Text style={styles.adminTitle}>Aplicações</Text>
      <View style={styles.adminActions}><Pressable style={styles.adminYellowButton} onPress={create}><Ionicons name="add" size={20} color={colors.navy} /><Text style={styles.adminYellowText}>Criar</Text></Pressable><Pressable style={styles.adminSoftButton} onPress={reload}><Ionicons name="refresh" size={20} color={colors.navy} /><Text>Atualizar</Text></Pressable></View>
      {items.map((item) => <Pressable key={item.id} style={styles.adminListItem} onPress={() => setEditing(item)}><View style={styles.adminIconBox}><Ionicons name="git-branch-outline" size={24} color={colors.yellow} /></View><View style={styles.flex}><Text style={styles.adminItemTitle}>{item.nome}</Text><Text style={styles.mutedSmall}>{item.tipo || "Tipo não informado"} • {item.ativo === false ? "Inativa" : "Ativa"}</Text></View><Switch value={item.ativo !== false} onValueChange={async (value) => { try { await supabasePatch("Aplicacao", item.id, { ativo: value }, authToken); await reload(); } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao atualizar aplicação."); } }} /></Pressable>)}
      {editing && <ApplicationEditor item={editing} authToken={authToken} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </>
  );
}

function ApplicationEditor({ item, authToken, onClose, onSaved }: { item: Aplicacao; authToken?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const isNew = !item.slug || item.id.startsWith("app_");
  const [draft, setDraft] = useState<Aplicacao>(item);
  const set = (key: keyof Aplicacao, value: string | boolean | null) => setDraft({ ...draft, [key]: value });
  const save = async () => {
    try {
      const payload = { nome: draft.nome, slug: draft.slug || slugify(draft.nome), tipo: draft.tipo || null, ativo: draft.ativo !== false };
      if (isNew) await supabasePost("Aplicacao", { id: draft.id, ...payload }, authToken);
      else await supabasePatch("Aplicacao", item.id, payload, authToken);
      await onSaved();
      notify("Aplicação salva", "Registro salvo no Supabase.");
    } catch (err) { notify("Falha ao salvar", err instanceof Error ? err.message : "Não foi possível salvar."); }
  };
  const remove = () => Alert.alert("Excluir aplicação", "A exclusão pode falhar se houver vínculos com produtos.", [{ text: "Cancelar", style: "cancel" }, { text: "Excluir", style: "destructive", onPress: async () => { try { await supabaseDelete("Aplicacao", item.id, authToken); await onSaved(); } catch (err) { notify("Falha ao excluir", err instanceof Error ? err.message : "Não foi possível excluir."); } } }]);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.sheetOverlay} onPress={onClose} /><View style={styles.sheet}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{isNew ? "Criar aplicação" : "Editar aplicação"}</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View><AdminTextInput label="Nome" value={draft.nome} onChangeText={(value) => set("nome", value)} /><AdminTextInput label="Slug" value={draft.slug || ""} onChangeText={(value) => set("slug", value)} /><AdminTextInput label="Tipo" value={draft.tipo || ""} onChangeText={(value) => set("tipo", value)} /><View style={styles.editorSwitch}><Text style={styles.bold}>Ativo</Text><Switch value={draft.ativo !== false} onValueChange={(value) => set("ativo", value)} /></View><View style={styles.editorActions}>{!isNew && <Pressable style={styles.dangerButton} onPress={remove}><Ionicons name="trash-outline" size={20} color={colors.red} /><Text style={styles.dangerText}>Excluir</Text></Pressable>}<Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar</Text></Pressable></View></View></Modal>;
}

function AdminUsers({ users, reload, authToken, onAction }: { users: Usuario[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const [editing, setEditing] = useState<Usuario | null>(null);
  return (
    <>
      <Text style={styles.adminTitle}>Usuários</Text>
      <Text style={styles.adminSubtitle}>Usuários vinculados ao Supabase Auth. Edite papel e status da tabela User.</Text>
      {users.map((user) => <Pressable key={user.id} style={styles.adminListItem} onPress={() => setEditing(user)}><View style={styles.avatar}><Text style={styles.avatarText}>{user.name[0]}</Text></View><View style={styles.flex}><Text style={styles.adminItemTitle}>{user.name}</Text><Text style={styles.mutedSmall}>{user.company || "Sem empresa"} • {user.role} • {user.status}</Text></View><Ionicons name="create-outline" size={22} color={colors.navy} /></Pressable>)}
      {editing && <UserEditor user={editing} reload={reload} authToken={authToken} onClose={() => setEditing(null)} onAction={onAction} />}
    </>
  );
}

function UserEditor({ user, reload, authToken, onClose, onAction }: { user: Usuario; reload: () => void; authToken?: string; onClose: () => void; onAction: (message: string) => void }) {
  const [draft, setDraft] = useState<Usuario>(user);
  const set = (key: keyof Usuario, value: string) => setDraft({ ...draft, [key]: value });
  const save = async () => {
    try {
      await supabasePatch("User", user.id, {
        name: draft.name,
        company: draft.company || null,
        email: draft.email,
        role: draft.role,
        status: draft.status,
        phone: draft.phone || null,
        cnpj: draft.cnpj || null,
        address: draft.address || null,
        city: draft.city || null,
        state: draft.state || null,
        registrationNotes: draft.registrationNotes || null,
        notes: draft.notes || null,
        approvedAt: draft.status === "ACTIVE" ? (draft.approvedAt || new Date().toISOString()) : draft.approvedAt || null
      }, authToken);
      await reload();
      onClose();
      onAction("Usuário atualizado.");
    } catch (err) { onAction(err instanceof Error ? err.message : "Falha ao salvar usuário."); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.sheetOverlay} onPress={onClose} /><ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Editar usuário</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View><AdminTextInput label="Nome" value={draft.name} onChangeText={(value) => set("name", value)} /><AdminTextInput label="Empresa" value={draft.company || ""} onChangeText={(value) => set("company", value)} /><AdminTextInput label="E-mail" value={draft.email} onChangeText={(value) => set("email", value)} /><AdminTextInput label="Telefone / WhatsApp" value={draft.phone || ""} onChangeText={(value) => set("phone", value)} /><AdminTextInput label="CNPJ" value={draft.cnpj || ""} onChangeText={(value) => set("cnpj", value)} /><AdminTextInput label="Endereço" value={draft.address || ""} onChangeText={(value) => set("address", value)} /><AdminTextInput label="Cidade" value={draft.city || ""} onChangeText={(value) => set("city", value)} /><AdminTextInput label="UF" value={draft.state || ""} onChangeText={(value) => set("state", value)} /><Text style={styles.sheetLabel}>Papel</Text><AdminChoicePills items={[{ id: "ADMIN_MASTER", nome: "ADMIN_MASTER" }, { id: "ADMIN_COLABORADOR", nome: "ADMIN_COLABORADOR" }, { id: "NAO_CLIENTE", nome: "NAO_CLIENTE" }, { id: "CLIENTE", nome: "CLIENTE" }, { id: "REPRESENTANTE", nome: "REPRESENTANTE" }]} selectedId={draft.role} onSelect={(id) => set("role", id)} /><Text style={styles.sheetLabel}>Status</Text><AdminChoicePills items={[{ id: "PENDING", nome: "PENDING" }, { id: "ACTIVE", nome: "ACTIVE" }, { id: "INACTIVE", nome: "INACTIVE" }]} selectedId={draft.status} onSelect={(id) => set("status", id)} /><AdminTextInput label="Observações do cadastro" value={draft.registrationNotes || ""} onChangeText={(value) => set("registrationNotes", value)} multiline /><AdminTextInput label="Notas internas" value={draft.notes || ""} onChangeText={(value) => set("notes", value)} multiline /><Pressable style={styles.yellowButton} onPress={save}><Text style={styles.yellowButtonText}>Salvar usuário</Text></Pressable></ScrollView></Modal>;
}
function AdminPermissions({ permissions, reload, authToken, onAction }: { permissions: Permission[]; reload: () => void; authToken?: string; onAction: (message: string) => void }) {
  const toggle = async (permission: Permission, key: keyof Pick<Permission, "visibleToVisitor" | "visibleToNonClient" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">) => {
    try {
      await supabasePatch<Permission>("ProductFieldPermission", permission.id, { [key]: !permission[key] }, authToken);
      await reload();
    } catch (err) {
      onAction(err instanceof Error ? err.message : "Falha ao salvar permissão.");
    }
  };
  return (
    <>
      <Text style={styles.adminTitle}>Permissões</Text>
      <Text style={styles.adminSubtitle}>Tabela real ProductFieldPermission.</Text>
      <View style={styles.permissionHeader}><Text style={styles.permissionField}>Campo</Text>{["Vis.", "Não cli.", "Cli.", "Rep.", "Adm."].map((r) => <Text key={r} style={styles.permissionRole}>{r}</Text>)}</View>
      {permissions.map((field) => <View key={field.id} style={styles.permissionRow}><Text style={styles.permissionField}>{field.fieldLabel}</Text>{([
        ["visibleToVisitor", field.visibleToVisitor],
        ["visibleToNonClient", field.visibleToNonClient],
        ["visibleToClient", field.visibleToClient],
        ["visibleToRepresentative", field.visibleToRepresentative],
        ["visibleToAdmin", field.visibleToAdmin]
      ] as Array<[keyof Pick<Permission, "visibleToVisitor" | "visibleToNonClient" | "visibleToClient" | "visibleToRepresentative" | "visibleToAdmin">, boolean]>).map(([key, checked]) => <Pressable key={key} onPress={() => toggle(field, key)} style={[styles.permissionCheck, checked && styles.permissionCheckOn]}>{checked && <Ionicons name="checkmark" size={14} color={colors.navy} />}</Pressable>)}</View>)}
      <Text style={styles.mutedSmall}>As alteracoes sao salvas imediatamente no endpoint ProductFieldPermission.</Text>
    </>
  );
}

function AdminLeads({ leads, products }: { leads: Lead[]; products: Produto[] }) {
  const [selected, setSelected] = useState<Lead | null>(null);
  const productById = new Map(products.map((item) => [item.id, item]));
  const openWhatsLead = (lead: Lead) => Linking.openURL("https://wa.me/" + (lead.telefone || "5521973636891") + "?text=" + encodeURIComponent("Olá " + lead.nome + ", recebemos seu contato pela Briland."));
  return (
    <>
      <Text style={styles.adminTitle}>Leads e orçamentos</Text>
      {leads.length === 0 ? <EmptyState text="Nenhum lead encontrado." /> : leads.map((lead) => <Pressable key={lead.id} style={styles.leadCard} onPress={() => setSelected(lead)}><View style={styles.leadTop}><Text style={styles.adminItemTitle}>{lead.nome}</Text><Text style={styles.leadStatus}>{leadDepartment(lead.mensagem, lead.origem)}</Text></View><Text style={styles.mutedSmall}>{lead.status || "NOVO"} • {lead.empresa || "Sem empresa"} • {lead.cidade || "Cidade"}/{lead.estado || "UF"} • {productById.get(lead.produtoId ?? "")?.codigoInterno || "Sem produto"}</Text><Text style={styles.detailText} numberOfLines={3}>{leadMessageBody(lead.mensagem) || "Sem mensagem"}</Text><Text style={styles.openLeadText}>Toque para ler completo</Text></Pressable>)}
      {selected && <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}><Pressable style={styles.sheetOverlay} onPress={() => setSelected(null)} /><ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Lead recebido</Text><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View><DetailItem label="Nome" value={selected.nome || "Não informado"} /><DetailItem label="Área" value={leadDepartment(selected.mensagem, selected.origem)} /><DetailItem label="Empresa" value={selected.empresa || "Não informado"} /><DetailItem label="Telefone" value={selected.telefone || "Não informado"} /><DetailItem label="E-mail" value={selected.email || "Não informado"} /><DetailItem label="Produto" value={productById.get(selected.produtoId ?? "")?.nome || "Sem produto"} /><Text style={styles.sheetLabel}>Mensagem</Text><Text style={styles.leadMessageFull}>{leadMessageBody(selected.mensagem) || "Sem mensagem"}</Text><Pressable style={styles.whatsLead} onPress={() => openWhatsLead(selected)}><Ionicons name="logo-whatsapp" size={18} color={colors.green} /><Text style={styles.whatsLeadText}>Abrir WhatsApp</Text></Pressable></ScrollView></Modal>}
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
        <ImageUploadField label="Imagem da primeira tela" value={draft.initialImage} folder="app/inicial" authToken={authToken} help="Recomendado: 1080 x 1920 px. Mantenha o conteúdo principal até cerca de 65% da altura; a parte inferior recebe o box de entrada." onUploaded={(initialImage) => setDraft({ ...draft, initialImage })} />
      </AdminPanel>
      <AdminPanel title="Home">
        <ImageUploadField label="Imagem da home" value={draft.homeImage} folder="app/home" authToken={authToken} help="Recomendado: 1200 x 760 px, área segura para chamada e botão, JPG/PNG/WEBP até 5MB." onUploaded={(homeImage) => setDraft({ ...draft, homeImage })} />
      </AdminPanel>
      <AdminPanel title="Categorias e marcas">
        <Text style={styles.mutedSmall}>Imagens de categorias: edite em Admin / Categorias. Logos de marcas: edite em Admin / Marcas. Recomendado: 900 x 700 px para categorias e 600 x 300 px para logos.</Text>
      </AdminPanel>
      <Pressable style={styles.yellowButton} onPress={() => { setMedia(draft); notify("Mídia salva", "Configuração salva no AppSetting do Supabase."); }}><Text style={styles.yellowButtonText}>Aplicar mídia</Text></Pressable>
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

function AdminContent({ settings, setSettings }: { settings: AboutSettings; setSettings: (settings: AboutSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const update = (key: keyof AboutSettings, value: string) => setDraft({ ...draft, [key]: value });
  return (
    <>
      <Text style={styles.adminTitle}>Conteúdo</Text>
      <Text style={styles.adminSubtitle}>Textos institucionais exibidos na tela Sobre a Briland.</Text>
      <AdminTextInput label="Título" value={draft.title} onChangeText={(value) => update("title", value)} />
      <AdminTextInput label="Subtítulo" value={draft.subtitle} onChangeText={(value) => update("subtitle", value)} multiline />
      <AdminTextInput label="Texto principal" value={draft.body} onChangeText={(value) => update("body", value)} multiline />
      <Pressable style={styles.yellowButton} onPress={() => { setSettings(draft); notify("Conteúdo salvo", "Texto institucional salvo no AppSetting do Supabase."); }}><Text style={styles.yellowButtonText}>Salvar conteúdo</Text></Pressable>
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

function ImageUploadField({ label, value, folder, authToken, help, onUploaded, onClear }: { label: string; value: string; folder: string; authToken?: string; help: string; onUploaded: (url: string) => void; onClear?: () => void }) {
  const [uploading, setUploading] = useState(false);
  const pick = async () => {
    try {
      setUploading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
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
      {value ? <Image source={{ uri: optimizedImageUrl(value, imageSize.productCard) }} style={styles.uploadPreview} resizeMode="contain" /> : <View style={styles.uploadEmpty}><Ionicons name="image-outline" size={26} color={colors.yellow} /><Text style={styles.mutedSmall}>Nenhuma imagem enviada.</Text></View>}
      <Pressable style={styles.adminSoftButtonWide} onPress={pick} disabled={uploading}>
        {uploading ? <ActivityIndicator color={colors.navy} /> : <Ionicons name="cloud-upload-outline" size={20} color={colors.navy} />}
        <Text style={styles.adminYellowText}>{uploading ? "Enviando..." : "Selecionar imagem"}</Text>
      </Pressable>
      {value && onClear && <Pressable style={styles.clearMediaButton} onPress={onClear}><Ionicons name="close-circle-outline" size={18} color={colors.red} /><Text style={styles.dangerText}>Remover imagem deste cadastro</Text></Pressable>}
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

function SideMenu({ visible, onClose, go, onLogout, role, user, links }: { visible: boolean; onClose: () => void; go: (route: Route) => void; onLogout: () => void; role: Role; user: Usuario | null; links: SocialLinks }) {
  const sections: { title: string; items: [Route, string, IconName][] }[] = [
    { title: "Catálogo", items: [["home", "Início", "home-outline"], ["categories", "Categorias", "grid-outline"], ["vehicleBrands", "Montadoras", "car-sport-outline"], ["products", "Produtos", "cube-outline"], ["launches", "Lançamentos", "star-outline"], ["promotions", "Promoções", "pricetag-outline"]] },
    { title: "Atendimento", items: [["contact", "Contatos", "headset-outline"]] },
    { title: "Briland", items: [["about", "Sobre a Briland", "information-circle-outline"]] },
    { title: "Privacidade e conta", items: [["privacy", "Política de Privacidade", "shield-checkmark-outline"], ["accountDeletion", "Excluir cadastro", "trash-outline"]] }
  ];
  const accountAction = () => {
    if (role === "VISITANTE") go("login");
    else onLogout();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}><BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /></Pressable>
      <View style={styles.sideMenu}>
        <View style={styles.sideHeader}>
          <View style={styles.sideBrandPlate}><Image source={logo} style={styles.sideLogo} resizeMode="contain" /></View>
          <Pressable style={styles.sideClose} onPress={onClose}><Ionicons name="close" size={24} color={colors.navy} /></Pressable>
        </View>
        <ScrollView style={styles.sideMenuScroll} contentContainerStyle={styles.sideMenuContent} showsVerticalScrollIndicator={false} bounces>
          <View style={styles.sideTitleBlock}><Text style={styles.sideTitle}>Menu</Text><Text style={styles.sideSubtitle}>Acessos e informações</Text></View>
          <View style={styles.sideAccountCard}>
            <View style={styles.sideAccountIcon}><Ionicons name="person-outline" size={27} color={colors.navy} /></View>
            <View style={styles.flex}><Text style={styles.sideAccountTitle}>{user?.name || "Acesse sua conta"}</Text>{user && <Text style={styles.sideAccountMeta}>{role}</Text>}</View>
            <Pressable style={styles.sideAccountButton} onPress={accountAction}><Text style={styles.sideAccountButtonText}>{role === "VISITANTE" ? "Entrar" : "Sair"}</Text></Pressable>
          </View>
          {sections.map((section) => (
            <View key={section.title} style={styles.sideSection}>
              <Text style={styles.sideSectionTitle}>{section.title}</Text>
              {section.items.map(([target, label, icon]) => {
                const danger = target === "accountDeletion";
                return <Pressable key={label} style={styles.sideItem} onPress={() => go(target)}><Ionicons name={icon} size={23} color={danger ? colors.red : colors.navy} /><Text style={[styles.sideLabel, danger && styles.sideLabelDanger]}>{label}</Text><Ionicons name="chevron-forward" size={20} color={danger ? colors.red : colors.navy} /></Pressable>;
              })}
            </View>
          ))}
          {isAdminRole(role) && <View style={styles.sideSection}><Text style={styles.sideSectionTitle}>Gestão</Text><Pressable style={styles.sideItem} onPress={() => go("admin")}><Ionicons name="speedometer-outline" size={23} color={colors.navy} /><Text style={styles.sideLabel}>Painel admin</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></Pressable></View>}
          <View style={styles.sideSocialDock}>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.instagram)}><Ionicons name="logo-instagram" size={24} color={colors.navy} /></Pressable>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.linkedin)}><Ionicons name="logo-linkedin" size={24} color={colors.navy} /></Pressable>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.whatsapp)}><Ionicons name="logo-whatsapp" size={24} color={colors.navy} /></Pressable>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.site)}><Ionicons name="globe-outline" size={24} color={colors.navy} /></Pressable>
          </View>
          <Text style={styles.sideCopyright}>© 2026 Briland. Todos os direitos reservados.</Text>
        </ScrollView>
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

function CatalogPdfButton({ url }: { url: string }) {
  return (
    <Pressable style={styles.catalogPdfButton} onPress={() => Linking.openURL(url)}>
      <View style={styles.catalogPdfIcon}><Ionicons name="document-text-outline" size={22} color={colors.navy} /></View>
      <View style={styles.flex}>
        <Text style={styles.catalogPdfTitle}>Download PDF do catálogo</Text>
        <Text style={styles.mutedSmall}>Catálogo organizado por categorias</Text>
      </View>
      <Ionicons name="download-outline" size={24} color={colors.navy} />
    </Pressable>
  );
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
  return <View style={styles.infoCard}><Ionicons name={icon} size={30} color={colors.yellow} /><View style={styles.infoCardContent}><Text style={styles.metaLabel}>{label}</Text><Text style={[styles.infoValue, green && styles.greenText]} numberOfLines={2}>{value}</Text>{small && <Text style={styles.mutedSmall}>{small}</Text>}</View></View>;
}

function Accordion({ title, children, open }: { title: string; children?: React.ReactNode; open?: boolean }) {
  const [expanded, setExpanded] = useState(Boolean(open));
  return <View style={styles.accordion}><Pressable style={styles.accordionHeader} onPress={() => setExpanded((value) => !value)}><Text style={styles.bold}>{title}</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={21} color={colors.navy} /></Pressable>{expanded && <View>{children || <Text style={styles.mutedSmall}>Nenhuma informacao cadastrada.</Text>}</View>}</View>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailItem}><Text style={styles.detailSub}>{label}</Text><Text style={styles.detailText}>{value}</Text></View>;
}

function Choice({ title, subtitle, selected, icon, onPress }: { title: string; subtitle: string; selected?: boolean; icon: IconName; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>{selected && <View style={styles.choiceCheck}><Ionicons name="checkmark" size={15} color={colors.white} /></View>}<Ionicons name={icon} size={32} color={colors.navy} /><Text style={styles.choiceTitle}>{title}</Text><Text style={styles.choiceSub}>{subtitle}</Text></Pressable>;
}

function Input({ label, value, onChangeText, required = true, secure = false }: { label: string; value: string; onChangeText: (text: string) => void; required?: boolean; secure?: boolean }) {
  const isEmail = label.toLowerCase().includes("e-mail");
  return <View style={styles.inputGroup}><Text style={styles.label}>{label}{required ? <> <Text style={styles.required}>*</Text></> : null}</Text><View style={styles.input}><Ionicons name={secure ? "lock-closed-outline" : "document-text-outline"} size={21} color={colors.muted} /><TextInput value={value} onChangeText={onChangeText} secureTextEntry={secure} autoCapitalize={secure || isEmail ? "none" : "sentences"} keyboardType={isEmail ? "email-address" : "default"} placeholder={`Digite ${label.toLowerCase()}`} style={styles.inputText} placeholderTextColor="#9BA0AA" /></View></View>;
}

function DarkInput({ icon, value, onChangeText, placeholder, secure }: { icon: IconName; value?: string; onChangeText?: (text: string) => void; placeholder: string; secure?: boolean }) {
  return <View style={styles.darkInput}><Ionicons name={icon} size={25} color={colors.white} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={secure} placeholderTextColor="#8EA0BB" style={styles.darkInputText} /></View>;
}

function Divider({ text, dark, compact }: { text: string; dark?: boolean; compact?: boolean }) {
  return <View style={[styles.divider, compact && styles.dividerCompact]}><View style={[styles.dividerLine, dark && styles.dividerLineDark]} /><Text style={[styles.dividerText, dark && styles.dividerTextDark]}>{text}</Text><View style={[styles.dividerLine, dark && styles.dividerLineDark]} /></View>;
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
  appRoot: { flex: 1, backgroundColor: colors.soft },
  safe: { flex: 1, backgroundColor: colors.soft },
  screen: { flex: 1, backgroundColor: colors.soft },
  pageTransition: { flex: 1 },
  catalogStage: { flex: 1, position: "relative" },
  detailOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  contentWithDock: { paddingHorizontal: 20, paddingBottom: 100 },
  initialScreen: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.soft, overflow: "hidden" },
  initialBackgroundImage: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%", backgroundColor: colors.white },
  initialFallback: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  loadingOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, overflow: "hidden", backgroundColor: "#021126", alignItems: "center" },
  loadingCenter: { position: "absolute", top: "36%", left: 24, right: 24, alignItems: "center" },
  loadingLogo: { width: 285, maxWidth: "86%", height: 92 },
  loadingTitle: { color: colors.white, marginTop: 22, fontSize: 25, lineHeight: 31, fontWeight: "900", textAlign: "center", letterSpacing: -0.5 },
  loadingText: { color: "#6784AC", marginTop: 13, fontSize: 16, lineHeight: 22, fontWeight: "500", textAlign: "center" },
  loadingRoute: { position: "absolute", top: "66%", width: 330, maxWidth: "88%", height: 52 },
  loadingRouteStart: { position: "absolute", left: 0, top: 15, width: "34%", height: 4, borderRadius: 4, backgroundColor: colors.yellow, shadowColor: colors.yellow, shadowOpacity: 0.75, shadowRadius: 7, elevation: 6 },
  loadingRouteDown: { position: "absolute", left: "32%", top: 22, width: 34, height: 4, borderRadius: 4, backgroundColor: colors.yellow, transform: [{ rotate: "25deg" }] },
  loadingRouteMiddle: { position: "absolute", left: "41%", top: 29, width: "23%", height: 4, borderRadius: 4, backgroundColor: colors.yellow },
  loadingRouteUp: { position: "absolute", left: "62%", top: 22, width: 28, height: 4, borderRadius: 4, backgroundColor: colors.yellow, transform: [{ rotate: "-25deg" }] },
  loadingRouteEnd: { position: "absolute", left: "69%", top: 15, right: 8, height: 4, borderRadius: 4, backgroundColor: colors.yellow, shadowColor: colors.yellow, shadowOpacity: 0.75, shadowRadius: 7, elevation: 6 },
  loadingRouteGlow: { position: "absolute", right: -4, top: 7, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.yellow, shadowColor: colors.yellow, shadowOpacity: 1, shadowRadius: 15, elevation: 10 },
  loadingRouteDot: { position: "absolute", right: 0, top: 11, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.yellow },
  loadingFooter: { position: "absolute", bottom: 48, left: 20, right: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 13 },
  loadingFooterText: { color: "#6784AC", fontSize: 14, fontWeight: "500" },
  loadingFooterDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.yellow },
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
  initialMediaFrame: { width: "100%", height: 470, borderRadius: 18, overflow: "hidden", backgroundColor: colors.white },
  initialImage: { width: "100%", height: "100%", backgroundColor: colors.white },
  welcomeSheet: { marginHorizontal: 20, marginBottom: 22, maxWidth: 430, alignSelf: "stretch", borderRadius: 34, backgroundColor: "rgba(255,255,255,0.96)", paddingHorizontal: 26, paddingTop: 28, paddingBottom: 24, alignItems: "center", ...shadow },
  welcomeSheetCompact: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 20, borderRadius: 28 },
  welcomeSheetRoomy: { paddingTop: 32, paddingBottom: 28 },
  welcomeTitle: { fontSize: 25, fontWeight: "900", color: colors.navy },
  welcomeTitleCompact: { fontSize: 22 },
  centerMuted: { color: colors.muted, textAlign: "center", fontSize: 17, lineHeight: 25, marginVertical: 16 },
  centerMutedCompact: { fontSize: 15, lineHeight: 21, marginVertical: 12 },
  slideTrack: { width: "100%", height: 64, borderRadius: 34, backgroundColor: colors.navy, justifyContent: "center", overflow: "hidden", paddingHorizontal: 8, marginTop: 4 },
  slideFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.yellow, borderRadius: 34 },
  slideText: { color: colors.white, fontWeight: "800", fontSize: 15, textAlign: "center", paddingLeft: 50, zIndex: 1 },
  slideThumb: { position: "absolute", zIndex: 2, left: 7, width: 51, height: 51, borderRadius: 26, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
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
  catalogPdfButton: { minHeight: 74, borderRadius: 18, backgroundColor: colors.white, padding: 14, marginBottom: 14, flexDirection: "row", alignItems: "center", gap: 13, borderWidth: 1, borderColor: colors.line, ...shadow },
  catalogPdfIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  catalogPdfTitle: { color: colors.navy, fontSize: 16, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  titleBlock: { marginTop: 14, marginBottom: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pageTitle: { fontSize: 35, color: colors.navy, fontWeight: "900", letterSpacing: 0 },
  pageSubtitle: { color: colors.muted, fontSize: 17, lineHeight: 25, marginTop: 4 },
  titleAccent: { width: 58, height: 3, backgroundColor: colors.yellow, borderRadius: 4, marginTop: 14 },
  badge: { backgroundColor: colors.yellow, color: colors.white, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14 },
  list: { gap: 12 },
  productColumns: { justifyContent: "space-between", marginBottom: 14 },
  categoryCard: { width: "47.4%", minHeight: 188, borderRadius: 14, backgroundColor: colors.white, padding: 15, paddingRight: 36, overflow: "hidden", ...shadow },
  categoryIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  categoryImage: { width: 44, height: 44 },
  categoryName: { color: colors.navy, fontSize: 17, lineHeight: 21, fontWeight: "900", marginBottom: 28 },
  categoryArrow: { position: "absolute", right: 13, bottom: 13 },
  vehicleBrandCard: { width: "47.4%", minHeight: 168, borderRadius: 14, backgroundColor: colors.white, padding: 15, paddingRight: 42, overflow: "hidden", ...shadow },
  vehicleBrandIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  vehicleBrandImage: { width: 44, height: 44 },
  vehicleBrandName: { color: colors.navy, fontSize: 19, lineHeight: 23, fontWeight: "900", marginBottom: 6 },
  vehicleBrandArrow: { position: "absolute", right: 14, bottom: 14 },
  searchRow: { flexDirection: "row", gap: 12 },
  searchBox: { flex: 1, height: 58, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 10, ...shadow },
  searchInput: { flex: 1, fontSize: 15, color: colors.navy },
  filterButton: { height: 58, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 8, ...shadow },
  filterText: { color: colors.navy, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 14 },
  chip: { borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 8, ...shadow },
  chipText: { color: colors.navy, fontWeight: "600" },
  modelFilterPanel: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 14, ...shadow },
  resultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  segment: { flexDirection: "row", borderRadius: 22, backgroundColor: colors.white, padding: 4, ...shadow },
  segmentActive: { width: 42, height: 36, borderRadius: 18, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  segmentLight: { width: 42, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  productCard: { width: "47.4%", minHeight: 324, borderRadius: 12, backgroundColor: colors.white, overflow: "hidden", borderWidth: 1, borderColor: colors.line, ...shadow },
  productListCard: { width: "100%", minHeight: 154, marginBottom: 12, borderRadius: 14, backgroundColor: colors.white, overflow: "hidden", borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "stretch", ...shadow },
  promoCard: { borderColor: "#F4A7B1" },
  launchCard: { borderColor: colors.yellow },
  listImageWrap: { width: 118, padding: 10, justifyContent: "flex-start", alignItems: "center", backgroundColor: colors.white },
  productImage: { width: "100%", height: 136, backgroundColor: colors.white },
  productListImage: { width: 98, height: 98, backgroundColor: colors.white },
  productListPlaceholder: { width: 98, height: 98, borderRadius: 14, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  ribbon: { position: "absolute", left: 8, top: 8, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, transform: [{ rotate: "-9deg" }] },
  ribbonText: { color: colors.white, fontWeight: "900", fontSize: 11 },
  productBody: { flex: 1, padding: 13 },
  productCode: { color: colors.navy, fontSize: 16, fontWeight: "900" },
  productName: { color: colors.muted, fontSize: 13, minHeight: 52, lineHeight: 17, marginTop: 2 },
  cardLine: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  meta: { flexDirection: "row", gap: 8, marginBottom: 8 },
  metaLabel: { color: colors.navy, fontSize: 12, fontWeight: "800" },
  metaValue: { color: colors.navy, fontSize: 12, flexShrink: 1 },
  price: { color: colors.red, fontWeight: "900", fontSize: 16 },
  loginHint: { color: colors.yellow, fontWeight: "900", marginTop: 4 },
  detailMedia: { height: 390, borderRadius: 22, overflow: "hidden", backgroundColor: colors.white, marginBottom: 20, ...shadow },
  detailImageStack: { flex: 1, backgroundColor: colors.white },
  detailImage: { width: "100%", height: "100%", backgroundColor: colors.white },
  detailImageOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "transparent" },
  dotsOverlay: { position: "absolute", bottom: 22, alignSelf: "center", flexDirection: "row", gap: 8 },
  smallYellow: { color: colors.yellow, fontWeight: "900", marginBottom: 6 },
  detailTitle: { color: colors.navy, fontSize: 27, fontWeight: "900", lineHeight: 34 },
  statRow: { flexDirection: "row", gap: 12, marginVertical: 20 },
  infoCard: { flex: 1, minHeight: 88, borderRadius: 14, backgroundColor: colors.white, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, ...shadow },
  infoCardContent: { flex: 1, minWidth: 0 },
  infoValue: { color: colors.navy, fontSize: 16, lineHeight: 20, fontWeight: "900", flexShrink: 1 },
  greenText: { color: colors.green },
  accordion: { backgroundColor: colors.white, borderRadius: 15, padding: 16, marginBottom: 10, ...shadow },
  accordionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 16 },
  detailItem: { width: "50%", borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  detailSub: { color: colors.muted, fontSize: 13, marginTop: 10 },
  detailText: { color: colors.navy, fontSize: 14, lineHeight: 21, marginTop: 8 },
  vehicleApplicationBox: { marginTop: 14, gap: 10 },
  vehicleApplicationItem: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 },
  downloadButton: { alignSelf: "flex-start", minHeight: 44, borderRadius: 12, backgroundColor: colors.yellow, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 14 },
  downloadText: { color: colors.navy, fontWeight: "900", fontSize: 15 },
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
  inputGroup: { width: "100%", marginBottom: 16 },
  input: { height: 58, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  inputMultiline: { height: 132, alignItems: "flex-start", paddingVertical: 12, flexDirection: "column" },
  inputText: { flex: 1, color: colors.navy, fontSize: 15 },
  inputTextMultiline: { flex: 0, height: 104, width: "100%", lineHeight: 20 },
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
  legalLinksRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 18, marginTop: 18, paddingBottom: 18 },
  loginLegalLink: { color: colors.white, textDecorationLine: "underline", fontSize: 13, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", gap: 14, width: "100%", marginVertical: 22 },
  dividerCompact: { marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#D6D8DE" },
  dividerLineDark: { backgroundColor: "rgba(255,255,255,0.18)" },
  dividerText: { color: colors.muted },
  dividerTextDark: { color: "#AAB6C8" },
  signupContent: { paddingHorizontal: 22, paddingBottom: 122 },
  checkRow: { flexDirection: "row", gap: 12, marginVertical: 12 },
  emptyCheck: { width: 28, height: 28, borderRadius: 5, borderWidth: 2, borderColor: colors.navy, alignItems: "center", justifyContent: "center" },
  checkedBox: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  checkText: { flex: 1, color: colors.navy, lineHeight: 22 },
  inlineLegalLink: { color: colors.navy, textDecorationLine: "underline", fontWeight: "800", textAlign: "center", marginBottom: 14 },
  disabledButton: { opacity: 0.45 },
  loginLink: { textAlign: "center", color: colors.navy, marginVertical: 16 },
  legalContent: { paddingHorizontal: 20, paddingBottom: 110 },
  legalCard: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 22, gap: 10, ...shadow },
  legalHeading: { color: colors.navy, fontSize: 18, fontWeight: "900", marginTop: 8 },
  legalParagraph: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  legalAction: { minHeight: 54, marginTop: 12, borderRadius: 12, backgroundColor: colors.yellow, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  legalActionText: { color: colors.navy, fontWeight: "900" },
  legalActionSecondary: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: "#F3C3CB", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  dangerSubmitButton: { minHeight: 56, borderRadius: 12, backgroundColor: colors.red, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  dangerSubmitText: { color: colors.white, fontWeight: "900", fontSize: 16 },
  deletionSuccess: { alignItems: "center", gap: 10, paddingVertical: 24 },
  aboutCard: { minHeight: 520, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, padding: 22, ...shadow },
  aboutText: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  aboutBody: { color: colors.navy, fontSize: 16, lineHeight: 25, marginTop: 28 },
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
  adminActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 16 },
  adminYellowButton: { height: 48, borderRadius: 12, backgroundColor: colors.yellow, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7 },
  adminYellowText: { color: colors.navy, fontWeight: "900" },
  adminSoftButton: { height: 48, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, ...shadow },
  adminSoftButtonWide: { minHeight: 48, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.line, ...shadow },
  clearMediaButton: { minHeight: 42, borderRadius: 12, backgroundColor: "#FFF1F3", paddingHorizontal: 12, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#F6B4BE" },
  dangerButton: { minHeight: 58, borderRadius: 13, backgroundColor: "#FFF1F3", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#F6B4BE" },
  dangerText: { color: colors.red, fontWeight: "900" },
  editorActions: { flexDirection: "row", gap: 10, marginTop: 10, alignItems: "center" },
  extraImageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  extraImageItem: { width: "31%", height: 86, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  extraImage: { width: "100%", height: "100%" },
  extraRemove: { position: "absolute", right: 5, top: 5, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
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
  openLeadText: { color: colors.yellow, fontWeight: "900", marginTop: 10 },
  leadMessageFull: { color: colors.navy, fontSize: 15, lineHeight: 23, backgroundColor: colors.soft, borderRadius: 12, padding: 14 },
  menuOverlay: { flex: 1 },
  sideMenu: { position: "absolute", left: 0, top: 0, bottom: 0, width: "90%", maxWidth: 430, backgroundColor: colors.white, borderTopRightRadius: 28, borderBottomRightRadius: 28, overflow: "hidden", ...shadow },
  sideHeader: { height: 92, paddingHorizontal: 20, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sideBrandPlate: { width: 190, height: 58, borderRadius: 14, backgroundColor: colors.navy, paddingHorizontal: 20, justifyContent: "center" },
  sideLogo: { width: "100%", height: 42 },
  sideClose: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  sideMenuScroll: { flex: 1 },
  sideMenuContent: { paddingBottom: 38 },
  sideTitleBlock: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 16 },
  sideTitle: { color: colors.navy, fontSize: 34, lineHeight: 40, fontWeight: "900" },
  sideSubtitle: { color: colors.muted, fontSize: 15, marginTop: 2 },
  sideAccountCard: { minHeight: 82, marginHorizontal: 20, marginBottom: 22, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 13, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.white },
  sideAccountIcon: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  sideAccountTitle: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  sideAccountMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  sideAccountButton: { minWidth: 68, height: 40, borderRadius: 13, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center", paddingHorizontal: 13 },
  sideAccountButtonText: { color: colors.navy, fontSize: 14, fontWeight: "900" },
  sideSection: { marginHorizontal: 22, marginBottom: 18 },
  sideSectionTitle: { color: colors.navy, fontSize: 16, fontWeight: "900", marginBottom: 4 },
  sideItem: { minHeight: 58, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", gap: 15 },
  sideLabel: { flex: 1, color: colors.navy, fontWeight: "600", fontSize: 16 },
  sideLabelDanger: { color: colors.red },
  sideSocialDock: { height: 60, marginHorizontal: 32, marginTop: 8, marginBottom: 18, borderRadius: 30, backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-around", ...shadow },
  sideSocialIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sideCopyright: { color: "#A7ADB8", fontSize: 10, textAlign: "center", fontWeight: "500", paddingHorizontal: 24 },
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
  brandedMediaCard: { height: 136, minHeight: 136 },
  brandedMediaTall: { minHeight: 390 },
  brandedMediaCompact: { width: 132, minHeight: 132 },
  brandedMediaLogo: { width: "72%", height: 54, marginBottom: 10 },
  brandedMediaTitle: { color: colors.white, fontWeight: "900", fontSize: 18, textAlign: "center" },
  brandedMediaSub: { color: "#D9E2F2", fontSize: 12, marginTop: 4, textAlign: "center" },
  adminThumbPlaceholder: { width: 62, height: 62, borderRadius: 10, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  editorSwitch: { height: 48, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }
});

