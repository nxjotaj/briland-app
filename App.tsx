import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Network from "expo-network";
import * as Sharing from "expo-sharing";
import * as Updates from "expo-updates";
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
  Share,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

import { CONFIG_STORAGE_KEY, getPersistedSession, requestPasswordReset, resendSignupConfirmation, setTelemetryContext, signInWithPassword, signOutSession, signUpRegistration, supabaseDelete, supabaseGet, supabasePatch, supabasePost, supabasePostMinimal, supabaseRealtime, supabaseRpc, trackTelemetry, updateCurrentPassword, uploadStorageObject } from "./src/api/supabase";
import { colors, defaultAbout, defaultSocialLinks } from "./src/config/brand";
import type { AboutSettings, Aplicacao, AppData, CatalogAppearance, CatalogPdfRole, CatalogPdfSettings, CatalogRevision, Categoria, GrupoProduto, Lead, Marca, MediaSettings, ModeloVeiculo, Montadora, Permission, Produto, ProdutoModeloVeiculo, ProdutoModeloVeiculoView, Role, Route, SalesOrder, SalesOrderItem, SalesStock, SocialLinks, Subcategoria, Usuario } from "./src/types/domain";
import { createId, csvEscape, leadDepartment, leadMessageBody, loginErrorMessage, money, optimizedImageUrl, parseCsv, slugify } from "./src/utils/helpers";
import { MotionDrawer, MotionPage, MotionPressable } from "./src/components/motion";

type IconName = keyof typeof Ionicons.glyphMap;
type RegistrationRequest = { nome: string; empresa: string; telefone: string; email: string; cnpj: string; observacoes: string; senha: string; confirmarSenha: string };
type CachedImageProps = ImageProps & { resizeMode?: ImageProps["contentFit"] };
type CatalogNotification = { id: string; type: "launch" | "promotion" | "availability"; title: string; message: string; productId: string; createdAt: string; read?: boolean };

const logo = require("./assets/briland-logo.png");
const loadingBlueprint = require("./assets/loading-automotive-blueprint.png");
const FAVORITES_STORAGE_KEY = "briland-favorite-products";
const VISIT_STORAGE_KEY = "briland-last-visit";
const NOTIFICATION_STORAGE_KEY = "briland-catalog-notifications";
const PRODUCT_SNAPSHOT_STORAGE_KEY = "briland-product-snapshot";
const ANALYTICS_VISITOR_STORAGE_KEY = "briland-analytics-visitor";
const ANALYTICS_LOCATION_STORAGE_KEY = "briland-analytics-location";
const CATALOG_REVISION_STORAGE_KEY = "briland-catalog-revision";
const CATALOG_UI_STATE_STORAGE_KEY = "briland-catalog-ui-state";
const CATALOG_PUBLIC_URL = "https://briland-catalogo.vercel.app";
const PRIVACY_POLICY_URL = "https://briland-catalogo.vercel.app/privacidade.html";
const ACCOUNT_DELETION_URL = "https://briland-catalogo.vercel.app/excluir-conta.html";
const vehicleYears = () => Array.from({ length: new Date().getFullYear() + 2 - 1950 }, (_, index) => 1950 + index).reverse();
const onlyDigits = (value: string) => value.replace(/\D/g, "");
const normalizeSearchText = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .trim();
const matchesAllSearchTerms = (query: string, ...values: unknown[]) => {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchableText = normalizeSearchText(values.join(" "));
  return terms.every((term) => searchableText.includes(term));
};
const maskCnpj = (value: string) => onlyDigits(value).slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
const maskCep = (value: string) => onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const maskPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return digits.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};
const vehicleApplicationLabel = (application: ProdutoModeloVeiculoView) => {
  if (!application.anoInicial || !application.anoFinal) return "Todos os anos";
  return application.anoInicial === application.anoFinal ? String(application.anoInicial) : `${application.anoInicial} a ${application.anoFinal}`;
};
function initialAppRoute(): Route {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const action = new URL(window.location.href).searchParams.get("acao");
    if (action === "excluir-conta") return "accountDeletion";
    if (action === "privacidade") return "privacy";
    if (action === "login") return "login";
    if (action === "redefinir-senha") return "resetPassword";
  }
  return "initial";
}

function initialProductReference() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return new URL(window.location.href).searchParams.get("produto") || "";
  }
  return "";
}

function productPublicUrl(product: Produto) {
  return `${CATALOG_PUBLIC_URL}/?produto=${encodeURIComponent(product.slug || product.id)}`;
}

function whatsappWithText(baseUrl: string, text: string) {
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
}

type ApproxLocation = { city: string | null; state: string | null; country: string | null; cachedAt: number };
async function approximateLocation(): Promise<ApproxLocation> {
  const cached = await AsyncStorage.getItem(ANALYTICS_LOCATION_STORAGE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ApproxLocation;
      if (Date.now() - parsed.cachedAt < 6 * 60 * 60 * 1000) return parsed;
    } catch { /* consulta novamente */ }
  }
  try {
    const response = await fetch("https://ipwho.is/");
    const payload = await response.json() as { success?: boolean; city?: string; region?: string; country?: string };
    const location = {
      city: payload.success === false ? null : payload.city?.slice(0, 120) || null,
      state: payload.success === false ? null : payload.region?.slice(0, 80) || null,
      country: payload.success === false ? null : payload.country?.slice(0, 80) || null,
      cachedAt: Date.now()
    };
    await AsyncStorage.setItem(ANALYTICS_LOCATION_STORAGE_KEY, JSON.stringify(location));
    return location;
  } catch {
    return { city: null, state: null, country: null, cachedAt: Date.now() };
  }
}

async function trackedDownload(url: string, metadata: Record<string, unknown> = {}, token?: string, onProgress?: (progress: number | null) => void) {
  if (!url) return false;
  void trackTelemetry({ eventType: "download_started", screen: "download", route: "download", success: true, metadata }, token);
  try {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const response = await fetch(url);
      if (!response.ok) throw new Error("O arquivo não está disponível.");
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (contentType.includes("text/html")) throw new Error("O endereço informado abre uma página em vez de um arquivo.");
      const total = Number(response.headers.get("content-length")) || 0;
      let blob: Blob;
      if (response.body && total) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress?.(Math.min(99, Math.round(received / total * 100)));
        }
        blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "application/pdf" });
      } else {
        onProgress?.(null);
        blob = await response.blob();
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = String(metadata.fileName || url.split("/").pop() || "arquivo");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } else {
      const fileName = String(metadata.fileName || url.split("/").pop() || `arquivo-${Date.now()}.pdf`).replace(/[^a-z0-9._-]/gi, "-");
      const download = FileSystem.createDownloadResumable(url, `${FileSystem.cacheDirectory}${fileName}`, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        onProgress?.(totalBytesExpectedToWrite > 0 ? Math.min(99, Math.round(totalBytesWritten / totalBytesExpectedToWrite * 100)) : null);
      });
      const result = await download.downloadAsync();
      if (!result) throw new Error("A transferência não foi concluída.");
      if (result.status < 200 || result.status >= 300) throw new Error("A transferência não foi concluída.");
      const resultHeaders = result.headers as Record<string, string> | undefined;
      const contentType = String(resultHeaders?.["content-type"] || resultHeaders?.["Content-Type"] || "").toLowerCase();
      if (contentType.includes("text/html")) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new Error("O endereço informado abre uma página em vez de um arquivo.");
      }
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri);
      else await Linking.openURL(result.uri);
    }
    void trackTelemetry({ eventType: "download_completed", screen: "download", route: "download", success: true, metadata }, token);
    void trackTelemetry({ eventType: "download_opened", screen: "download", route: "download", success: true, metadata }, token);
    onProgress?.(100);
    return true;
  } catch (error) {
    void trackTelemetry({ eventType: "download_failed", screen: "download", route: "download", success: false, message: error instanceof Error ? error.message : "Falha no download.", metadata }, token);
    if (metadata.fallbackToOriginalUrl === true) {
      try {
        await Linking.openURL(url);
        void trackTelemetry({ eventType: "download_opened", screen: "download", route: "download", success: true, metadata: { ...metadata, fallback: "original_url" } }, token);
        onProgress?.(100);
        return true;
      } catch { /* exibe o erro padrao abaixo */ }
    }
    notify("Download não concluído", "Não foi possível transferir o arquivo. Verifique sua internet e tente novamente.");
    return false;
  }
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
  navigationCard: { width: 900, height: 600, resize: "cover", quality: 90 } as const,
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

type UpdateControllerState = "atual" | "disponivel" | "baixando" | "aplicando" | "falhou";

const userSelect = "id,name,company,email,role,status,notes,phone,cnpj,stateRegistration,address,zipCode,neighborhood,city,state,representanteId,orderDiscountLimit,registrationNotes,approvedAt,approvedBy,lastLoginAt,createdAt,updatedAt,authUserId";
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
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [productGroupFilter, setProductGroupFilter] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [montadoraFilter, setMontadoraFilter] = useState<string | null>(null);
  const [modeloFilter, setModeloFilter] = useState<string | null>(null);
  const [anoFilter, setAnoFilter] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<"order" | "name" | "newest">("order");
  const [listMode, setListMode] = useState<"grid" | "list">("grid");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Produto | null>(null);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(defaultSocialLinks);
  const [mediaSettings, setMediaSettings] = useState<MediaSettings>({ initialImage: "", homeImage: "" });
  const [catalogPdfSettings, setCatalogPdfSettings] = useState<CatalogPdfSettings>({});
  const [aboutSettings, setAboutSettings] = useState<AboutSettings>(defaultAbout);
  const [appearance, setAppearance] = useState<CatalogAppearance>(defaultAppearance);
  const [mobileOrder, setMobileOrder] = useState<SalesOrder | null>(null);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [catalogNotifications, setCatalogNotifications] = useState<CatalogNotification[]>([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [pendingProductReference, setPendingProductReference] = useState(initialProductReference);
  const [loading, setLoading] = useState(true);
  const [imageRefreshVersion, setImageRefreshVersion] = useState(0);
  const [updateControllerState, setUpdateControllerState] = useState<UpdateControllerState>("atual");
  const [error, setError] = useState<string | null>(null);
  const initialLoadCompleted = useRef(false);
  const discoveryStartedAt = useRef(Date.now());
  const lastSearchTelemetry = useRef("");
  const realtimeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedCatalogRevision = useRef(0);
  const ignoredCatalogRevision = useRef(0);
  const revisionReady = useRef(false);
  const otaPromptShown = useRef(false);
  const uiStateRestored = useRef(false);
  const roleRef = useRef(role);
  const authTokenRef = useRef(authToken);
  const catalogScrollOffsets = useRef<Record<"products" | "promotions" | "launches", number>>({ products: 0, promotions: 0, launches: 0 });
  const appState = useRef(AppState.currentState);
  const presenceSessionId = useRef(`presence_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`);
  const [analyticsVisitorId, setAnalyticsVisitorId] = useState("");
  const [analyticsLocation, setAnalyticsLocation] = useState<ApproxLocation>({ city: null, state: null, country: null, cachedAt: 0 });
  const [presenceWake, setPresenceWake] = useState(0);
  const [codeUpdateWake, setCodeUpdateWake] = useState(0);
  const [data, setData] = useState<AppData>({
    produtos: [],
    categorias: [],
    subcategorias: [],
    gruposProduto: [],
    marcas: [],
    aplicacoes: [],
    montadoras: [],
    modelosVeiculo: [],
    produtoModelosVeiculo: [],
    usuarios: [],
    leads: [],
    permissoes: []
  });
  roleRef.current = role;
  authTokenRef.current = authToken;

  const reload = async (nextRole: Role = roleRef.current, token: string | undefined = authTokenRef.current, options?: { silent?: boolean; refreshImages?: boolean }) => {
    const startedAt = Date.now();
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const isPanelRole = isAdminRole(nextRole);
      const [visibleProducts, categorias, subcategorias, gruposProduto, marcas, aplicacoes, montadoras, modelosVeiculo, produtoModelosVeiculo, appSettings, rolePermissions] = await Promise.all([
        supabaseRpc<Produto[]>("get_visible_products", { requested_role: nextRole }, token),
        supabaseGet<Categoria>("Categoria", "select=*&order=ordem.asc", token),
        supabaseGet<Subcategoria>("Subcategoria", "select=*&order=ordem.asc", token),
        supabaseGet<GrupoProduto>("GrupoProduto", "select=*&order=ordem.asc", token),
        supabaseGet<Marca>("Marca", "select=*", token),
        supabaseGet<Aplicacao>("Aplicacao", "select=*", token),
        supabaseGet<Montadora>("Montadora", "select=*&order=nome.asc", token),
        supabaseGet<ModeloVeiculo>("ModeloVeiculo", "select=*&order=nome.asc", token),
        supabaseRpc<ProdutoModeloVeiculoView[]>("get_visible_vehicle_applications", {}, token),
        supabaseRpc<Record<string, unknown>>("get_app_settings", {}, token),
        supabaseRpc<Record<string, boolean>>("get_current_product_permissions", {}, token)
      ]);
      const produtos = visibleProducts.map((product) => ({ ...product, permissoesProduto: rolePermissions }));
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
        subcategorias,
        gruposProduto,
        marcas,
        aplicacoes,
        montadoras,
        modelosVeiculo,
        produtoModelosVeiculo,
        usuarios,
        leads,
        permissoes
      });
      setSelectedProduct((current) => {
        if (!current) return produtos[0] ?? null;
        const replacement = produtos.find((product) => product.id === current.id) ?? null;
        if (!replacement && route === "detail") {
          setRoute("products");
          notify("Produto indisponível", "Este produto foi removido ou não está mais disponível para o seu acesso.");
        }
        return replacement;
      });
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
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar dados do catálogo.";
      if (!options?.silent) setError(message);
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
      return false;
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

  const applyCatalogRevision = async (revision: number) => {
    setUpdateControllerState("aplicando");
    const updated = await reload(roleRef.current, authTokenRef.current, { silent: true, refreshImages: true });
    if (!updated) {
      setUpdateControllerState("falhou");
      Alert.alert("Não foi possível atualizar", "Confira sua internet e tente novamente.", [
        { text: "Depois", style: "cancel" },
        { text: "Tentar novamente", onPress: () => void applyCatalogRevision(revision) }
      ]);
      return;
    }
    appliedCatalogRevision.current = revision;
    await AsyncStorage.setItem(CATALOG_REVISION_STORAGE_KEY, String(revision));
    setUpdateControllerState("atual");
  };

  useEffect(() => {
    void AsyncStorage.getItem(CATALOG_UI_STATE_STORAGE_KEY).then((stored) => {
      if (!stored) return;
      try {
        const saved = JSON.parse(stored) as {
          route?: Route; query?: string; categoryFilter?: string | null; subcategoryFilter?: string | null; productGroupFilter?: string | null; brandFilter?: string | null;
          montadoraFilter?: string | null; modeloFilter?: string | null; anoFilter?: number | null;
          sortMode?: "order" | "name" | "newest"; listMode?: "grid" | "list";
          productReference?: string | null; scrollOffsets?: Record<"products" | "promotions" | "launches", number>;
        };
        if (!initialProductReference && saved.route) setRoute(saved.route);
        setQuery(saved.query || "");
        setCategoryFilter(saved.categoryFilter || null);
        setSubcategoryFilter(saved.subcategoryFilter || null);
        setProductGroupFilter(saved.productGroupFilter || null);
        setBrandFilter(saved.brandFilter || null);
        setMontadoraFilter(saved.montadoraFilter || null);
        setModeloFilter(saved.modeloFilter || null);
        setAnoFilter(saved.anoFilter || null);
        if (saved.sortMode) setSortMode(saved.sortMode);
        if (saved.listMode) setListMode(saved.listMode);
        if (!initialProductReference && saved.productReference) setPendingProductReference(saved.productReference);
        if (saved.scrollOffsets) catalogScrollOffsets.current = saved.scrollOffsets;
      } catch {
        // Estado antigo ou inválido é ignorado com segurança.
      }
    }).finally(() => { uiStateRestored.current = true; });
  }, []);

  useEffect(() => {
    if (!uiStateRestored.current) return;
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(CATALOG_UI_STATE_STORAGE_KEY, JSON.stringify({
        route, query, categoryFilter, subcategoryFilter, productGroupFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter,
        sortMode, listMode,
        productReference: selectedProduct?.slug || selectedProduct?.id || null,
        scrollOffsets: catalogScrollOffsets.current
      }));
    }, 250);
    return () => clearTimeout(timer);
  }, [route, query, categoryFilter, subcategoryFilter, productGroupFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter, sortMode, listMode, selectedProduct?.id]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const preserveBeforeCodeUpdate = () => {
      void AsyncStorage.setItem(CATALOG_UI_STATE_STORAGE_KEY, JSON.stringify({
        route, query, categoryFilter, subcategoryFilter, productGroupFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter,
        sortMode, listMode,
        productReference: selectedProduct?.slug || selectedProduct?.id || null,
        scrollOffsets: catalogScrollOffsets.current
      }));
    };
    window.addEventListener("briland-before-code-update", preserveBeforeCodeUpdate);
    return () => window.removeEventListener("briland-before-code-update", preserveBeforeCodeUpdate);
  }, [route, query, categoryFilter, subcategoryFilter, productGroupFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter, sortMode, listMode, selectedProduct?.id]);

  useEffect(() => {
    if (Platform.OS === "web" || !Updates.isEnabled) return;
    let active = true;
    const checkForCodeUpdate = async () => {
      if (!active || otaPromptShown.current || appState.current !== "active") return;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable || !active) return;
        otaPromptShown.current = true;
        Alert.alert("Nova versão disponível", "Há uma melhoria do aplicativo pronta para instalar.", [
          { text: "Depois", style: "cancel" },
          { text: "Atualizar agora", onPress: () => void (async () => {
            try {
              setUpdateControllerState("baixando");
              await Updates.fetchUpdateAsync();
              setUpdateControllerState("aplicando");
              await Updates.reloadAsync();
            } catch {
              otaPromptShown.current = false;
              setUpdateControllerState("falhou");
              notify("Não foi possível atualizar", "Confira sua internet e tente novamente mais tarde.");
            }
          })() }
        ]);
      } catch {
        // Uma falha de atualização de código não bloqueia o catálogo.
      }
    };
    const initialTimer = setTimeout(() => void checkForCodeUpdate(), 3000);
    const interval = setInterval(() => void checkForCodeUpdate(), 10 * 60 * 1000);
    return () => { active = false; clearTimeout(initialTimer); clearInterval(interval); };
  }, [codeUpdateWake]);

  const offerCatalogRevision = (revision: number) => {
    if (revision <= appliedCatalogRevision.current || revision <= ignoredCatalogRevision.current) return;
    if (realtimeReloadTimer.current) clearTimeout(realtimeReloadTimer.current);
    realtimeReloadTimer.current = setTimeout(() => {
      setUpdateControllerState("disponivel");
      Alert.alert(
        "O catálogo tem novas informações",
        "Produtos, imagens ou informações comerciais foram atualizados.",
        [
          { text: "Depois", style: "cancel", onPress: () => { ignoredCatalogRevision.current = revision; setUpdateControllerState("atual"); } },
          { text: "Atualizar agora", onPress: () => void applyCatalogRevision(revision) }
        ]
      );
    }, 1200);
  };

  useEffect(() => {
    void (async () => {
      let visitorId = "";
      const stored = await AsyncStorage.getItem(ANALYTICS_VISITOR_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { id: string; createdAt: number };
          if (parsed.id && Date.now() - parsed.createdAt < 30 * 86400000) visitorId = parsed.id;
        } catch { /* gera um identificador novo */ }
      }
      if (!visitorId) {
        visitorId = `visitor_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        await AsyncStorage.setItem(ANALYTICS_VISITOR_STORAGE_KEY, JSON.stringify({ id: visitorId, createdAt: Date.now() }));
      }
      const location = await approximateLocation();
      setAnalyticsVisitorId(visitorId);
      setAnalyticsLocation(location);
      setTelemetryContext({ sessionId: presenceSessionId.current, visitorId, city: location.city, state: location.state, country: location.country });
    })();
  }, []);

  useEffect(() => {
    if (!analyticsVisitorId) return;
    setTelemetryContext({ userId: currentUser?.id ?? null, userRole: role });
    let active = true;
    const heartbeat = async () => {
      if (!active || appState.current !== "active") return;
      let networkType = "Não informado";
      try {
        const network = await Network.getNetworkStateAsync();
        const raw = String(network.type || "").toUpperCase();
        networkType = raw.includes("WIFI") ? "Wi-Fi" : raw.includes("CELLULAR") ? "Dados móveis" : raw.includes("ETHERNET") ? "Cabo" : "Não informado";
      } catch { /* mantém indisponível */ }
      await supabaseRpc<void>("heartbeat_app_presence", {
        p_session_id: presenceSessionId.current,
        p_visitor_id: analyticsVisitorId,
        p_route: route,
        p_screen: route,
        p_source: Platform.OS === "web" ? "PWA_WEB" : Platform.OS === "ios" ? "APP_IOS" : "APP_ANDROID",
        p_device_type: Platform.OS === "web" ? "Navegador" : "Celular",
        p_operating_system: Platform.OS,
        p_network_type: networkType,
        p_city: analyticsLocation.city,
        p_state: analyticsLocation.state,
        p_country: analyticsLocation.country
      }, authToken).catch(() => undefined);
    };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [analyticsLocation.city, analyticsLocation.country, analyticsLocation.state, analyticsVisitorId, authToken, currentUser?.id, presenceWake, route]);

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
      if (event === "PASSWORD_RECOVERY" && session) {
        setAuthToken(session.access_token);
        setRoute("resetPassword");
      }
      if (event === "SIGNED_OUT") setAuthToken(undefined);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authToken) supabaseRealtime.realtime.setAuth(authToken);

    const channel = supabaseRealtime.channel(`catalog-revision-${role}`);
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "CatalogRevision" }, (payload) => {
      const revision = payload.new as CatalogRevision;
      if (!revisionReady.current || !revision?.revision) return;
      if (revision.changeKind === "SEGURANCA") {
        appliedCatalogRevision.current = Math.max(appliedCatalogRevision.current, Number(revision.revision));
        void AsyncStorage.setItem(CATALOG_REVISION_STORAGE_KEY, String(appliedCatalogRevision.current));
        void reload(role, authToken, { silent: true, refreshImages: false });
        return;
      }
      offerCatalogRevision(Number(revision.revision));
    });
    void channel.subscribe();

    return () => {
      if (realtimeReloadTimer.current) clearTimeout(realtimeReloadTimer.current);
      void supabaseRealtime.removeChannel(channel);
    };
  }, [authToken, role]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [revision] = await supabaseGet<CatalogRevision>("CatalogRevision", "select=*&id=eq.1");
        if (!active || !revision) return;
        const storedRaw = await AsyncStorage.getItem(CATALOG_REVISION_STORAGE_KEY);
        if (!storedRaw) {
          appliedCatalogRevision.current = Number(revision.revision);
          await AsyncStorage.setItem(CATALOG_REVISION_STORAGE_KEY, String(revision.revision));
        } else {
          appliedCatalogRevision.current = Number(storedRaw) || 0;
          if (revision.changeKind === "SEGURANCA") {
            appliedCatalogRevision.current = Number(revision.revision);
            await AsyncStorage.setItem(CATALOG_REVISION_STORAGE_KEY, String(revision.revision));
          } else if (Number(revision.revision) > appliedCatalogRevision.current) {
            offerCatalogRevision(Number(revision.revision));
          }
        }
      } catch {
        // A indisponibilidade do monitor nunca bloqueia o catálogo.
      } finally {
        revisionReady.current = true;
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" && appState.current === "active") supabaseRealtime.auth.startAutoRefresh();
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasInBackground = appState.current === "inactive" || appState.current === "background";
      appState.current = nextState;
      if (Platform.OS !== "web") {
        if (nextState === "active") supabaseRealtime.auth.startAutoRefresh();
        else supabaseRealtime.auth.stopAutoRefresh();
      }
      if (nextState === "active") {
        setPresenceWake((value) => value + 1);
        if (wasInBackground) setCodeUpdateWake((value) => value + 1);
      }
      else void supabaseRpc<void>("end_app_presence", { p_session_id: presenceSessionId.current }, authToken).catch(() => undefined);
      if (wasInBackground && nextState === "active") {
        void (async () => {
          const session = await getPersistedSession().catch(() => null);
          const refreshedToken = session?.access_token || authTokenRef.current;
          if (refreshedToken && refreshedToken !== authTokenRef.current) setAuthToken(refreshedToken);
          await reload(roleRef.current, refreshedToken, { silent: true });
        })();
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
      ...data.categorias.slice(0, 4).map((item) => optimizedImageUrl(item.imagem, { ...imageSize.navigationCard, version: imageRefreshVersion })),
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

  useEffect(() => {
    void (async () => {
      const [savedFavorites, lastVisit, savedNotifications] = await Promise.all([
        AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
        AsyncStorage.getItem(VISIT_STORAGE_KEY),
        AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY)
      ]);
      if (savedFavorites) {
        try { setFavoriteProductIds(JSON.parse(savedFavorites) as string[]); } catch { /* ignora cache inválido */ }
      }
      if (savedNotifications) {
        try { setCatalogNotifications(JSON.parse(savedNotifications) as CatalogNotification[]); } catch { /* ignora cache inválido */ }
      }
      const now = Date.now();
      const previous = lastVisit ? Number(lastVisit) : 0;
      await AsyncStorage.setItem(VISIT_STORAGE_KEY, String(now));
      void trackTelemetry({
        eventType: "session_start",
        screen: "app",
        route,
        userId: currentUser?.id ?? null,
        userRole: role,
        success: true,
        metadata: { returning: previous > 0, daysSinceLastVisit: previous > 0 ? Math.round((now - previous) / 86400000) : null }
      }, authToken);
    })().finally(() => setNotificationsReady(true));

    if (Platform.OS !== "web") {
      void Linking.getInitialURL().then((url) => {
        if (!url) return;
        const match = url.match(/[?&]produto=([^&]+)/);
        if (match?.[1]) setPendingProductReference(decodeURIComponent(match[1]));
      });
    }
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const match = url.match(/[?&]produto=([^&]+)/);
      if (match?.[1]) setPendingProductReference(decodeURIComponent(match[1]));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!data.produtos.length || !pendingProductReference) return;
    const reference = pendingProductReference.toLowerCase();
    const product = data.produtos.find((item) => [item.id, item.slug, item.codigoInterno].some((value) => String(value || "").toLowerCase() === reference));
    if (!product) return;
    setSelectedProduct(product);
    setRoute("detail");
    setPendingProductReference("");
  }, [data.produtos, pendingProductReference]);

  useEffect(() => {
    if (!notificationsReady || !data.produtos.length) return;
    void (async () => {
      const previousRaw = await AsyncStorage.getItem(PRODUCT_SNAPSHOT_STORAGE_KEY);
      const snapshot = Object.fromEntries(data.produtos.map((product) => [product.id, {
        updatedAt: product.updatedAt,
        estoque: product.estoque,
        lancamento: product.lancamento,
        promocao: product.promocao
      }]));
      await AsyncStorage.setItem(PRODUCT_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
      if (!previousRaw) return;
      let previous: Record<string, { updatedAt?: string | null; estoque?: number | null; lancamento?: boolean | null; promocao?: boolean | null }> = {};
      try { previous = JSON.parse(previousRaw); } catch { return; }
      const additions: CatalogNotification[] = [];
      for (const product of data.produtos) {
        const before = previous[product.id];
        if (!before && product.ativo !== false) {
          additions.push({ id: `launch-${product.id}-${product.updatedAt}`, type: "launch", title: "Novo produto no catálogo", message: `${product.codigoInterno || ""} — ${product.nome}`, productId: product.id, createdAt: new Date().toISOString() });
          if (Number(product.estoque || 0) > 0) additions.push({ id: `availability-${product.id}-${product.updatedAt}`, type: "availability", title: "Produto disponível", message: `${product.codigoInterno || ""} — ${product.nome} · Saldo: ${Number(product.estoque || 0)}`, productId: product.id, createdAt: new Date().toISOString() });
        }
        if (before && !before.promocao && product.promocao) {
          additions.push({ id: `promotion-${product.id}-${product.updatedAt}`, type: "promotion", title: "Produto em promoção", message: `${product.codigoInterno || ""} — ${product.nome}`, productId: product.id, createdAt: new Date().toISOString() });
        }
        if (before && before.estoque !== product.estoque) {
          additions.push({ id: `availability-${product.id}-${product.updatedAt}`, type: "availability", title: "Disponibilidade atualizada", message: `${product.codigoInterno || ""} — ${product.nome} · Saldo: ${Number(product.estoque || 0)}`, productId: product.id, createdAt: new Date().toISOString() });
        }
      }
      if (!additions.length) return;
      setCatalogNotifications((current) => {
        const next = Array.from(new Map([...additions, ...current].map((item) => [item.id, item])).values()).slice(0, 50);
        void AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    })();
  }, [data.produtos, notificationsReady]);

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
  const rolePermissions = activeProducts[0]?.permissoesProduto ?? {};
  const rolePermission = (key: string) => rolePermissions[key] === true;
  const catalogPdfRole = catalogPdfRoleFor(role);
  const catalogPdfUrl = catalogPdfSettings[catalogPdfRole]?.url || "";
  const catalogPdfAllowed = Boolean(catalogPdfUrl) && rolePermission("downloadCatalogButton") && rolePermission("catalogPdfDownload");
  const generalWhatsAppAllowed = rolePermission("whatsappButton");
  const categoryById = useMemo(() => new Map(data.categorias.map((item) => [item.id, item])), [data.categorias]);
  const subcategoryById = useMemo(() => new Map(data.subcategorias.map((item) => [item.id, item])), [data.subcategorias]);
  const productGroupById = useMemo(() => new Map(data.gruposProduto.map((item) => [item.id, item])), [data.gruposProduto]);
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
        modeloSlug: modelo?.slug,
        modeloAnoInicial: modelo?.anoInicial,
        modeloAnoFinal: modelo?.anoFinal
      };
      map.set(link.produtoId, [...(map.get(link.produtoId) || []), view]);
    }
    return map;
  }, [data.produtoModelosVeiculo, montadoraById, modeloById]);
  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = activeProducts.filter((item) => {
      const categoria = categoryById.get(item.categoriaId ?? "")?.nome ?? "";
      const subcategoria = subcategoryById.get(item.subcategoriaId ?? "")?.nome ?? "";
      const grupo = productGroupById.get(item.grupoProdutoId ?? "")?.nome ?? "";
      const marca = brandById.get(item.marcaId ?? "")?.nome ?? "";
      const vehicleApplications = vehicleApplicationsByProduct.get(item.id) || item.aplicacoesVeiculo || [];
      const vehicleText = vehicleApplications.map((app) => `${app.montadoraNome || ""} ${app.modeloNome || ""}`).join(" ");
      const text = [item.nome, item.codigoInterno, item.descricaoCurta, item.ean, item.ncm, categoria, subcategoria, grupo, marca, vehicleText].join(" ").toLowerCase();
      const vehicleOk =
        (!montadoraFilter && !modeloFilter && !anoFilter) ||
        vehicleApplications.some((app) =>
          (!montadoraFilter || app.montadoraId === montadoraFilter) &&
          (!modeloFilter || app.modeloId === modeloFilter) &&
          (!anoFilter || (!app.anoInicial && !app.anoFinal) || ((app.anoInicial ?? 1950) <= anoFilter && (app.anoFinal ?? new Date().getFullYear() + 1) >= anoFilter))
        );
      return (!q || text.includes(q)) && (!categoryFilter || item.categoriaId === categoryFilter) && (!subcategoryFilter || item.subcategoriaId === subcategoryFilter) && (!productGroupFilter || item.grupoProdutoId === productGroupFilter) && (!brandFilter || item.marcaId === brandFilter) && vehicleOk;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "name") return a.nome.localeCompare(b.nome);
      if (sortMode === "newest") return String(b.createdAt).localeCompare(String(a.createdAt));
      return (a.ordem ?? 0) - (b.ordem ?? 0);
    });
  }, [activeProducts, query, categoryFilter, subcategoryFilter, productGroupFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter, sortMode, categoryById, subcategoryById, productGroupById, brandById, vehicleApplicationsByProduct]);

  useEffect(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2) return;
    const timer = setTimeout(() => {
      const telemetryKey = `${normalized}:${filteredProducts.length}`;
      if (lastSearchTelemetry.current === telemetryKey) return;
      lastSearchTelemetry.current = telemetryKey;
      void trackTelemetry({
        eventType: filteredProducts.length ? "search_results" : "search_zero_results",
        screen: "products",
        route,
        userId: currentUser?.id ?? null,
        userRole: role,
        success: true,
        metadata: { query: normalized.slice(0, 80), resultCount: filteredProducts.length }
      }, authToken);
    }, 700);
    return () => clearTimeout(timer);
  }, [authToken, currentUser?.id, filteredProducts.length, query, role, route]);

  useEffect(() => {
    if (route === "products" || route === "promotions" || route === "launches") discoveryStartedAt.current = Date.now();
  }, [categoryFilter, brandFilter, montadoraFilter, modeloFilter, anoFilter, query, route]);

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
    setSubcategoryFilter(null);
    setProductGroupFilter(null);
    setBrandFilter(null);
    setMontadoraFilter(null);
    setModeloFilter(null);
    setAnoFilter(null);
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
    void trackTelemetry({
      eventType: "product_view",
      screen: "detail",
      route: "detail",
      userId: currentUser?.id ?? null,
      userRole: role,
      durationMs: Date.now() - discoveryStartedAt.current,
      success: true,
      metadata: {
        productId: product.id,
        code: product.codigoInterno,
        categoryId: product.categoriaId,
        subcategoryId: product.subcategoriaId || null,
        productGroupId: product.grupoProdutoId || null,
        brandId: product.marcaId,
        query: query.trim().slice(0, 80),
        resultCount: filteredProducts.length,
        categoryFilter,
        montadoraFilter,
        modeloFilter,
        anoFilter
      }
    }, authToken);
    go("detail");
  };

  const toggleFavorite = (product: Produto) => {
    const active = !favoriteProductIds.includes(product.id);
    const next = active ? [...favoriteProductIds, product.id] : favoriteProductIds.filter((id) => id !== product.id);
    setFavoriteProductIds(next);
    void AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    void trackTelemetry({ eventType: "favorite_toggle", screen: "detail", route: "detail", userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { productId: product.id, active } }, authToken);
  };

  const selectedVehicleText = [montadoraFilter ? montadoraById.get(montadoraFilter)?.nome : "", modeloFilter ? modeloById.get(modeloFilter)?.nome : "", anoFilter ? String(anoFilter) : ""].filter(Boolean).join(" ");

  const openMissingProductHelp = (searchText: string) => {
    void trackTelemetry({ eventType: "whatsapp_open", screen: "products", route, userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { source: "zero_results", query: searchText.trim().slice(0, 80) } }, authToken);
    void Linking.openURL(whatsappWithText(socialLinks.whatsapp, `Olá! Não encontrei a peça que procuro no catálogo Briland.\n\nBusca realizada: ${searchText.trim() || "não informada"}\nVeículo selecionado: ${selectedVehicleText || "não informado"}`));
  };

  const trackVehicleFilter = (kind: "montadora" | "modelo", id: string | null) => {
    discoveryStartedAt.current = Date.now();
    void trackTelemetry({ eventType: "vehicle_filter", screen: "products", route, userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { kind, id } }, authToken);
  };

  const trackProductEvent = (eventType: string, metadata?: Record<string, unknown>) => {
    void trackTelemetry({ eventType, screen: "detail", route: "detail", userId: currentUser?.id ?? null, userRole: role, success: true, metadata }, authToken);
  };

  const openNewMobileOrder = async () => {
    if (role !== "REPRESENTANTE" || !authToken) return;
    try {
      setLoading(true);
      const draft = await supabaseRpc<SalesOrder>("open_sales_order_draft", {}, authToken);
      setMobileOrder(draft);
      go("newOrder");
    } catch (err) {
      notify("Não foi possível abrir o pedido", err instanceof Error ? err.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
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
      setRoute("products");
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

  const openNotification = (notification: CatalogNotification) => {
    const next = catalogNotifications.map((item) => item.id === notification.id ? { ...item, read: true } : item);
    setCatalogNotifications(next);
    void AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
    const product = data.produtos.find((item) => item.id === notification.productId);
    if (product) openProduct(product);
  };

  const openNotifications = () => {
    const next = catalogNotifications.map((item) => item.read ? item : { ...item, read: true });
    setCatalogNotifications(next);
    void AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next));
    go("notifications");
  };

  const requestRegistration = async (payload: RegistrationRequest) => {
    try {
      await signUpRegistration(payload);
      notify("Cadastro recebido", "Confirme o e-mail enviado para você. Depois da confirmação, seu acesso estará liberado como Não cliente.");
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const normalized = raw.toLowerCase();
      const duplicate = normalized.includes("already") || normalized.includes("já possui") || normalized.includes("database error saving new user");
      notify("Não foi possível cadastrar", duplicate ? "Este e-mail já possui conta ou solicitação em análise." : raw);
      return false;
    }
  };

  const recoverPassword = async (email: string) => {
    await requestPasswordReset(email);
    notify("Confira seu e-mail", "Se o endereço estiver cadastrado, você receberá um link seguro para criar uma nova senha.");
  };

  const resendConfirmation = async (email: string) => {
    await resendSignupConfirmation(email);
    notify("Confirmação enviada", "Se o cadastro ainda estiver aguardando confirmação, um novo e-mail será enviado.");
  };

  const resetPassword = async (password: string) => {
    await updateCurrentPassword(password);
    notify("Senha alterada", "Sua nova senha já está ativa. Entre novamente para continuar.");
    try { await signOutSession(); } catch { /* A senha já foi alterada. */ }
    setAuthToken(undefined);
    setCurrentUser(null);
    setRole("VISITANTE");
    go("login");
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!currentUser?.email) throw new Error("Não foi possível identificar o e-mail desta conta.");
    const session = await signInWithPassword(currentUser.email, currentPassword);
    setAuthToken(session.access_token);
    await updateCurrentPassword(newPassword);
    notify("Senha alterada", "A senha da sua conta foi atualizada com segurança.");
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
  const unreadNotificationCount = catalogNotifications.filter((item) => !item.read).length;

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
            <LoginScreen onLogin={login} onForgot={() => go("forgotPassword")} onSignup={() => go("signup")} onCatalog={() => go("initial")} onPrivacy={() => go("privacy")} onDelete={() => go("accountDeletion")} links={socialLinks} error={loginMessage} />
          ) : route === "admin" ? (
            <AdminScreen role={role} data={data} active={adminTab} setActive={setAdminTab} onBack={() => go("home")} onLogout={logout} reload={() => reload(role, authToken)} authToken={authToken} socialLinks={socialLinks} setSocialLinks={(links) => void saveAdminConfig(links, mediaSettings, aboutSettings)} mediaSettings={mediaSettings} setMediaSettings={(settings) => void saveAdminConfig(socialLinks, settings, aboutSettings)} aboutSettings={aboutSettings} setAboutSettings={(settings) => void saveAdminConfig(socialLinks, mediaSettings, settings)} onAction={(text) => notify("Painel admin", text)} />
          ) : (
            <>
              <Header back={route !== "home"} onBack={goBack} onMenu={() => setMenuOpen(true)} appearance={appearance} notificationCount={unreadNotificationCount} showCreateOrder={role === "REPRESENTANTE"} onCreateOrder={() => void openNewMobileOrder()} onNotifications={openNotifications} />
              {error && <ErrorBanner message={error} onRetry={() => void reload(roleRef.current, authTokenRef.current)} />}
              {route === "home" && <HomeScreen go={openDirectCatalogRoute} products={activeProducts} categories={data.categorias} montadoras={data.montadoras} media={mediaSettings} imageVersion={imageRefreshVersion} />}
              {route === "categories" && <CategoriesScreen categories={data.categorias} products={activeProducts} imageVersion={imageRefreshVersion} onPick={(id) => {
                clearCatalogFilters();
                setCategoryFilter(id);
                void trackTelemetry({ eventType: "category_filter", screen: "categories", route: "products", userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { categoryId: id } }, authToken);
                go(data.subcategorias.some((item) => item.categoriaId === id && item.ativo !== false) ? "subcategories" : "products");
              }} />}
              {route === "subcategories" && categoryFilter && <TaxonomyLevelScreen title={categoryById.get(categoryFilter)?.nome || "Categoria"} breadcrumb="Categorias" items={data.subcategorias.filter((item) => item.categoriaId === categoryFilter && item.ativo !== false)} allProducts={activeProducts} directProducts={activeProducts.filter((item) => item.categoriaId === categoryFilter && !item.subcategoriaId)} imageVersion={imageRefreshVersion} onPick={(id) => { setSubcategoryFilter(id); setProductGroupFilter(null); void trackTelemetry({ eventType: "subcategory_view", screen: "subcategories", route: "subcategories", userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { categoryId: categoryFilter, subcategoryId: id } }, authToken); go(data.gruposProduto.some((item) => item.subcategoriaId === id && item.ativo !== false) ? "productGroups" : "products"); }} onProduct={openProduct} />}
              {route === "productGroups" && subcategoryFilter && <TaxonomyLevelScreen title={subcategoryById.get(subcategoryFilter)?.nome || "Subcategoria"} breadcrumb={`${categoryById.get(categoryFilter || "")?.nome || "Categoria"} › Subcategorias`} items={data.gruposProduto.filter((item) => item.subcategoriaId === subcategoryFilter && item.ativo !== false)} allProducts={activeProducts} directProducts={activeProducts.filter((item) => item.subcategoriaId === subcategoryFilter && !item.grupoProdutoId)} imageVersion={imageRefreshVersion} onPick={(id) => { setProductGroupFilter(id); void trackTelemetry({ eventType: "product_group_view", screen: "productGroups", route: "products", userId: currentUser?.id ?? null, userRole: role, success: true, metadata: { categoryId: categoryFilter, subcategoryId: subcategoryFilter, productGroupId: id } }, authToken); go("products"); }} onProduct={openProduct} />}
              {route === "vehicleBrands" && <VehicleBrandsScreen montadoras={data.montadoras} applications={data.produtoModelosVeiculo} imageVersion={imageRefreshVersion} onPick={(id) => { clearCatalogFilters(); setMontadoraFilter(id); trackVehicleFilter("montadora", id); go("products"); }} />}
              {retainedCatalogRoute && (
                <View style={styles.catalogStage}>
              {retainedCatalogRoute === "products" && (
                <ProductList
                  title="Produtos"
                  subtitle="Encontre o produto ideal para sua necessidade."
                  products={filteredProducts}
                  allCategories={data.categorias}
                  subcategories={data.subcategorias}
                  productGroups={data.gruposProduto}
                  categoryById={categoryById}
                  brandById={brandById}
                  query={query}
                  setQuery={setQuery}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  subcategoryFilter={subcategoryFilter}
                  setSubcategoryFilter={setSubcategoryFilter}
                  productGroupFilter={productGroupFilter}
                  setProductGroupFilter={setProductGroupFilter}
                  brandFilter={brandFilter}
                  setBrandFilter={setBrandFilter}
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  anoFilter={anoFilter}
                  setAnoFilter={setAnoFilter}
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
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                   savedScrollOffset={catalogScrollOffsets.current.products}
                   onScrollOffset={(offset) => { catalogScrollOffsets.current.products = offset; }}
                   allowWhatsApp={generalWhatsAppAllowed}
                   onMissingProduct={openMissingProductHelp}
                   onVehicleFilterUsed={trackVehicleFilter}
                />
              )}
              {retainedCatalogRoute === "promotions" && (
                <ProductList
                  title="Promoções"
                  subtitle="Ofertas selecionadas pela equipe Briland."
                  products={filteredProducts.filter((item) => item.promocao)}
                  allCategories={data.categorias}
                  subcategories={data.subcategorias}
                  productGroups={data.gruposProduto}
                  categoryById={categoryById}
                  brandById={brandById}
                  query={query}
                  setQuery={setQuery}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  subcategoryFilter={subcategoryFilter}
                  setSubcategoryFilter={setSubcategoryFilter}
                  productGroupFilter={productGroupFilter}
                  setProductGroupFilter={setProductGroupFilter}
                  brandFilter={brandFilter}
                  setBrandFilter={setBrandFilter}
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  anoFilter={anoFilter}
                  setAnoFilter={setAnoFilter}
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
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                   savedScrollOffset={catalogScrollOffsets.current.promotions}
                   onScrollOffset={(offset) => { catalogScrollOffsets.current.promotions = offset; }}
                   allowWhatsApp={generalWhatsAppAllowed}
                   onMissingProduct={openMissingProductHelp}
                   onVehicleFilterUsed={trackVehicleFilter}
                  promo
                />
              )}
              {retainedCatalogRoute === "launches" && (
                <ProductList
                  title="Lançamentos"
                  subtitle="Novidades selecionadas pela equipe Briland."
                  products={filteredProducts.filter((item) => item.lancamento).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))}
                  allCategories={data.categorias}
                  subcategories={data.subcategorias}
                  productGroups={data.gruposProduto}
                  categoryById={categoryById}
                  brandById={brandById}
                  query={query}
                  setQuery={setQuery}
                  categoryFilter={categoryFilter}
                  setCategoryFilter={setCategoryFilter}
                  subcategoryFilter={subcategoryFilter}
                  setSubcategoryFilter={setSubcategoryFilter}
                  productGroupFilter={productGroupFilter}
                  setProductGroupFilter={setProductGroupFilter}
                  brandFilter={brandFilter}
                  setBrandFilter={setBrandFilter}
                  montadoraFilter={montadoraFilter}
                  setMontadoraFilter={setMontadoraFilter}
                  modeloFilter={modeloFilter}
                  setModeloFilter={setModeloFilter}
                  anoFilter={anoFilter}
                  setAnoFilter={setAnoFilter}
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
                  imageVersion={imageRefreshVersion}
                  appearance={appearance}
                   savedScrollOffset={catalogScrollOffsets.current.launches}
                   onScrollOffset={(offset) => { catalogScrollOffsets.current.launches = offset; }}
                   allowWhatsApp={generalWhatsAppAllowed}
                   onMissingProduct={openMissingProductHelp}
                   onVehicleFilterUsed={trackVehicleFilter}
                  launch
                />
              )}
              {route === "detail" && selectedProduct && <View style={[styles.detailOverlay, { backgroundColor: appearance.backgroundColor }]}><ProductDetail product={selectedProduct} role={role} category={categoryById.get(selectedProduct.categoriaId ?? "")} brand={brandById.get(selectedProduct.marcaId ?? "")} vehicleApplications={vehicleApplicationsByProduct.get(selectedProduct.id) || selectedProduct.aplicacoesVeiculo || []} whatsappUrl={socialLinks.whatsapp} imageVersion={imageRefreshVersion} selectedVehicle={selectedVehicleText} favorite={favoriteProductIds.includes(selectedProduct.id)} onFavorite={() => toggleFavorite(selectedProduct)} onTrack={trackProductEvent} /></View>}
                </View>
              )}
              {route === "detail" && !retainedCatalogRoute && selectedProduct && <ProductDetail product={selectedProduct} role={role} category={categoryById.get(selectedProduct.categoriaId ?? "")} brand={brandById.get(selectedProduct.marcaId ?? "")} vehicleApplications={vehicleApplicationsByProduct.get(selectedProduct.id) || selectedProduct.aplicacoesVeiculo || []} whatsappUrl={socialLinks.whatsapp} imageVersion={imageRefreshVersion} selectedVehicle={selectedVehicleText} favorite={favoriteProductIds.includes(selectedProduct.id)} onFavorite={() => toggleFavorite(selectedProduct)} onTrack={trackProductEvent} />}
              {route === "contact" && <ContactScreen onSubmit={createLead} />}
              {route === "catalogPdf" && <CatalogPdfScreen url={catalogPdfAllowed ? catalogPdfUrl : ""} />}
              {route === "representativeClients" && role === "REPRESENTANTE" && authToken && currentUser && <RepresentativeClientsScreen token={authToken} representative={currentUser} />}
              {route === "representativeOrders" && role === "REPRESENTANTE" && authToken && <RepresentativeOrdersScreen token={authToken} onNew={() => void openNewMobileOrder()} onOpen={(order) => { setMobileOrder(order); go("newOrder"); }} />}
              {route === "newOrder" && role === "REPRESENTANTE" && authToken && mobileOrder && <MobileOrderScreen order={mobileOrder} token={authToken} representative={currentUser} products={activeProducts} onSaved={(saved) => { setMobileOrder(saved); if (saved.status === "SUBMITTED") go("representativeOrders"); }} />}
              {route === "notifications" && <NotificationsScreen notifications={catalogNotifications} products={data.produtos} onOpen={openNotification} />}
              {route === "about" && <AboutScreen settings={aboutSettings} />}
              {route === "privacy" && <PrivacyScreen />}
              {route === "forgotPassword" && <ForgotPasswordScreen onRequest={recoverPassword} onResend={resendConfirmation} />}
              {route === "resetPassword" && <ResetPasswordScreen onSubmit={resetPassword} />}
              {route === "account" && currentUser && <AccountScreen user={currentUser} onChangePassword={changePassword} />}
              {route === "accountDeletion" && <AccountDeletionScreen initialEmail={currentUser?.email || ""} onSubmit={requestAccountDeletion} />}
              {route === "signup" && <SignupScreen onSubmit={requestRegistration} onLogin={() => go("login")} onPrivacy={() => go("privacy")} onDelete={() => go("accountDeletion")} />}
            </>
          )}
        </SafeAreaView>
        )}
      </PageTransition>
      <SideMenu visible={menuOpen} role={role} user={currentUser} links={socialLinks} allowWhatsApp={generalWhatsAppAllowed} showCatalogPdf={catalogPdfAllowed} onClose={() => setMenuOpen(false)} go={openDirectCatalogRoute} onLogout={() => void logout()} />
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
  return <MotionPage>{children}</MotionPage>;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText} numberOfLines={2}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.errorButton}><Text style={styles.errorButtonText}>Tentar novamente</Text></Pressable>
    </View>
  );
}

function Header({ back, onBack, onMenu, appearance, notificationCount, showCreateOrder, onCreateOrder, onNotifications }: { back?: boolean; onBack: () => void; onMenu: () => void; appearance: CatalogAppearance; notificationCount: number; showCreateOrder: boolean; onCreateOrder: () => void; onNotifications: () => void }) {
  return (
    <View style={styles.header}>
      <MotionPressable style={styles.iconButton} onPress={back ? onBack : onMenu}>
        <Ionicons name={back ? "chevron-back" : "menu"} size={28} color={colors.navy} />
      </MotionPressable>
      <LogoPlate compact logoUrl={appearance.logoUrl} />
      <View style={styles.headerActions}>
        <MotionPressable accessibilityRole="button" accessibilityLabel="Abrir notificações" style={styles.headerSmallButton} onPress={onNotifications}><Ionicons name="notifications-outline" size={23} color={colors.navy} />{notificationCount > 0 && <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{notificationCount > 9 ? "9+" : notificationCount}</Text></View>}</MotionPressable>
        {showCreateOrder && <MotionPressable accessibilityRole="button" accessibilityLabel="Criar novo pedido" style={styles.headerSmallButton} onPress={onCreateOrder}><Ionicons name="add-circle-outline" size={25} color={colors.navy} /></MotionPressable>}
      </View>
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
function HomeScreen({ go, products, categories, montadoras, media, imageVersion }: { go: (route: Route) => void; products: Produto[]; categories: Categoria[]; montadoras: Montadora[]; media: MediaSettings; imageVersion: number }) {
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

function ProgressiveNavigationCard({ title, description, count, image, imageVersion, icon, onPress }: { title: string; description?: string | null; count: number; image?: string | null; imageVersion: number; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.progressiveCard, pressed && styles.progressiveCardPressed]} onPress={onPress}>
      {image ? <Image source={{ uri: liveImageUrl(image, imageSize.navigationCard, imageVersion) }} style={styles.progressiveCardImage} resizeMode="cover" /> : <LinearGradient colors={[colors.navy, "#0A3262"]} style={styles.progressiveCardImageFallback}><Ionicons name={icon} size={54} color={colors.yellow} /></LinearGradient>}
      <LinearGradient colors={["transparent", "rgba(2,17,38,.08)", "rgba(2,17,38,.58)", "rgba(2,17,38,.98)"]} locations={[0, .34, .68, 1]} style={styles.progressiveCardGradient} />
      <View style={styles.progressiveCardContent}><Text style={styles.progressiveCardTitle} numberOfLines={2}>{title}</Text>{description ? <Text style={styles.progressiveCardDescription} numberOfLines={2}>{description}</Text> : null}<Text style={styles.progressiveCardCount}>{count} {count === 1 ? "produto" : "produtos"}</Text></View>
      <View style={styles.progressiveCardArrow}><Ionicons name="arrow-forward" size={18} color={colors.navy} /></View>
    </Pressable>
  );
}

function CategoriesScreen({ categories, products, imageVersion, onPick }: { categories: Categoria[]; products: Produto[]; imageVersion: number; onPick: (id: string) => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Categorias" subtitle="Explore todas as nossas linhas de produtos." />
      {categories.length === 0 ? <EmptyState text="Nenhuma categoria disponível." /> : (
        <View style={styles.grid}>
          {categories.map((item) => (
            <ProgressiveNavigationCard key={item.id} title={item.nome} description={item.descricao} count={products.filter((product) => product.categoriaId === item.id).length} image={item.imagem} imageVersion={imageVersion} icon="grid-outline" onPress={() => onPick(item.id)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function TaxonomyLevelScreen({ title, breadcrumb, items, allProducts, directProducts, imageVersion, onPick, onProduct }: { title: string; breadcrumb: string; items: Array<Subcategoria | GrupoProduto>; allProducts: Produto[]; directProducts: Produto[]; imageVersion: number; onPick: (id: string) => void; onProduct: (product: Produto) => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <Text style={styles.mutedSmall}>{breadcrumb}</Text>
      <PageTitle title={title} subtitle="Escolha uma opção ou consulte os produtos disponíveis neste nível." />
      {items.length > 0 && <View style={styles.grid}>{items.map((item) => (
        <ProgressiveNavigationCard key={item.id} title={item.nome} description={item.descricao} count={allProducts.filter((product) => "categoriaId" in item ? product.subcategoriaId === item.id : product.grupoProdutoId === item.id).length} image={item.imagem} imageVersion={imageVersion} icon="albums-outline" onPress={() => onPick(item.id)} />
      ))}</View>}
      {directProducts.length > 0 && <><Text style={styles.sectionTitle}>Produtos desta seleção</Text><View style={styles.grid}>{directProducts.map((product) => (
        <Pressable style={styles.categoryCard} key={product.id} onPress={() => onProduct(product)}>
          <View style={[styles.categoryIcon, { width: "100%", height: 92 }]}>{product.imagemCard || product.imagemPrincipal ? <Image source={{ uri: productImageUrl(product, "card", imageVersion) }} style={{ width: "100%", height: 86 }} resizeMode="contain" /> : <Ionicons name="cube-outline" size={34} color={colors.navy} />}</View>
          <Text style={styles.productCode}>{product.codigoInterno || "Produto"}</Text>
          <Text style={styles.categoryName} numberOfLines={3}>{product.nome}</Text>
        </Pressable>
      ))}</View></>}
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
              <ProgressiveNavigationCard key={item.id} title={item.nome} count={count} image={item.imagem} imageVersion={imageVersion} icon="car-sport-outline" onPress={() => onPick(item.id)} />
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
  subcategories,
  productGroups,
  categoryById,
  brandById,
  query,
  setQuery,
  categoryFilter,
  setCategoryFilter,
  subcategoryFilter,
  setSubcategoryFilter,
  productGroupFilter,
  setProductGroupFilter,
  brandFilter,
  setBrandFilter,
  montadoraFilter,
  setMontadoraFilter,
  modeloFilter,
  setModeloFilter,
  anoFilter,
  setAnoFilter,
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
  imageVersion,
  appearance,
  savedScrollOffset,
  onScrollOffset,
  allowWhatsApp,
  onMissingProduct,
  onVehicleFilterUsed,
  promo,
  launch
}: {
  title: string;
  subtitle: string;
  products: Produto[];
  allCategories: Categoria[];
  subcategories: Subcategoria[];
  productGroups: GrupoProduto[];
  categoryById: Map<string, Categoria>;
  brandById: Map<string, Marca>;
  query: string;
  setQuery: (q: string) => void;
  categoryFilter: string | null;
  setCategoryFilter: (id: string | null) => void;
  subcategoryFilter: string | null;
  setSubcategoryFilter: (id: string | null) => void;
  productGroupFilter: string | null;
  setProductGroupFilter: (id: string | null) => void;
  brandFilter: string | null;
  setBrandFilter: (id: string | null) => void;
  montadoraFilter: string | null;
  setMontadoraFilter: (id: string | null) => void;
  modeloFilter: string | null;
  setModeloFilter: (id: string | null) => void;
  anoFilter: number | null;
  setAnoFilter: (year: number | null) => void;
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
  imageVersion: number;
  appearance: CatalogAppearance;
  savedScrollOffset: number;
  onScrollOffset: (offset: number) => void;
  allowWhatsApp: boolean;
  onMissingProduct: (query: string) => void;
  onVehicleFilterUsed: (kind: "montadora" | "modelo", id: string | null) => void;
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
  const activeSubcategory = subcategoryFilter ? subcategories.find((item) => item.id === subcategoryFilter)?.nome : null;
  const activeProductGroup = productGroupFilter ? productGroups.find((item) => item.id === productGroupFilter)?.nome : null;
  const activeBrand = brandFilter ? brands.find((item) => item.id === brandFilter)?.nome : "Todas marcas";
  const activeMontadora = montadoraFilter ? montadoras.find((item) => item.id === montadoraFilter)?.nome : "Todas montadoras";
  const activeModelo = modeloFilter ? modelosVeiculo.find((item) => item.id === modeloFilter)?.nome : "Todos modelos";
  const availableModels = montadoraFilter ? modelosVeiculo.filter((item) => item.montadoraId === montadoraFilter) : [];
  const selectedModel = modeloFilter ? modelosVeiculo.find((item) => item.id === modeloFilter) : undefined;
  const availableYears = vehicleYears().filter((year) => (!selectedModel?.anoInicial || year >= selectedModel.anoInicial) && (!selectedModel?.anoFinal || year <= selectedModel.anoFinal));
  const listHeader = (
    <>
      <PageTitle title={title} subtitle={subtitle} badge={launch ? "NOVO" : undefined} />
      <View style={styles.searchRow}>
        <View style={styles.searchBox}><Ionicons name="search" size={22} color={colors.navy} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar código, EAN, NCM ou descricao..." placeholderTextColor="#9BA0AA" style={styles.searchInput} /></View>
        <Pressable style={styles.filterButton} onPress={() => setFilterOpen(true)}><Ionicons name="filter" size={22} color={colors.navy} /><Text style={styles.filterText}>Filtros</Text></Pressable>
      </View>
      {query.trim().length >= 2 && products.length > 0 && (
        <View style={styles.searchSuggestions}>
          <Text style={styles.suggestionLabel}>Sugestões</Text>
          {products.slice(0, 4).map((product) => (
            <Pressable key={product.id} style={styles.suggestionItem} onPress={() => onOpen(product)}>
              <Ionicons name="search-outline" size={17} color={colors.navy} />
              <View style={styles.flex}><Text style={styles.suggestionCode}>{product.codigoInterno}</Text><Text style={styles.suggestionName} numberOfLines={1}>{product.nome}</Text></View>
              <Ionicons name="arrow-forward" size={17} color={colors.yellow} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.chips}>
        <Chip text={activeCategory ?? "Categorias"} onPress={() => setFilterOpen(true)} />
        {subcategoryFilter && <Chip text={activeSubcategory ?? "Subcategoria"} onPress={() => setFilterOpen(true)} />}
        {productGroupFilter && <Chip text={activeProductGroup ?? "Grupo"} onPress={() => setFilterOpen(true)} />}
        <Chip text={activeBrand ?? "Marcas"} onPress={() => setFilterOpen(true)} />
        <Chip text={activeMontadora ?? "Montadoras"} onPress={() => setFilterOpen(true)} />
        {montadoraFilter && <Chip text={activeModelo ?? "Modelos"} onPress={() => setFilterOpen(true)} />}
        {modeloFilter && <Chip text={anoFilter ? `Ano ${anoFilter}` : "Todos os anos"} onPress={() => setFilterOpen(true)} />}
        <Chip text="Limpar" onPress={() => { setQuery(""); setCategoryFilter(null); setSubcategoryFilter(null); setProductGroupFilter(null); setBrandFilter(null); setMontadoraFilter(null); setModeloFilter(null); setAnoFilter(null); setSortMode("order"); }} />
      </View>
      {montadoraFilter && availableModels.length > 0 && (
        <View style={styles.modelFilterPanel}>
          <Text style={styles.sheetLabel}>Modelo do veículo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
            <OptionPill label="Todos" selected={!modeloFilter} onPress={() => { setModeloFilter(null); onVehicleFilterUsed("modelo", null); }} />
            {availableModels.map((item) => <OptionPill key={item.id} label={item.nome} selected={modeloFilter === item.id} onPress={() => { setModeloFilter(item.id); setAnoFilter(null); onVehicleFilterUsed("modelo", item.id); }} />)}
          </ScrollView>
          {modeloFilter && <><Text style={styles.sheetLabel}>Ano do veículo</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}><OptionPill label="Todos" selected={!anoFilter} onPress={() => setAnoFilter(null)} />{availableYears.map((year) => <OptionPill key={year} label={String(year)} selected={anoFilter === year} onPress={() => setAnoFilter(year)} />)}</ScrollView></>}
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
        ListEmptyComponent={<View style={styles.emptySearchCard}><Ionicons name="search-outline" size={38} color={colors.yellow} /><Text style={styles.emptySearchTitle}>Não encontramos essa peça</Text><Text style={styles.muted}>Revise o código ou fale com nossa equipe. Nós ajudamos a localizar a aplicação correta.</Text>{allowWhatsApp && <Pressable style={styles.emptySearchButton} onPress={() => onMissingProduct(query)}><Ionicons name="logo-whatsapp" size={20} color={colors.white} /><Text style={styles.emptySearchButtonText}>Pedir ajuda pelo WhatsApp</Text></Pressable>}</View>}
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
          <MotionPressable pressedScale={0.985} style={[listMode === "grid" ? styles.productCard : styles.productListCard, { backgroundColor: appearance.surfaceColor, borderRadius: appearance.cardRadius }, promo && styles.promoCard, launch && styles.launchCard]} onPressIn={() => { const detailUrl = productImageUrl(product, "detail", imageVersion); if (detailUrl) void ExpoImage.prefetch(detailUrl); }} onPress={() => { onScrollOffset(latestScrollOffset.current); onOpen(product); }}>
            <View style={listMode === "grid" ? undefined : styles.listImageWrap}>
              {productPermission(product, "imagemPrincipal", false) && product.imagemPrincipal ? <Image recyclingKey={product.id} source={{ uri: productImageUrl(product, "card", imageVersion) }} style={listMode === "grid" ? styles.productImage : styles.productListImage} resizeMode="contain" /> : listMode === "grid" ? <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Imagem não disponível para este acesso" card /> : <View style={styles.productListPlaceholder}><Ionicons name="image-outline" size={28} color={colors.yellow} /></View>}
              {promo && <Ribbon text="PROMOÇÃO" color={colors.red} />}
              {launch && <Ribbon text="NOVO" color={colors.yellow} />}
            </View>
            <View style={styles.productBody}>
              {productPermission(product, "codigoInterno", false) && <Text style={[styles.productCode, { color: appearance.primaryColor }]}>{product.codigoInterno || "Sem código"}</Text>}
              {productPermission(product, "nome", false) && <Text style={styles.productName} numberOfLines={3}>{product.nome}</Text>}
              {appearance.showProductCategory && productPermission(product, "categoria", false) && <Text style={styles.mutedSmall}>{categoryById.get(product.categoriaId ?? "")?.nome || "Sem categoria"}{appearance.showProductBrand && productPermission(product, "marca", false) ? ` • ${brandById.get(product.marcaId ?? "")?.nome || "Sem marca"}` : ""}</Text>}
              <View style={styles.cardLine} />
              {productPermission(product, "caixaMaster", false) && <Meta icon="cube-outline" label="Caixa master" value={product.caixaMaster || "A cadastrar"} />}
              {productPermission(product, "ncm", false) && <Meta icon="document-text-outline" label="NCM" value={product.ncm || "A cadastrar"} />}
              {productPermission(product, "preco", false) && <Text style={styles.price}>{money(product.preco)}</Text>}
            </View>
          </MotionPressable>
        )}
      />
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        categories={allCategories}
        subcategories={subcategories}
        productGroups={productGroups}
        brands={brands}
        montadoras={montadoras}
        modelosVeiculo={modelosVeiculo}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        subcategoryFilter={subcategoryFilter}
        setSubcategoryFilter={setSubcategoryFilter}
        productGroupFilter={productGroupFilter}
        setProductGroupFilter={setProductGroupFilter}
        brandFilter={brandFilter}
        setBrandFilter={setBrandFilter}
        montadoraFilter={montadoraFilter}
        setMontadoraFilter={(id) => { setMontadoraFilter(id); setModeloFilter(null); onVehicleFilterUsed("montadora", id); }}
        modeloFilter={modeloFilter}
        setModeloFilter={(id) => { setModeloFilter(id); setAnoFilter(null); onVehicleFilterUsed("modelo", id); }}
        anoFilter={anoFilter}
        setAnoFilter={setAnoFilter}
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

function ProductDetail({ product, role, category, subcategory, productGroup, brand, vehicleApplications, whatsappUrl, imageVersion, selectedVehicle, favorite, onFavorite, onTrack }: { product: Produto; role: Role; category?: Categoria; subcategory?: Subcategoria; productGroup?: GrupoProduto; brand?: Marca; vehicleApplications: ProdutoModeloVeiculoView[]; whatsappUrl: string; imageVersion: number; selectedVehicle: string; favorite: boolean; onFavorite: () => void; onTrack: (eventType: string, metadata?: Record<string, unknown>) => void }) {
  const { width: windowWidth } = useWindowDimensions();
  const [activeImage, setActiveImage] = useState(0);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const galleryRef = useRef<FlatList<string>>(null);
  const detailImage = productImageUrl(product, "detail", imageVersion);
  const gallery = useMemo(() => Array.from(new Set([
    detailImage,
    ...(product.imagensExtras ?? []).map((url) => liveImageUrl(url, imageSize.productDetail, imageVersion))
  ].filter(Boolean) as string[])), [detailImage, product.imagensExtras, imageVersion]);
  const galleryWidth = Math.max(280, windowWidth - 40);
  useEffect(() => {
    setActiveImage(0);
    galleryRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [product.id]);
  const selectImage = (index: number) => {
    setActiveImage(index);
    galleryRef.current?.scrollToOffset({ offset: index * galleryWidth, animated: true });
    onTrack("gallery_interaction", { productId: product.id, action: "thumbnail", imageIndex: index });
  };
  const openWhatsApp = () => {
    onTrack("whatsapp_open", { productId: product.id, source: "product_detail", selectedVehicle: selectedVehicle || null });
    void Linking.openURL(whatsappWithText(whatsappUrl, `Olá! Tenho interesse neste produto Briland:\n\n${product.codigoInterno || "Sem código"} — ${product.nome}\nVeículo selecionado: ${selectedVehicle || "não informado"}\n${productPublicUrl(product)}`));
  };
  const shareProduct = async () => {
    const url = productPublicUrl(product);
    const image = product.imagemPrincipal ? `\nFoto: ${product.imagemPrincipal}` : "";
    await Share.share({ title: `${product.codigoInterno || ""} — ${product.nome}`, message: `${product.codigoInterno || ""} — ${product.nome}\n${url}${image}`, url });
    onTrack("product_share", { productId: product.id, code: product.codigoInterno });
  };
  const showImage = productPermission(product, "imagemPrincipal", false);
  const showCode = productPermission(product, "codigoInterno", false);
  const showName = productPermission(product, "nome", false);
  const showShortDescription = productPermission(product, "descricaoCurta", false);
  const showCategory = productPermission(product, "categoria", false);
  const showBrand = productPermission(product, "marca", false);
  const showNcm = productPermission(product, "ncm", false);
  const showEan = productPermission(product, "ean", false);
  const showMasterBox = productPermission(product, "caixaMaster", false);
  const showCa = productPermission(product, "ca", false);
  const showPrice = productPermission(product, "preco", false);
  const showStock = productPermission(product, "estoque", false);
  const showCompleteDescription = productPermission(product, "descricaoCompleta", false);
  const showTechnicalSheet = productPermission(product, "fichaTecnica", false);
  const showCommercialNote = productPermission(product, "observacaoComercial", false);
  const showManual = Boolean(product.manualPdf) && productPermission(product, "manualPdf", false);
  const showVehicleApplications = vehicleApplications.length > 0 && productPermission(product, "aplicacoesVeiculo", false);
  const showWhatsApp = productPermission(product, "whatsappButton", false) && productPermission(product, "botaoWhatsApp", false);
  return (<>
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <View style={styles.detailMedia}>
        {showImage && gallery[0] ? <>
          <FlatList
            ref={galleryRef}
            data={gallery}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, index) => `${index}-${item}`}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / galleryWidth);
              setActiveImage(index);
              onTrack("gallery_interaction", { productId: product.id, action: "swipe", imageIndex: index });
            }}
            renderItem={({ item, index }) => (
              <View style={[styles.detailGalleryPage, { width: galleryWidth }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Ampliar imagem ${index + 1} de ${gallery.length}`} style={styles.detailImagePressable} onPress={() => { setFullscreenImage(item); onTrack("gallery_interaction", { productId: product.id, action: "fullscreen", imageIndex: index }); }}>
                  <Image recyclingKey={`${product.id}-detail-${index}`} source={{ uri: item }} transition={140} style={styles.detailImage} resizeMode="contain" />
                  <View style={styles.zoomHint}><Ionicons name="expand-outline" size={18} color={colors.navy} /><Text style={styles.zoomHintText}>Ampliar</Text></View>
                </Pressable>
              </View>
            )}
          />
          {gallery.length > 1 && <View style={styles.detailThumbnailBar}>
            {gallery.slice(0, 6).map((item, index) => (
              <MotionPressable key={`${index}-${item}`} style={[styles.detailThumbnailButton, activeImage === index && styles.detailThumbnailButtonActive]} onPress={() => selectImage(index)}>
                <Image source={{ uri: liveImageUrl(index === 0 ? product.imagemPrincipal : product.imagensExtras?.[index - 1], imageSize.thumb, imageVersion) }} style={styles.detailThumbnail} resizeMode="contain" />
              </MotionPressable>
            ))}
          </View>}
          {gallery.length > 1 && <View style={styles.dotsOverlay}>{gallery.map((item, index) => <View key={`${index}-${item}`} style={activeImage === index ? styles.dotActive : styles.dotGalleryInactive} />)}</View>}
        </> : <BrandedMedia title={product.codigoInterno || "Produto"} subtitle="Cadastre a imagem principal no painel admin" tall />}
      </View>
      {showCode && <Text style={styles.smallYellow}>{product.codigoInterno || "Sem código"}</Text>}
      <View style={styles.detailTitleRow}>{showName && <Text style={[styles.detailTitle, styles.flex]}>{product.nome}</Text>}<MotionPressable accessibilityRole="button" accessibilityLabel={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} style={styles.shareButton} onPress={onFavorite}><Ionicons name={favorite ? "heart" : "heart-outline"} size={22} color={favorite ? colors.red : colors.navy} /></MotionPressable><MotionPressable accessibilityRole="button" accessibilityLabel="Compartilhar produto" style={styles.shareButton} onPress={() => void shareProduct()}><Ionicons name="share-social-outline" size={22} color={colors.navy} /></MotionPressable></View>
      {showShortDescription && <Text style={styles.muted}>{product.descricaoCurta || "Produto cadastrado no catálogo Briland."}</Text>}
      {(showPrice || showStock) && <View style={styles.statRow}>
        {showPrice && <InfoCard icon="document-text-outline" label="Preço" value={money(product.preco)} />}
        {showStock && <InfoCard icon="cube-outline" label="Estoque" value={typeof product.estoque === "number" ? `${product.estoque}` : "Sob consulta"} green={Boolean(product.estoque && product.estoque > 0)} small="unidades" />}
      </View>}
      {(showCategory || showBrand || showNcm || showEan || showMasterBox || showCa) && <Accordion title="Informações principais" open>
        <View style={styles.detailGrid}>
          {showCategory && <DetailItem label="Classificação" value={[category?.nome, subcategory?.nome, productGroup?.nome].filter(Boolean).join(" › ") || "A cadastrar"} />}
          {showBrand && <DetailItem label="Marca" value={brand?.nome || "A cadastrar"} />}
          {showNcm && <DetailItem label="NCM" value={product.ncm || "A cadastrar"} />}
          {showEan && <DetailItem label="EAN" value={product.ean || "A cadastrar"} />}
          {showMasterBox && <DetailItem label="Caixa Master" value={product.caixaMaster || "A cadastrar"} />}
          {showCa && <DetailItem label="CA" value={product.ca || "A cadastrar"} />}
        </View>
      </Accordion>}
      {showCompleteDescription && <Accordion title="Descrição completa" open={Boolean(product.descricaoCompleta)}>
        <Text style={styles.detailText}>{product.descricaoCompleta}</Text>
      </Accordion>}
      {(showTechnicalSheet || showVehicleApplications) && <Accordion title="Ficha técnica" open={Boolean(product.fichaTecnica) || showVehicleApplications}>
        {showTechnicalSheet && product.fichaTecnica ? <Text style={styles.detailText}>{product.fichaTecnica}</Text> : null}
        {showVehicleApplications && <View style={styles.vehicleApplicationBox}>
          <Text style={styles.sheetLabel}>Montadora / Modelo</Text>
          {vehicleApplications.map((app) => (
            <View key={app.id} style={styles.vehicleApplicationItem}>
              <DetailItem label="Montadora" value={app.montadoraNome || "A cadastrar"} />
              <DetailItem label="Modelo" value={app.modeloNome || "A cadastrar"} />
              <DetailItem label="Compatibilidade" value={vehicleApplicationLabel(app)} />
              {app.observacaoComercial ? <Text style={styles.detailText}>{app.observacaoComercial}</Text> : null}
            </View>
          ))}
        </View>}
      </Accordion>}
      {showManual && <Accordion title="Manual do produto" open>
        <Text style={styles.detailText}>Consulte as instruções de instalação, utilização e segurança deste produto.</Text>
        <Pressable accessibilityRole="link" accessibilityLabel="Baixar ou abrir o manual do produto" style={styles.downloadButton} onPress={() => void trackedDownload(product.manualPdf || "", { fileType: "product_manual", productId: product.id, productCode: product.codigoInterno, fileName: `${product.codigoInterno || product.id}-manual.pdf`, fallbackToOriginalUrl: true })}><Ionicons name="download-outline" size={18} color={colors.navy} /><Text style={styles.downloadText}>Baixar ou abrir manual</Text></Pressable>
      </Accordion>}
      {showCommercialNote && <Accordion title="Observação comercial" open={Boolean(product.observacaoComercial)}>
        <Text style={styles.detailText}>{product.observacaoComercial}</Text>
      </Accordion>}
      <View style={styles.actionRow}>
        {showWhatsApp && <Pressable style={styles.whatsButton} onPress={openWhatsApp}><Ionicons name="logo-whatsapp" size={24} color={colors.green} /></Pressable>}
      </View>
    </ScrollView>
    <Modal visible={Boolean(fullscreenImage)} animationType="fade" transparent={false} onRequestClose={() => setFullscreenImage(null)}>
      <View style={styles.fullscreenGallery}>
        <StatusBar style="light" />
        <Pressable style={styles.fullscreenClose} onPress={() => setFullscreenImage(null)}><Ionicons name="close" size={28} color={colors.white} /></Pressable>
        {fullscreenImage && <TransientZoomImage uri={fullscreenImage} width={windowWidth} />}
        <Text style={styles.fullscreenHint}>Use dois dedos para ampliar</Text>
      </View>
    </Modal>
  </>);
}

function TransientZoomImage({ uri, width }: { uri: string; width: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const initialDistance = useRef(0);
  const initialFocal = useRef({ x: 0, y: 0 });
  const layoutSize = useRef({ width, height: 1 });
  type ZoomTouch = { pageX: number; pageY: number; locationX?: number; locationY?: number };
  const touchDistance = (touches: readonly ZoomTouch[]) => {
    if (touches.length < 2) return 0;
    return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  };
  const touchFocal = (touches: readonly ZoomTouch[]) => {
    if (touches.length < 2) return { x: 0, y: 0 };
    return {
      x: ((touches[0].locationX ?? touches[0].pageX) + (touches[1].locationX ?? touches[1].pageX)) / 2,
      y: ((touches[0].locationY ?? touches[0].pageY) + (touches[1].locationY ?? touches[1].pageY)) / 2
    };
  };
  const resetZoom = () => {
    initialDistance.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 75, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, friction: 7, tension: 75, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 7, tension: 75, useNativeDriver: true })
    ]).start();
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (event) => {
      initialDistance.current = touchDistance(event.nativeEvent.touches);
      initialFocal.current = touchFocal(event.nativeEvent.touches);
    },
    onPanResponderMove: (event) => {
      const distance = touchDistance(event.nativeEvent.touches);
      if (!distance || !initialDistance.current) return;
      const nextScale = Math.max(1, Math.min(4, distance / initialDistance.current));
      const focal = touchFocal(event.nativeEvent.touches);
      const centerX = layoutSize.current.width / 2;
      const centerY = layoutSize.current.height / 2;
      scale.setValue(nextScale);
      translateX.setValue((focal.x - centerX) - nextScale * (initialFocal.current.x - centerX));
      translateY.setValue((focal.y - centerY) - nextScale * (initialFocal.current.y - centerY));
    },
    onPanResponderRelease: resetZoom,
    onPanResponderTerminate: resetZoom,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true
  }), [scale, translateX, translateY]);

  useEffect(() => {
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
  }, [scale, translateX, translateY, uri]);

  return (
    <View
      style={styles.fullscreenZoom}
      onLayout={(event) => { layoutSize.current = event.nativeEvent.layout; }}
      {...panResponder.panHandlers}
    >
      <Animated.View style={[styles.fullscreenZoomContent, { transform: [{ translateX }, { translateY }, { scale }] }]}>
        <Image source={{ uri }} style={{ width, height: "100%" }} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

function FilterSheet({
  visible,
  onClose,
  categories,
  subcategories,
  productGroups,
  brands,
  montadoras,
  modelosVeiculo,
  categoryFilter,
  setCategoryFilter,
  subcategoryFilter,
  setSubcategoryFilter,
  productGroupFilter,
  setProductGroupFilter,
  brandFilter,
  setBrandFilter,
  montadoraFilter,
  setMontadoraFilter,
  modeloFilter,
  setModeloFilter,
  anoFilter,
  setAnoFilter,
  sortMode,
  setSortMode
}: {
  visible: boolean;
  onClose: () => void;
  categories: Categoria[];
  subcategories: Subcategoria[];
  productGroups: GrupoProduto[];
  brands: Marca[];
  montadoras: Montadora[];
  modelosVeiculo: ModeloVeiculo[];
  categoryFilter: string | null;
  setCategoryFilter: (id: string | null) => void;
  subcategoryFilter: string | null;
  setSubcategoryFilter: (id: string | null) => void;
  productGroupFilter: string | null;
  setProductGroupFilter: (id: string | null) => void;
  brandFilter: string | null;
  setBrandFilter: (id: string | null) => void;
  montadoraFilter: string | null;
  setMontadoraFilter: (id: string | null) => void;
  modeloFilter: string | null;
  setModeloFilter: (id: string | null) => void;
  anoFilter: number | null;
  setAnoFilter: (year: number | null) => void;
  sortMode: "order" | "name" | "newest";
  setSortMode: (mode: "order" | "name" | "newest") => void;
}) {
  const sorts: Array<["order" | "name" | "newest", string]> = [["order", "Ordem"], ["name", "Nome"], ["newest", "Mais novos"]];
  const filteredModels = montadoraFilter ? modelosVeiculo.filter((item) => item.montadoraId === montadoraFilter) : modelosVeiculo;
  const selectedModel = modeloFilter ? modelosVeiculo.find((item) => item.id === modeloFilter) : undefined;
  const filteredYears = vehicleYears().filter((year) => (!selectedModel?.anoInicial || year >= selectedModel.anoInicial) && (!selectedModel?.anoFinal || year <= selectedModel.anoFinal));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Filtros de produtos</Text><Pressable onPress={onClose}><Ionicons name="close" size={26} color={colors.navy} /></Pressable></View>
        <Text style={styles.sheetLabel}>Categorias</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!categoryFilter} onPress={() => { setCategoryFilter(null); setSubcategoryFilter(null); setProductGroupFilter(null); }} />
          {categories.map((item) => <OptionPill key={item.id} label={item.nome} selected={categoryFilter === item.id} onPress={() => { setCategoryFilter(item.id); setSubcategoryFilter(null); setProductGroupFilter(null); }} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Subcategorias</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!subcategoryFilter} onPress={() => { setSubcategoryFilter(null); setProductGroupFilter(null); }} />
          {subcategories.filter((item) => !categoryFilter || item.categoriaId === categoryFilter).map((item) => <OptionPill key={item.id} label={item.nome} selected={subcategoryFilter === item.id} onPress={() => { setSubcategoryFilter(item.id); setProductGroupFilter(null); }} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Grupos de produtos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todos" selected={!productGroupFilter} onPress={() => setProductGroupFilter(null)} />
          {productGroups.filter((item) => !subcategoryFilter || item.subcategoriaId === subcategoryFilter).map((item) => <OptionPill key={item.id} label={item.nome} selected={productGroupFilter === item.id} onPress={() => setProductGroupFilter(item.id)} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Marcas</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!brandFilter} onPress={() => setBrandFilter(null)} />
          {brands.map((item) => <OptionPill key={item.id} label={item.nome} selected={brandFilter === item.id} onPress={() => setBrandFilter(item.id)} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Filtrar por Montadora</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todas" selected={!montadoraFilter} onPress={() => { setMontadoraFilter(null); setModeloFilter(null); setAnoFilter(null); }} />
          {montadoras.map((item) => <OptionPill key={item.id} label={item.nome} selected={montadoraFilter === item.id} onPress={() => { setMontadoraFilter(item.id); setModeloFilter(null); setAnoFilter(null); }} />)}
        </ScrollView>
        <Text style={styles.sheetLabel}>Modelo</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}>
          <OptionPill label="Todos" selected={!modeloFilter} onPress={() => { setModeloFilter(null); setAnoFilter(null); }} />
          {filteredModels.map((item) => <OptionPill key={item.id} label={item.nome} selected={modeloFilter === item.id} onPress={() => { setModeloFilter(item.id); setAnoFilter(null); }} />)}
        </ScrollView>
        {modeloFilter && <><Text style={styles.sheetLabel}>Ano</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetOptions}><OptionPill label="Todos" selected={!anoFilter} onPress={() => setAnoFilter(null)} />{filteredYears.map((year) => <OptionPill key={year} label={String(year)} selected={anoFilter === year} onPress={() => setAnoFilter(year)} />)}</ScrollView></>}
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
          <Choice title="Comercial" subtitle="Dúvidas, pedidos e parcerias" selected={department === "Comercial"} icon="briefcase-outline" onPress={() => setDepartment("Comercial")} />
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
function LoginScreen({ onLogin, onForgot, onSignup, onCatalog, onPrivacy, onDelete, links, error }: { onLogin: (email: string, password: string) => void | Promise<void>; onForgot: () => void; onSignup: () => void; onCatalog: () => void; onPrivacy: () => void; onDelete: () => void; links: SocialLinks; error?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const supportUrl = links.whatsapp + (links.whatsapp.includes("?") ? "&" : "?") + "text=Preciso%20recuperar%20meu%20acesso%20Briland";
  return (
    <SafeAreaView style={styles.loginScreen}>
      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onCatalog} style={styles.loginLogoButton}>
          <Image source={logo} style={styles.loginLogo} resizeMode="contain" />
        </Pressable>
        <Text style={styles.loginLabel}>Insira seu e-mail</Text>
        <DarkInput icon="mail-outline" value={email} onChangeText={setEmail} placeholder="seu@email.com" autoComplete="off" />
        <Text style={styles.loginLabel}>Insira sua senha</Text>
        <DarkInput icon="lock-closed-outline" value={password} onChangeText={setPassword} placeholder="Digite sua senha" secure />
        {error ? <View style={styles.loginErrorBox}><Ionicons name="alert-circle-outline" size={19} color={colors.red} /><Text style={styles.loginErrorText}>{error}</Text></View> : null}
        <Pressable style={styles.loginButton} onPress={() => onLogin(email, password)}><Text style={styles.loginButtonText}>Entrar</Text></Pressable>
        <Pressable onPress={onForgot}><Text style={styles.forgotText}>Esqueci a senha  ›</Text></Pressable>
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
function ForgotPasswordScreen({ onRequest, onResend }: { onRequest: (email: string) => Promise<void>; onResend: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (action: "reset" | "confirm") => {
    if (!email.includes("@") || busy) return;
    setBusy(true);
    try {
      if (action === "reset") await onRequest(email);
      else await onResend(email);
    } catch {
      notify("Não foi possível enviar", "Aguarde alguns minutos e tente novamente.");
    } finally { setBusy(false); }
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock} keyboardShouldPersistTaps="handled">
    <PageTitle title="Recuperar acesso" subtitle="Enviaremos um link seguro para o e-mail cadastrado." />
    <View style={styles.formCard}>
      <Input label="E-mail da conta" value={email} onChangeText={setEmail} />
      <Text style={styles.muted}>Por segurança, a resposta será a mesma mesmo que o endereço não esteja cadastrado.</Text>
      <Pressable disabled={busy || !email.includes("@")} style={[styles.yellowButton, (busy || !email.includes("@")) && styles.disabledButton]} onPress={() => void run("reset")}>
        {busy ? <ActivityIndicator color={colors.navy} /> : <><Ionicons name="mail-outline" size={21} color={colors.navy} /><Text style={styles.yellowButtonText}>Enviar link para redefinir senha</Text></>}
      </Pressable>
      <Pressable disabled={busy || !email.includes("@")} style={styles.outlineButton} onPress={() => void run("confirm")}><Text style={styles.outlineButtonText}>Reenviar confirmação de cadastro</Text></Pressable>
    </View>
  </ScrollView>;
}

function ResetPasswordScreen({ onSubmit }: { onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = password.length >= 8 && password === confirmation;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try { await onSubmit(password); }
    catch { notify("Link inválido ou expirado", "Solicite um novo e-mail de recuperação e tente novamente."); }
    finally { setBusy(false); }
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock} keyboardShouldPersistTaps="handled">
    <PageTitle title="Criar nova senha" subtitle="Escolha uma senha com pelo menos 8 caracteres." />
    <View style={styles.formCard}>
      <Input label="Nova senha" secure value={password} onChangeText={setPassword} />
      <Input label="Confirmar nova senha" secure value={confirmation} onChangeText={setConfirmation} />
      {confirmation.length > 0 && password !== confirmation && <Text style={styles.dangerText}>As senhas não coincidem.</Text>}
      <Pressable disabled={!valid || busy} style={[styles.yellowButton, (!valid || busy) && styles.disabledButton]} onPress={() => void submit()}>{busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.yellowButtonText}>Salvar nova senha</Text>}</Pressable>
    </View>
  </ScrollView>;
}

function AccountScreen({ user, onChangePassword }: { user: Usuario; onChangePassword: (currentPassword: string, newPassword: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmation;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
    } catch { notify("Não foi possível alterar", "Confira sua senha atual e tente novamente."); }
    finally { setBusy(false); }
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock} keyboardShouldPersistTaps="handled">
    <PageTitle title="Minha conta" subtitle="Consulte seus dados de acesso e mantenha sua senha protegida." />
    <View style={styles.formCard}>
      <Meta icon="person-outline" label="Nome" value={user.name} />
      <Meta icon="business-outline" label="Empresa" value={user.company || "Não informado"} />
      <Meta icon="mail-outline" label="E-mail" value={user.email} />
      <Meta icon="call-outline" label="Telefone" value={user.phone || "Não informado"} />
      <Meta icon="shield-checkmark-outline" label="Perfil" value={user.role.replaceAll("_", " ")} />
    </View>
    <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>Alterar senha</Text>
      <Input label="Senha atual" secure value={currentPassword} onChangeText={setCurrentPassword} />
      <Input label="Nova senha" secure value={newPassword} onChangeText={setNewPassword} />
      <Input label="Confirmar nova senha" secure value={confirmation} onChangeText={setConfirmation} />
      {confirmation.length > 0 && newPassword !== confirmation && <Text style={styles.dangerText}>As senhas não coincidem.</Text>}
      <Pressable disabled={!valid || busy} style={[styles.yellowButton, (!valid || busy) && styles.disabledButton]} onPress={() => void submit()}>{busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.yellowButtonText}>Alterar senha</Text>}</Pressable>
    </View>
  </ScrollView>;
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
      <PageTitle title="Cadastrar empresa" subtitle="Preencha os dados abaixo para criar seu acesso empresarial." />
      {submitted ? <View style={styles.deletionSuccess}><Ionicons name="checkmark-circle" size={58} color={colors.green} /><Text style={styles.legalHeading}>Cadastro recebido</Text><Text style={styles.legalParagraph}>Enviamos uma confirmação para o seu e-mail. Confirme o endereço e depois entre usando este e-mail e a senha que acabou de criar. Seu primeiro acesso será liberado como Não cliente.</Text></View> : <>
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
        <Text style={styles.legalParagraph}>Podemos tratar dados de cadastro empresarial, como nome, empresa, e-mail, telefone, CNPJ e endereço; dados enviados em contatos e pedidos; e dados técnicos mínimos de uso e diagnóstico.</Text>
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

const mobileOrderStatus:Record<string,string>={DRAFT:"Rascunho",SUBMITTED:"Enviado",RETURNED:"Devolvido",APPROVED:"Aprovado",PARTIALLY_INVOICED:"Faturado parcial",INVOICED:"Faturado",REJECTED:"Rejeitado",CANCELLED:"Cancelado"};
const mobileOrderStatusTone: Record<string, { backgroundColor: string; color: string }> = {
  DRAFT: { backgroundColor: "#F2F4F7", color: "#475467" },
  SUBMITTED: { backgroundColor: "#DBEAFE", color: "#174EA6" },
  RETURNED: { backgroundColor: "#FEF3C7", color: "#8A5C00" },
  APPROVED: { backgroundColor: "#D1FAE5", color: "#08633C" },
  PARTIALLY_INVOICED: { backgroundColor: "#E0F2FE", color: "#075985" },
  INVOICED: { backgroundColor: "#FFF0BD", color: "#795700" },
  REJECTED: { backgroundColor: "#FEE2E2", color: "#A11B16" },
  CANCELLED: { backgroundColor: "#FEE2E2", color: "#A11B16" },
};
const mobileOrderNumber=(value:number)=>String(value).padStart(6,"0");

type RepresentativeClientDraft = {
  name: string;
  company: string;
  cnpj: string;
  stateRegistration: string;
  email: string;
  phone: string;
  address: string;
  zipCode: string;
  neighborhood: string;
  city: string;
  state: string;
};
const emptyRepresentativeClient: RepresentativeClientDraft = { name:"",company:"",cnpj:"",stateRegistration:"",email:"",phone:"",address:"",zipCode:"",neighborhood:"",city:"",state:"" };

function RepresentativeClientsScreen({ token, representative }: { token: string; representative: Usuario }) {
  const [clients, setClients] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RepresentativeClientDraft>(emptyRepresentativeClient);
  const load = async () => {
    setLoading(true);
    try {
      setClients(await supabaseGet<Usuario>("User", `select=*&role=eq.CLIENTE&representanteId=eq.${representative.id}&order=company.asc`, token));
    } catch (error) {
      Alert.alert("Clientes", error instanceof Error ? error.message : "Não foi possível carregar seus clientes.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [token, representative.id]);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = clients.filter((client) => !normalizedQuery || `${client.company || ""} ${client.name || ""} ${client.cnpj || ""} ${client.city || ""} ${client.email || ""}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
  const change = (key: keyof RepresentativeClientDraft, value: string) => setForm((current) => ({
    ...current,
    [key]: key === "cnpj" ? maskCnpj(value) : key === "zipCode" ? maskCep(value) : key === "phone" ? maskPhone(value) : key === "state" ? value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) : key === "stateRegistration" ? value.toUpperCase().slice(0, 30) : value,
  }));
  const openCreate = () => {
    setEditing(null);
    setForm(emptyRepresentativeClient);
    setCreating(true);
  };
  const openEdit = (client: Usuario) => {
    setCreating(false);
    setEditing(client);
    setForm({
      name: client.name || "",
      company: client.company || "",
      cnpj: maskCnpj(client.cnpj || ""),
      stateRegistration: client.stateRegistration || "",
      email: client.email || "",
      phone: maskPhone(client.phone || ""),
      address: client.address || "",
      zipCode: maskCep(client.zipCode || ""),
      neighborhood: client.neighborhood || "",
      city: client.city || "",
      state: client.state || "",
    });
  };
  const closeEditor = () => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
    setForm(emptyRepresentativeClient);
  };
  const save = async () => {
    if (Object.values(form).some((value) => !value.trim())) {
      Alert.alert("Dados incompletos", "Preencha todos os campos obrigatórios do cliente.");
      return;
    }
    if (onlyDigits(form.cnpj).length !== 14) { Alert.alert("CNPJ inválido", "Informe os 14 números do CNPJ."); return; }
    if (onlyDigits(form.zipCode).length !== 8) { Alert.alert("CEP inválido", "Informe os 8 números do CEP."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { Alert.alert("E-mail inválido", "Informe um e-mail válido para o primeiro acesso do cliente."); return; }
    setSaving(true);
    try {
      const payload = { ...form, email: form.email.trim().toLowerCase() };
      if (editing) await supabaseRpc<Usuario>("update_representative_client", { p_client_id: editing.id, p_payload: payload }, token);
      else await supabaseRpc<Usuario>("create_representative_client", { p_payload: payload }, token);
      await load();
      setCreating(false);
      setEditing(null);
      setForm(emptyRepresentativeClient);
      Alert.alert(editing ? "Cliente atualizado" : "Cliente cadastrado", editing ? "As informações do cliente foram atualizadas." : "O cliente foi vinculado ao seu acesso e já pode ser usado em novos pedidos.");
    } catch (error) {
      Alert.alert(editing ? "Não foi possível atualizar" : "Não foi possível cadastrar", error instanceof Error ? error.message : "Revise os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  };
  const fields: Array<[keyof RepresentativeClientDraft, string, "default" | "numeric" | "email-address" | "phone-pad"]> = [
    ["company","Razão social","default"],["cnpj","CNPJ","numeric"],["stateRegistration","Inscrição estadual","default"],["name","Responsável","default"],["email","E-mail","email-address"],["phone","Telefone","phone-pad"],["address","Endereço completo","default"],["zipCode","CEP","numeric"],["neighborhood","Bairro","default"],["city","Cidade","default"],["state","Estado (UF)","default"],
  ];
  return <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock} keyboardShouldPersistTaps="handled">
      <PageTitle title="Clientes" subtitle="Consulte seus clientes e faça novos cadastros diretamente pelo celular." />
      <Pressable style={styles.yellowButton} onPress={openCreate}><Ionicons name="person-add-outline" size={21} color={colors.navy}/><Text style={styles.yellowButtonText}>Cadastrar novo cliente</Text></Pressable>
      <View style={styles.representativeClientSearch}><Ionicons name="search-outline" size={21} color={colors.navy}/><TextInput value={query} onChangeText={setQuery} placeholder="Buscar por empresa, CNPJ, cidade ou e-mail" placeholderTextColor="#8C94A0" style={styles.searchInput} autoCapitalize="none" returnKeyType="search"/></View>
      {loading ? <ActivityIndicator style={{marginTop:30}} color={colors.navy}/> : filtered.map((client) => <Pressable key={client.id} style={styles.representativeClientCard} onPress={() => openEdit(client)} accessibilityRole="button" accessibilityLabel={`Editar cliente ${client.company || client.name}`}>
        <View style={styles.representativeClientIcon}><Ionicons name="business-outline" size={24} color={colors.navy}/></View>
        <View style={styles.flex}><Text style={styles.representativeClientCompany}>{client.company || client.name}</Text><Text style={styles.representativeClientDocument}>{maskCnpj(client.cnpj || "")}{client.stateRegistration ? `  •  IE ${client.stateRegistration}` : ""}</Text><Text style={styles.mutedSmall}>{client.name}  •  {client.city}/{client.state}</Text><Text style={styles.representativeClientContact}>{maskPhone(client.phone || "")}  •  {client.email}</Text></View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted}/>
      </Pressable>)}
      {!loading && !filtered.length && <View style={styles.emptySearchCard}><Ionicons name="people-outline" size={42} color={colors.yellow}/><Text style={styles.emptySearchTitle}>{query ? "Nenhum cliente encontrado" : "Nenhum cliente vinculado"}</Text><Text style={styles.muted}>{query ? "Tente outro nome, CNPJ, cidade ou e-mail." : "Cadastre seu primeiro cliente pelo botão acima."}</Text></View>}
    </ScrollView>
    <Modal visible={creating || Boolean(editing)} transparent animationType="slide" onRequestClose={closeEditor}>
      <Pressable style={styles.sheetOverlay} onPress={closeEditor} />
      <ScrollView style={styles.editorSheet} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
        <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>{editing ? "Editar cliente" : "Cadastrar cliente"}</Text><Text style={styles.mutedSmall}>Todos os campos são obrigatórios.</Text></View><Pressable style={styles.sideClose} disabled={saving} onPress={closeEditor}><Ionicons name="close" size={24} color={colors.navy}/></Pressable></View>
        {fields.map(([key,label,keyboard]) => <View key={key} style={styles.inputGroup}><Text style={styles.label}>{label} <Text style={styles.required}>*</Text></Text><View style={[styles.input, editing && key === "email" && styles.disabledInput]}><TextInput editable={!(editing && key === "email")} value={form[key]} onChangeText={(value) => change(key,value)} keyboardType={keyboard} autoCapitalize={key === "email" ? "none" : key === "state" || key === "stateRegistration" ? "characters" : "sentences"} autoCorrect={false} maxLength={key === "cnpj" ? 18 : key === "phone" ? 15 : key === "zipCode" ? 9 : key === "state" ? 2 : undefined} placeholder={label} placeholderTextColor="#9BA0AA" style={styles.inputText}/></View>{editing && key === "email" && <Text style={styles.fieldHint}>O e-mail de acesso não pode ser alterado.</Text>}</View>)}
        <View style={styles.securityBox}><Ionicons name="shield-checkmark-outline" size={25} color={colors.navy}/><Text style={[styles.mutedSmall,styles.flex]}>O cadastro será vinculado automaticamente a {representative.name}. O cliente usará o e-mail informado para criar a primeira senha.</Text></View>
        <Pressable disabled={saving} style={[styles.yellowButton,saving && styles.disabledButton]} onPress={() => void save()}>{saving ? <ActivityIndicator color={colors.navy}/> : <><Ionicons name="save-outline" size={21} color={colors.navy}/><Text style={styles.yellowButtonText}>{editing ? "Salvar alterações" : "Salvar cliente"}</Text></>}</Pressable>
      </ScrollView>
    </Modal>
  </>;
}

function RepresentativeOrdersScreen({token,onNew,onOpen}:{token:string;onNew:()=>void;onOpen:(order:SalesOrder)=>void}){
  const[orders,setOrders]=useState<SalesOrder[]>([]);const[loading,setLoading]=useState(true);const load=async()=>{setLoading(true);try{setOrders(await supabaseGet<SalesOrder>("SalesOrder","select=*,items:SalesOrderItem(*)&order=createdAt.desc",token));}catch(err){Alert.alert("Pedidos",err instanceof Error?err.message:"Não foi possível carregar.");}finally{setLoading(false);}};useEffect(()=>{void load();},[]);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}><PageTitle title="Meus pedidos" subtitle="Consulte rapidamente rascunhos e pedidos já enviados."/><Pressable style={styles.yellowButton} onPress={onNew}><Ionicons name="add-circle-outline" size={21} color={colors.navy}/><Text style={styles.yellowButtonText}>Criar novo pedido</Text></Pressable>{loading?<ActivityIndicator style={{marginTop:30}} color={colors.navy}/>:orders.map(order=>{const tone=mobileOrderStatusTone[order.status]||mobileOrderStatusTone.DRAFT;return <Pressable key={order.id} style={styles.mobileOrderCard} onPress={()=>onOpen(order)}><View style={styles.mobileOrderInfo}><Text style={styles.productCode}>PEDIDO {mobileOrderNumber(order.orderNumber)}</Text><Text style={styles.mobileOrderClient} numberOfLines={2} ellipsizeMode="tail">{String(order.clientSnapshot?.company||"Cliente ainda não selecionado")}</Text><Text style={styles.mutedSmall} numberOfLines={1}>{new Date(order.updatedAt).toLocaleString("pt-BR")}</Text></View><View style={styles.mobileOrderRight}><Text style={[styles.mobileOrderStatus,tone]} numberOfLines={1}>{mobileOrderStatus[order.status]}</Text><Text style={styles.mobileOrderTotal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{money(order.total)}</Text></View></Pressable>})}{!loading&&!orders.length&&<View style={styles.emptySearchCard}><Ionicons name="receipt-outline" size={42} color={colors.yellow}/><Text style={styles.emptySearchTitle}>Nenhum pedido</Text><Text style={styles.muted}>Crie o primeiro pedido pelo botão acima.</Text></View>}</ScrollView>;
}

function MobileOrderScreen({
  order,
  token,
  representative,
  products,
  onSaved,
}: {
  order: SalesOrder;
  token: string;
  representative: Usuario | null;
  products: Produto[];
  onSaved: (order: SalesOrder) => void;
}) {
  const [clients, setClients] = useState<Usuario[]>([]);
  const [stock, setStock] = useState<SalesStock[]>([]);
  const [clientId, setClientId] = useState(order.clientId || "");
  const [freight, setFreight] = useState<"CIF" | "FOB">(
    order.freightType || "CIF",
  );
  const [payment, setPayment] = useState<"UPFRONT" | "INSTALLMENTS">(
    order.paymentType || "INSTALLMENTS",
  );
  const [terms, setTerms] = useState(order.paymentTerms || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [items, setItems] = useState<SalesOrderItem[]>(order.items || []);
  const [clientQuery, setClientQuery] = useState("");
  const [clientSuggestionsVisible, setClientSuggestionsVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = ["DRAFT", "RETURNED"].includes(order.status);
  const limit = representative?.orderDiscountLimit ?? 15;
  useEffect(() => {
    void Promise.all([
      supabaseGet<Usuario>(
        "User",
        `select=*&role=eq.CLIENTE&representanteId=eq.${representative?.id || ""}&order=company.asc`,
        token,
      ),
      supabaseRpc<SalesStock[]>("get_sales_stock", {}, token),
    ])
      .then(([c, s]) => {
        setClients(c);
        setStock(s);
        const selected = c.find((client) => client.id === (order.clientId || clientId));
        if (selected) setClientQuery(selected.company || selected.name);
      })
      .catch((err) =>
        Alert.alert(
          "Pedido",
          err instanceof Error
            ? err.message
            : "Não foi possível carregar os dados.",
        ),
      );
  }, [token, representative?.id]);
  const available = new Map(
    stock.map((row) => [row.productId, row.availableBalance]),
  );
  const calculated = items.map((item) => {
    const extra = payment === "UPFRONT" ? 5 : 0;
    const manual = Number(item.manualDiscountPercent || 0);
    const effective = Math.round((100 - (1 - manual / 100) * (1 - extra / 100) * 100) * 100) / 100;
    const unit = Math.round(Number(item.listPrice) * (1 - manual / 100) * (1 - extra / 100) * 100) / 100;
    return {
      ...item,
      paymentDiscountPercent: extra,
      effectiveDiscountPercent: effective,
      unitPrice: unit,
      lineTotal: unit * Number(item.quantity),
    };
  });
  const total = calculated.reduce((sum, item) => sum + item.lineTotal, 0);
  const selectedClient = clients.find((client) => client.id === clientId);
  const clientSuggestions =
    clientSuggestionsVisible && clientQuery.trim()
      ? clients
          .filter((client) => matchesAllSearchTerms(
            clientQuery,
            client.company,
            client.name,
            client.cnpj,
            client.city,
            client.state,
            client.email,
          ))
          .slice(0, 8)
      : [];
  const suggestions =
    query.trim().length > 1
      ? products
          .filter(
            (product) =>
              product.preco != null &&
              !items.some((item) => item.productId === product.id) &&
              matchesAllSearchTerms(
                query,
                product.codigoInterno,
                product.nome,
                product.descricaoCurta,
                product.descricaoCompleta,
                product.ean,
                product.ncm,
                product.observacaoComercial,
                ...(product.aplicacoesVeiculo || []).flatMap((application) => [application.montadoraNome, application.modeloNome]),
              ),
          )
          .slice(0, 6)
      : [];
  const add = (product: Produto) => {
    setItems([
      ...items,
      {
        productId: product.id,
        productCode: product.codigoInterno || product.id,
        productName: product.nome,
        quantity: 1,
        listPrice: Number(product.preco),
        manualDiscountPercent: 0,
        paymentDiscountPercent: 0,
        effectiveDiscountPercent: 0,
        unitPrice: Number(product.preco),
        lineTotal: Number(product.preco),
        sortOrder: items.length,
      },
    ]);
    setQuery("");
  };
  const save = async (submit: boolean) => {
    if (!clientId) {
      Alert.alert("Cliente obrigatório", "Selecione o cliente do pedido.");
      return;
    }
    if (!calculated.length) {
      Alert.alert("Pedido vazio", "Adicione pelo menos um produto.");
      return;
    }
    if (payment === "INSTALLMENTS" && !terms.trim()) {
      Alert.alert(
        "Prazo obrigatório",
        "Informe o prazo do pagamento parcelado.",
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await supabaseRpc<SalesOrder>(
        "save_sales_order",
        {
          p_order_id: order.id,
          p_client_id: clientId,
          p_freight_type: freight,
          p_redispatch_name: null,
          p_redispatch_phone: null,
          p_payment_type: payment,
          p_payment_terms: terms,
          p_notes: notes.trim() || null,
          p_items: calculated.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            manualDiscountPercent: item.manualDiscountPercent,
          })),
          p_submit: submit,
        },
        token,
      );
      Alert.alert(
        submit ? "Pedido enviado" : "Rascunho salvo",
        submit
          ? "O estoque foi reservado e o pedido seguiu para análise."
          : "Você pode continuar este pedido depois.",
      );
      onSaved({ ...saved, items: calculated });
    } catch (err) {
      Alert.alert(
        "Não foi possível salvar",
        err instanceof Error ? err.message : "Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.contentWithDock}
    >
      <PageTitle
        title={`Pedido ${mobileOrderNumber(order.orderNumber)}`}
        subtitle={
          editable
            ? "Preencha e envie sem sair do catálogo."
            : `Status: ${mobileOrderStatus[order.status]}`
        }
      />
      <Text style={styles.sheetLabel}>Cliente</Text>
      <View style={styles.mobileClientSearchBox}>
        <Ionicons name="search-outline" size={21} color={colors.navy} />
        <TextInput
          editable={editable}
          style={styles.mobileClientSearchInput}
          placeholder="Digite nome, CNPJ, cidade ou e-mail"
          placeholderTextColor={colors.muted}
          value={clientQuery}
          onFocus={() => setClientSuggestionsVisible(true)}
          onChangeText={(value) => {
            setClientQuery(value);
            setClientSuggestionsVisible(true);
            if (selectedClient && normalizeSearchText(value) !== normalizeSearchText(selectedClient.company || selectedClient.name)) setClientId("");
          }}
          autoCorrect={false}
        />
        {clientQuery.length > 0 && editable && (
          <Pressable
            accessibilityLabel="Limpar busca de cliente"
            onPress={() => { setClientQuery(""); setClientId(""); setClientSuggestionsVisible(true); }}
          >
            <Ionicons name="close-circle" size={21} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {clientSuggestions.map((client) => (
        <Pressable
          key={client.id}
          style={styles.mobileClientSuggestion}
          onPress={() => {
            setClientId(client.id);
            setClientQuery(client.company || client.name);
            setClientSuggestionsVisible(false);
          }}
        >
          <View style={styles.mobileClientSuggestionIcon}><Ionicons name="business-outline" size={19} color={colors.navy} /></View>
          <View style={styles.flex}>
            <Text style={styles.mobileClientSuggestionName}>{client.company || client.name}</Text>
            <Text style={styles.mutedSmall}>{maskCnpj(client.cnpj || "")} • {client.city || "Cidade não informada"}/{client.state || "--"}</Text>
          </View>
          <Ionicons name="checkmark-circle-outline" size={22} color={colors.navy} />
        </Pressable>
      ))}
      {clientSuggestionsVisible && clientQuery.trim() && clientSuggestions.length === 0 && (
        <View style={styles.mobileClientNoResult}><Text style={styles.mutedSmall}>Nenhum cliente encontrado com esses termos.</Text></View>
      )}
      {selectedClient && !clientSuggestionsVisible && (
        <View style={styles.mobileSelectedClient}>
          <Ionicons name="checkmark-circle" size={22} color="#16845B" />
          <View style={styles.flex}><Text style={styles.mobileClientSuggestionName}>{selectedClient.company || selectedClient.name}</Text><Text style={styles.mutedSmall}>{maskCnpj(selectedClient.cnpj || "")}</Text></View>
        </View>
      )}
      <View style={styles.mobileOrderOptions}>
        <Pressable
          style={[
            styles.mobileChoice,
            freight === "CIF" && styles.mobileChoiceActive,
          ]}
          onPress={() => editable && setFreight("CIF")}
        >
          <Text
            style={[
              styles.mobileChoiceText,
              freight === "CIF" && styles.mobileChoiceTextActive,
            ]}
          >
            Frete CIF
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.mobileChoice,
            freight === "FOB" && styles.mobileChoiceActive,
          ]}
          onPress={() => editable && setFreight("FOB")}
        >
          <Text
            style={[
              styles.mobileChoiceText,
              freight === "FOB" && styles.mobileChoiceTextActive,
            ]}
          >
            Frete FOB
          </Text>
        </Pressable>
      </View>
      <Text style={styles.sheetLabel}>Pagamento</Text>
      <View style={styles.mobileOrderOptions}>
        <Pressable
          style={[
            styles.mobileChoice,
            payment === "INSTALLMENTS" && styles.mobileChoiceActive,
          ]}
          onPress={() => editable && setPayment("INSTALLMENTS")}
        >
          <Text
            style={[
              styles.mobileChoiceText,
              payment === "INSTALLMENTS" && styles.mobileChoiceTextActive,
            ]}
          >
            Parcelado
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.mobileChoice,
            payment === "UPFRONT" && styles.mobileChoiceActive,
          ]}
          onPress={() => editable && setPayment("UPFRONT")}
        >
          <Text
            style={[
              styles.mobileChoiceText,
              payment === "UPFRONT" && styles.mobileChoiceTextActive,
            ]}
          >
            À vista +5%
          </Text>
        </Pressable>
      </View>
      {payment === "INSTALLMENTS" && (
        <TextInput
          editable={editable}
          style={styles.mobileOrderInput}
          placeholder="Prazo: ex. 30/45/60"
          value={terms}
          onChangeText={setTerms}
        />
      )}{" "}
      {editable && (
        <>
          <Text style={styles.sheetLabel}>Adicionar produtos</Text>
          <TextInput
            style={styles.mobileOrderInput}
            placeholder="Buscar por palavras, código ou aplicação"
            value={query}
            onChangeText={setQuery}
          />
          {suggestions.map((product) => (
            <Pressable
              key={product.id}
              style={styles.mobileProductSuggestion}
              onPress={() => add(product)}
            >
              <Text style={styles.productCode}>{product.codigoInterno}</Text>
              <Text style={styles.flex}>{product.nome}</Text>
              <Ionicons name="add-circle" size={24} color={colors.navy} />
            </Pressable>
          ))}
        </>
      )}
      {calculated.map((item, index) => (
        <View key={item.productId} style={styles.mobileOrderItem}>
          <View style={styles.flex}>
            <Text style={styles.productCode}>{item.productCode}</Text>
            <Text style={styles.mobileOrderItemName}>{item.productName}</Text>
            <Text style={styles.mutedSmall}>
              Disponível: {available.get(item.productId) ?? 0} •{" "}
              {money(item.unitPrice)}
            </Text>
          </View>
          <View style={styles.mobileOrderControls}>
            <View style={styles.mobileOrderField}>
              <Text style={styles.mobileOrderFieldLabel}>Quantidade</Text>
              <TextInput
                accessibilityLabel="Quantidade do produto"
                editable={editable}
                keyboardType="number-pad"
                style={styles.mobileNumberInput}
                value={String(item.quantity)}
                onChangeText={(value) =>
                  setItems(
                    items.map((row, i) =>
                      i === index
                        ? { ...row, quantity: Math.max(1, Number(value) || 1) }
                        : row,
                    ),
                  )
                }
              />
            </View>
            <View style={styles.mobileOrderField}>
              <Text style={styles.mobileOrderFieldLabel}>Desconto (%)</Text>
              <TextInput
                accessibilityLabel="Percentual de desconto do produto"
                editable={editable}
                keyboardType="decimal-pad"
                style={styles.mobileNumberInput}
                value={String(item.manualDiscountPercent)}
                onChangeText={(value) =>
                  setItems(
                    items.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            manualDiscountPercent: Math.min(
                              limit,
                              Math.max(0, Number(value.replace(",", ".")) || 0),
                            ),
                          }
                        : row,
                    ),
                  )
                }
              />
              <Text style={styles.mobileOrderFieldHint}>Máx. {limit}%</Text>
            </View>
            {editable && (
              <Pressable
                onPress={() => setItems(items.filter((_, i) => i !== index))}
              >
                <Ionicons name="trash-outline" size={21} color={colors.red} />
              </Pressable>
            )}
          </View>
        </View>
      ))}
      <Text style={styles.sheetLabel}>Observações do pedido</Text>
      <TextInput
        editable={editable}
        style={styles.mobileOrderInput}
        placeholder="Informe detalhes importantes para este pedido"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />
      <View style={styles.mobileOrderSummary}>
        <Text>Total do pedido</Text>
        <Text style={styles.mobileOrderGrandTotal}>{money(total)}</Text>
      </View>
      {editable && (
        <View style={styles.mobileOrderActions}>
          <Pressable
            disabled={busy}
            style={styles.mobileDraftButton}
            onPress={() => void save(false)}
          >
            <Text style={styles.mobileDraftButtonText}>Salvar</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            style={styles.yellowButton}
            onPress={() => void save(true)}
          >
            <Ionicons name="send-outline" size={20} color={colors.navy} />
            <Text style={styles.yellowButtonText}>Salvar e enviar</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function NotificationsScreen({ notifications, products, onOpen }: { notifications: CatalogNotification[]; products: Produto[]; onOpen: (notification: CatalogNotification) => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Novidades para você" subtitle="Novos produtos, promoções e atualizações de disponibilidade." />
      {notifications.length === 0 ? <View style={styles.emptySearchCard}><Ionicons name="notifications-outline" size={40} color={colors.yellow} /><Text style={styles.emptySearchTitle}>Tudo em dia</Text><Text style={styles.muted}>As próximas novidades do catálogo aparecerão aqui.</Text></View> : notifications.map((notification) => {
        const product = products.find((item) => item.id === notification.productId);
        return <Pressable key={notification.id} style={[styles.notificationItem, !notification.read && styles.notificationUnread]} onPress={() => onOpen(notification)}>
          <View style={styles.notificationIcon}><Ionicons name={notification.type === "promotion" ? "pricetag-outline" : notification.type === "availability" ? "cube-outline" : "sparkles-outline"} size={22} color={colors.navy} /></View>
          <View style={styles.flex}><Text style={styles.notificationTitle}>{notification.title}</Text><Text style={styles.muted}>{notification.message}</Text>{product && <Text style={styles.notificationLink}>Ver produto</Text>}</View>
          {!notification.read && <View style={styles.notificationDot} />}
        </Pressable>;
      })}
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
    manualPdf: draft.manualPdf?.trim() || null,
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
        stateRegistration: draft.stateRegistration || null,
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
      <Text style={styles.adminTitle}>Leads e contatos comerciais</Text>
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

function SideMenu({ visible, onClose, go, onLogout, role, user, links, allowWhatsApp, showCatalogPdf }: { visible: boolean; onClose: () => void; go: (route: Route) => void; onLogout: () => void; role: Role; user: Usuario | null; links: SocialLinks; allowWhatsApp: boolean; showCatalogPdf: boolean }) {
  const sections: { title: string; items: [Route, string, IconName][] }[] = [
    { title: "Catálogo", items: [["home", "Início", "home-outline"], ["categories", "Categorias", "grid-outline"], ["vehicleBrands", "Montadoras", "car-sport-outline"], ["products", "Produtos", "cube-outline"], ["launches", "Lançamentos", "star-outline"], ["promotions", "Promoções", "pricetag-outline"]] },
    { title: "Atendimento", items: [["contact", "Contatos", "headset-outline"]] },
    { title: "Briland", items: [["about", "Sobre a Briland", "information-circle-outline"]] },
    { title: "Privacidade e conta", items: [...(role === "VISITANTE" ? [] : [["account", "Minha conta", "person-circle-outline"] as [Route, string, IconName]]), ["privacy", "Política de Privacidade", "shield-checkmark-outline"], ["accountDeletion", "Excluir cadastro", "trash-outline"]] }
  ];
  const accountAction = () => {
    if (role === "VISITANTE") go("login");
    else onLogout();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}><BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /></Pressable>
      <MotionDrawer><View style={styles.sideMenu}>
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
                return <MotionPressable key={label} style={styles.sideItem} onPress={() => go(target)}><Ionicons name={icon} size={23} color={danger ? colors.red : colors.navy} /><Text style={[styles.sideLabel, danger && styles.sideLabelDanger]}>{label}</Text><Ionicons name="chevron-forward" size={20} color={danger ? colors.red : colors.navy} /></MotionPressable>;
              })}
            </View>
          ))}
          {showCatalogPdf && <View style={styles.sideSection}><Text style={styles.sideSectionTitle}>Downloads</Text><MotionPressable style={styles.sideItem} onPress={() => go("catalogPdf")}><Ionicons name="document-text-outline" size={23} color={colors.navy} /><Text style={styles.sideLabel}>Catálogo em PDF</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></MotionPressable></View>}
          {isAdminRole(role) && <View style={styles.sideSection}><Text style={styles.sideSectionTitle}>Gestão</Text><Pressable style={styles.sideItem} onPress={() => go("admin")}><Ionicons name="speedometer-outline" size={23} color={colors.navy} /><Text style={styles.sideLabel}>Painel admin</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></Pressable></View>}
          {role === "REPRESENTANTE" && <View style={styles.sideSection}><Text style={styles.sideSectionTitle}>Comercial</Text><Pressable style={styles.sideItem} onPress={() => go("representativeClients")}><Ionicons name="people-outline" size={23} color={colors.navy} /><Text style={styles.sideLabel}>Clientes</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></Pressable><Pressable style={styles.sideItem} onPress={() => go("representativeOrders")}><Ionicons name="receipt-outline" size={23} color={colors.navy} /><Text style={styles.sideLabel}>Meus pedidos</Text><Ionicons name="chevron-forward" size={20} color={colors.navy} /></Pressable></View>}
          <View style={styles.sideSocialDock}>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.instagram)}><Ionicons name="logo-instagram" size={24} color={colors.navy} /></Pressable>
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.linkedin)}><Ionicons name="logo-linkedin" size={24} color={colors.navy} /></Pressable>
            {allowWhatsApp && <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.whatsapp)}><Ionicons name="logo-whatsapp" size={24} color={colors.navy} /></Pressable>}
            <Pressable style={styles.sideSocialIcon} onPress={() => Linking.openURL(links.site)}><Ionicons name="globe-outline" size={24} color={colors.navy} /></Pressable>
          </View>
          <Text style={styles.sideCopyright}>© 2026 Briland. Todos os direitos reservados.</Text>
        </ScrollView>
      </View></MotionDrawer>
    </Modal>
  );
}

function PageTitle({ title, subtitle, badge }: { title: string; subtitle: string; badge?: string }) {
  return <View style={styles.titleBlock}><View style={styles.titleRow}><Text style={styles.pageTitle}>{title}</Text>{badge && <Text style={styles.badge}>{badge}</Text>}</View><Text style={styles.pageSubtitle}>{subtitle}</Text><View style={styles.titleAccent} /></View>;
}

function Chip({ text, onPress }: { text: string; onPress: () => void }) {
  return <Pressable style={styles.chip} onPress={onPress}><Text style={styles.chipText}>{text}</Text><Ionicons name="chevron-down" size={16} color={colors.navy} /></Pressable>;
}

function CatalogPdfScreen({ url }: { url: string }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.contentWithDock}>
      <PageTitle title="Catálogo em PDF" subtitle="Baixe a versão completa do catálogo Briland para consultar quando quiser." />
      <View style={styles.catalogPdfPageCard}>
        <View style={styles.catalogPdfPageIcon}><Ionicons name="document-text-outline" size={38} color={colors.yellow} /></View>
        <Text style={styles.catalogPdfPageTitle}>Catálogo geral Briland</Text>
        <Text style={styles.catalogPdfPageText}>Arquivo organizado com os produtos e informações comerciais disponíveis para o seu perfil.</Text>
        {url ? <CatalogPdfButton url={url} /> : <View style={styles.catalogPdfUnavailable}><Ionicons name="time-outline" size={22} color={colors.muted} /><Text style={styles.muted}>O catálogo em PDF está sendo preparado.</Text></View>}
      </View>
    </ScrollView>
  );
}

function CatalogPdfButton({ url }: { url: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [progress, setProgress] = useState<number | null>(0);
  const stretch = useRef(new Animated.Value(0)).current;
  const download = async () => {
    if (phase !== "idle") return;
    setPhase("loading");
    setProgress(null);
    Animated.timing(stretch, { toValue: 1, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    const success = await trackedDownload(url, { fileType: "catalog_pdf", fileName: "catalogo-briland.pdf" }, undefined, setProgress);
    if (success) {
      setPhase("done");
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    Animated.timing(stretch, { toValue: 0, duration: 260, useNativeDriver: false }).start();
    setPhase("idle");
    setProgress(0);
  };
  return (
    <Pressable style={styles.catalogPdfButton} onPress={() => void download()} disabled={phase !== "idle"}>
      <Animated.View style={[styles.catalogPdfMotion, { width: stretch.interpolate({ inputRange: [0, 1], outputRange: [46, 142] }) }]}>
        {phase === "idle" ? <View style={styles.catalogPdfCircle}><Ionicons name="download-outline" size={22} color="#111" /></View> : phase === "done" ? <View style={[styles.catalogPdfCircle, styles.catalogPdfDone]}><Ionicons name="checkmark" size={23} color="#16834B" /></View> : <View style={styles.catalogPdfTrack}><View style={[styles.catalogPdfFill, { width: progress == null ? "38%" : `${progress}%` }]} /></View>}
      </Animated.View>
      <View style={styles.flex}>
        <Text style={styles.catalogPdfTitle}>{phase === "done" ? "Download iniciado" : "Download PDF do catálogo"}</Text>
        <Text style={styles.mutedSmall}>{phase === "idle" ? "catalogo-briland.pdf" : phase === "loading" ? (progress == null ? "Preparando PDF…" : `${progress}% · catalogo-briland.pdf`) : "PDF pronto"}</Text>
      </View>
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

function DarkInput({ icon, value, onChangeText, placeholder, secure, autoComplete }: { icon: IconName; value?: string; onChangeText?: (text: string) => void; placeholder: string; secure?: boolean; autoComplete?: "off" | "email" | "current-password" }) {
  return <View style={styles.darkInput}><Ionicons name={icon} size={25} color={colors.white} /><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={secure} autoComplete={autoComplete} importantForAutofill={autoComplete === "off" ? "no" : "auto"} placeholderTextColor="#8EA0BB" style={styles.darkInputText} /></View>;
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
  logoPlateCompact: { width: 190, height: 70 },
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
  headerActions: { width: 82, flexDirection: "row", justifyContent: "flex-end", gap: 2 },
  headerSmallButton: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  headerBadge: { position: "absolute", right: 1, top: 2, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  headerBadgeText: { color: colors.navy, fontSize: 10, fontWeight: "900" },
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
  catalogPdfMotion: { height: 46, justifyContent: "center" },
  catalogPdfCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: "#111", backgroundColor: "#FFFDF7", alignItems: "center", justifyContent: "center" },
  catalogPdfDone: { borderColor: "#16834B" },
  catalogPdfTrack: { height: 8, borderRadius: 5, borderWidth: 2, borderColor: "#111", backgroundColor: "#FFFDF7", overflow: "hidden" },
  catalogPdfFill: { height: "100%", backgroundColor: "#111" },
  catalogPdfTitle: { color: colors.navy, fontSize: 16, fontWeight: "900" },
  catalogPdfPageCard: { padding: 22, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, ...shadow },
  catalogPdfPageIcon: { width: 66, height: 66, marginBottom: 18, borderRadius: 18, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  catalogPdfPageTitle: { color: colors.navy, fontSize: 23, fontWeight: "900", marginBottom: 7 },
  catalogPdfPageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: 22 },
  catalogPdfUnavailable: { minHeight: 70, borderRadius: 16, backgroundColor: colors.soft, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 16 },
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
  progressiveCard: { width: "47.4%", height: 226, borderRadius: 18, overflow: "hidden", backgroundColor: colors.navy, ...shadow },
  progressiveCardPressed: { transform: [{ scale: 0.975 }], opacity: 0.94 },
  progressiveCardImage: { width: "100%", height: "100%" },
  progressiveCardImageFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", paddingBottom: 54 },
  progressiveCardGradient: { position: "absolute", left: 0, right: 0, top: 18, bottom: 0 },
  progressiveCardContent: { position: "absolute", left: 14, right: 42, bottom: 13 },
  progressiveCardTitle: { color: colors.white, fontSize: 18, lineHeight: 21, fontWeight: "900", textShadowColor: "rgba(0,0,0,.4)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  progressiveCardDescription: { color: "#E3EAF2", fontSize: 11, lineHeight: 14, marginTop: 3 },
  progressiveCardCount: { color: colors.yellow, fontSize: 11, fontWeight: "900", marginTop: 5 },
  progressiveCardArrow: { position: "absolute", right: 12, bottom: 14, width: 27, height: 27, borderRadius: 14, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  searchRow: { flexDirection: "row", gap: 12 },
  searchSuggestions: { marginTop: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, overflow: "hidden" },
  suggestionLabel: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 7, color: colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  suggestionItem: { minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.line },
  suggestionCode: { color: colors.navy, fontSize: 12, fontWeight: "900" },
  suggestionName: { color: colors.muted, fontSize: 12 },
  emptySearchCard: { marginTop: 22, padding: 26, borderRadius: 20, backgroundColor: colors.white, alignItems: "center", gap: 12, ...shadow },
  emptySearchTitle: { color: colors.navy, fontSize: 20, fontWeight: "900", textAlign: "center" },
  emptySearchButton: { minHeight: 50, marginTop: 8, paddingHorizontal: 18, borderRadius: 13, backgroundColor: colors.green, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  emptySearchButtonText: { color: colors.white, fontWeight: "900" },
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
  detailMedia: { height: 450, borderRadius: 22, overflow: "hidden", backgroundColor: colors.white, marginBottom: 20, ...shadow },
  detailGalleryPage: { height: 375, backgroundColor: colors.white },
  detailImagePressable: { flex: 1 },
  detailImageStack: { flex: 1, backgroundColor: colors.white },
  detailImage: { width: "100%", height: "100%", backgroundColor: colors.white },
  detailImageOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "transparent" },
  detailThumbnailBar: { position: "absolute", left: 14, right: 14, bottom: 14, height: 58, flexDirection: "row", justifyContent: "center", gap: 8 },
  detailThumbnailButton: { width: 58, height: 58, padding: 3, borderRadius: 10, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.white, overflow: "hidden" },
  detailThumbnailButtonActive: { borderColor: colors.yellow },
  detailThumbnail: { width: "100%", height: "100%" },
  dotsOverlay: { position: "absolute", bottom: 80, alignSelf: "center", flexDirection: "row", gap: 8 },
  dotGalleryInactive: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#C7CED8" },
  zoomHint: { position: "absolute", right: 14, top: 14, minHeight: 34, paddingHorizontal: 11, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.92)", flexDirection: "row", alignItems: "center", gap: 6, ...shadow },
  zoomHintText: { color: colors.navy, fontSize: 11, fontWeight: "900" },
  smallYellow: { color: colors.yellow, fontWeight: "900", marginBottom: 6 },
  detailTitle: { color: colors.navy, fontSize: 27, fontWeight: "900", lineHeight: 34 },
  detailTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  shareButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow },
  fullscreenGallery: { flex: 1, backgroundColor: "#010916" },
  fullscreenClose: { position: "absolute", zIndex: 4, right: 18, top: 52, width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  fullscreenZoom: { flex: 1 },
  fullscreenZoomContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  fullscreenHint: { position: "absolute", bottom: 34, alignSelf: "center", color: colors.white, fontSize: 13, fontWeight: "800", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
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
  outlineButton: { minHeight: 54, borderRadius: 13, borderWidth: 1, borderColor: colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  outlineButtonText: { color: colors.navy, fontWeight: "900", textAlign: "center" },
  sectionTitle: { color: colors.navy, fontSize: 20, fontWeight: "900", marginBottom: 8 },
  whatsButton: { width: 58, height: 58, borderRadius: 14, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", ...shadow },
  quantityControl: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  quantityButton: { width: 34, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: colors.soft },
  quantityText: { minWidth: 30, textAlign: "center", color: colors.navy, fontWeight: "900" },
  notificationItem: { minHeight: 92, marginBottom: 10, padding: 15, borderRadius: 16, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.line },
  notificationUnread: { borderColor: colors.yellow, backgroundColor: "#FFFCF0" },
  notificationIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.yellow, alignItems: "center", justifyContent: "center" },
  notificationTitle: { color: colors.navy, fontSize: 14, fontWeight: "900" },
  notificationLink: { color: colors.navy, marginTop: 5, fontSize: 12, fontWeight: "900" },
  notificationDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.yellow },
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
  disabledInput: { backgroundColor: colors.soft, borderStyle: "dashed" },
  fieldHint: { marginTop: -10, marginBottom: 10, color: colors.muted, fontSize: 11, fontWeight: "700" },
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
  mobileOrderCard:{width:"100%",minHeight:118,marginTop:12,padding:16,borderRadius:18,overflow:"hidden",backgroundColor:colors.white,flexDirection:"row",alignItems:"stretch",gap:12,...shadow},
  mobileOrderInfo:{flex:1,minWidth:0,justifyContent:"center"},
  mobileOrderClient:{width:"100%",marginVertical:6,color:colors.navy,fontSize:15,lineHeight:20,fontWeight:"800"},
  mobileOrderRight:{width:116,minWidth:116,alignItems:"flex-end",justifyContent:"center",gap:10},
  mobileOrderStatus:{maxWidth:"100%",overflow:"hidden",borderRadius:10,paddingHorizontal:9,paddingVertical:5,fontSize:10,fontWeight:"900",textAlign:"center"},
  mobileOrderTotal:{width:"100%",color:colors.navy,fontSize:16,fontWeight:"900",textAlign:"right"},
  representativeClientSearch:{height:58,marginTop:14,marginBottom:4,borderRadius:16,backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,paddingHorizontal:15,flexDirection:"row",alignItems:"center",gap:10,...shadow},
  representativeClientCard:{minHeight:132,marginTop:12,padding:15,borderRadius:18,backgroundColor:colors.white,flexDirection:"row",alignItems:"flex-start",gap:12,borderWidth:1,borderColor:colors.line,...shadow},
  representativeClientIcon:{width:46,height:46,borderRadius:14,backgroundColor:"#FFF6D8",alignItems:"center",justifyContent:"center"},
  representativeClientCompany:{color:colors.navy,fontSize:16,lineHeight:21,fontWeight:"900"},
  representativeClientDocument:{marginTop:5,color:colors.navy,fontSize:12,fontWeight:"800"},
  representativeClientContact:{marginTop:5,color:colors.muted,fontSize:12,lineHeight:17},
  mobileChoiceRow:{flexGrow:0,marginBottom:12},
  mobileClientSearchBox:{minHeight:54,marginBottom:8,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:colors.white,paddingHorizontal:14,flexDirection:"row",alignItems:"center",gap:10},
  mobileClientSearchInput:{flex:1,minHeight:52,color:colors.navy,fontSize:14,fontWeight:"700"},
  mobileClientSuggestion:{minHeight:66,marginBottom:7,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:colors.white,paddingHorizontal:12,paddingVertical:9,flexDirection:"row",alignItems:"center",gap:10},
  mobileClientSuggestionIcon:{width:38,height:38,borderRadius:11,backgroundColor:"#FFF4CC",alignItems:"center",justifyContent:"center"},
  mobileClientSuggestionName:{color:colors.navy,fontSize:13,fontWeight:"900"},
  mobileClientNoResult:{marginBottom:10,borderRadius:12,backgroundColor:"#FFF7DB",padding:12},
  mobileSelectedClient:{minHeight:62,marginBottom:12,borderWidth:1,borderColor:"#BDE7D7",borderRadius:14,backgroundColor:"#F1FBF7",paddingHorizontal:13,flexDirection:"row",alignItems:"center",gap:10},
  mobileChoice:{minHeight:42,marginRight:8,borderWidth:1,borderColor:colors.line,borderRadius:21,backgroundColor:colors.white,paddingHorizontal:15,alignItems:"center",justifyContent:"center"},
  mobileChoiceActive:{borderColor:colors.navy,backgroundColor:colors.navy},
  mobileChoiceText:{color:colors.navy,fontSize:12,fontWeight:"800"},
  mobileChoiceTextActive:{color:colors.white},
  mobileOrderOptions:{flexDirection:"row",gap:8,marginBottom:10},
  mobileOrderInput:{minHeight:50,marginBottom:12,borderWidth:1,borderColor:colors.line,borderRadius:13,backgroundColor:colors.white,paddingHorizontal:14,color:colors.navy,fontWeight:"700"},
  mobileProductSuggestion:{minHeight:58,marginBottom:7,borderWidth:1,borderColor:colors.line,borderRadius:13,backgroundColor:colors.white,paddingHorizontal:13,flexDirection:"row",alignItems:"center",gap:10},
  mobileOrderItem:{minHeight:112,marginTop:10,borderRadius:16,backgroundColor:colors.white,padding:14,flexDirection:"row",alignItems:"center",gap:10,...shadow},
  mobileOrderItemName:{maxWidth:210,marginVertical:4,color:colors.navy,fontWeight:"800"},
  mobileOrderControls:{width:104,alignItems:"center",gap:9},
  mobileOrderField:{width:"100%",alignItems:"stretch",gap:4},
  mobileOrderFieldLabel:{color:colors.navy,fontSize:10,fontWeight:"900",textAlign:"center"},
  mobileOrderFieldHint:{color:colors.muted,fontSize:9,fontWeight:"700",textAlign:"center"},
  mobileNumberInput:{width:"100%",height:42,borderWidth:1,borderColor:colors.line,borderRadius:10,backgroundColor:colors.soft,textAlign:"center",color:colors.navy,fontWeight:"900"},
  mobileOrderSummary:{marginTop:18,borderRadius:18,backgroundColor:colors.navy,padding:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  mobileOrderGrandTotal:{color:colors.yellow,fontSize:22,fontWeight:"900"},
  mobileOrderActions:{marginTop:14,gap:10},
  mobileDraftButton:{minHeight:54,borderWidth:1,borderColor:colors.navy,borderRadius:13,alignItems:"center",justifyContent:"center",backgroundColor:colors.white},
  mobileDraftButtonText:{color:colors.navy,fontWeight:"900"},
  editorSwitch: { height: 48, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }
});
