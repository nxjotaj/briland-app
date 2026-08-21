import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFNumber,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage
} from "pdf-lib";
import type {
  AppData,
  CatalogPdfEditorialSettings,
  CatalogPdfRole,
  Categoria,
  Produto
} from "@/lib/types";

const A4 = { width: 595.28, height: 841.89 };
const COLORS = {
  navy: rgb(0.008, 0.067, 0.149),
  navySoft: rgb(0.035, 0.11, 0.22),
  yellow: rgb(0.988, 0.727, 0),
  ink: rgb(0.035, 0.067, 0.125),
  muted: rgb(0.36, 0.39, 0.45),
  soft: rgb(0.957, 0.965, 0.98),
  line: rgb(0.875, 0.89, 0.92),
  white: rgb(1, 1, 1)
};
const CATEGORY_COLORS = [
  rgb(0.008, 0.067, 0.149),
  rgb(0.0, 0.38, 0.56),
  rgb(0.08, 0.46, 0.34),
  rgb(0.65, 0.21, 0.18),
  rgb(0.36, 0.25, 0.58),
  rgb(0.78, 0.39, 0.02),
  rgb(0.19, 0.28, 0.39),
  rgb(0.35, 0.42, 0.12)
];

export type CatalogImageWarning = {
  productId?: string;
  productCode?: string;
  productName: string;
  reason: "missing" | "low-resolution" | "load-error";
  detail: string;
};

export type CatalogPdfBuildResult = {
  bytes: Uint8Array;
  warnings: CatalogImageWarning[];
  pageCount: number;
};

type Fonts = { regular: PDFFont; bold: PDFFont; display: PDFFont };
type LoadedImage = { image: PDFImage; sourceWidth: number; sourceHeight: number; ratio: number };
type ProductPresentation = {
  product: Produto;
  category: Categoria;
  brand: string;
  applications: string[];
  technical: string[];
  commercial: string[];
  complexity: number;
};
type Grid = { columns: 4; rows: 3; capacity: 12; label: "4x3" };

const roleLabel: Record<CatalogPdfRole, string> = {
  VISITANTE: "Visitante",
  NAO_CLIENTE: "Nao cliente",
  CLIENTE: "Cliente",
  REPRESENTANTE: "Representante"
};

function permissionAllowed(data: AppData, role: CatalogPdfRole, key: string, fallback = true) {
  const permission = data.permissoes.find((item) => item.fieldKey === key);
  if (!permission) return fallback;
  if (role === "VISITANTE") return permission.visibleToVisitor;
  if (role === "NAO_CLIENTE") return permission.visibleToNonClient;
  if (role === "CLIENTE") return permission.visibleToClient;
  return permission.visibleToRepresentative;
}

function safeText(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function categoryColor(index: number) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

function resolveApplications(product: Produto, data: AppData) {
  return data.produtoModelosVeiculo
    .filter((item) => item.produtoId === product.id)
    .map((item) => {
      const brand = data.montadoras.find((entry) => entry.id === item.montadoraId)?.nome || "Montadora";
      const model = data.modelosVeiculo.find((entry) => entry.id === item.modeloId)?.nome || "Modelo";
      const start = item.anoInicial;
      const end = item.anoFinal;
      const years = !start || !end ? "todos os anos" : start === end ? String(start) : `${start} a ${end}`;
      return `${brand} ${model} (${years})`;
    });
}

function buildPresentation(product: Produto, category: Categoria, data: AppData, role: CatalogPdfRole): ProductPresentation {
  const applications = permissionAllowed(data, role, "aplicacoesVeiculo")
    ? resolveApplications(product, data)
    : [];
  const technical: string[] = [];
  const commercial: string[] = [];
  if (permissionAllowed(data, role, "caixaMaster") && product.caixaMaster) technical.push(`CX ${product.caixaMaster}`);
  if (permissionAllowed(data, role, "ean") && product.ean) technical.push(`EAN ${product.ean}`);
  if (permissionAllowed(data, role, "ncm") && product.ncm) technical.push(`NCM ${product.ncm}`);
  if (permissionAllowed(data, role, "ca", false) && product.ca) technical.push(`CA ${product.ca}`);
  if (permissionAllowed(data, role, "fichaTecnica") && product.fichaTecnica) commercial.push(safeText(product.fichaTecnica));
  if (permissionAllowed(data, role, "observacaoComercial") && product.observacaoComercial) commercial.push(safeText(product.observacaoComercial));
  const brand = data.marcas.find((entry) => entry.id === product.marcaId)?.nome || "";
  const textLoad = safeText(product.nome).length + commercial.join(" ").length + applications.slice(0, 4).join(" ").length;
  const complexity = applications.length > 8 || textLoad > 430 ? 3 : applications.length > 3 || textLoad > 220 ? 2 : 1;
  return { product, category, brand, applications, technical, commercial, complexity };
}

function chooseGrid(): Grid {
  return { columns: 4, rows: 3, capacity: 12, label: "4x3" };
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Nao foi possivel carregar ${url}.`);
  return response.arrayBuffer();
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  try {
    const [montserrat, oswald] = await Promise.all([
      Promise.all([
        fetchBytes("/catalog-assets/Montserrat-Regular.ttf"),
        fetchBytes("/catalog-assets/Montserrat-Bold.ttf")
      ]),
      fetchBytes("/catalog-assets/Oswald-SemiBold.ttf")
    ]);
    const regular = await pdf.embedFont(montserrat[0], { subset: true });
    const bold = await pdf.embedFont(montserrat[1], { subset: true });
    const display = await pdf.embedFont(oswald, { subset: true });
    return { regular, bold, display };
  } catch {
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      display: await pdf.embedFont(StandardFonts.HelveticaBold)
    };
  }
}

async function embedLogo(pdf: PDFDocument, configuredUrl?: string | null) {
  const candidates = [configuredUrl, "/catalog-assets/briland-logo.png"].filter(Boolean) as string[];
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const type = response.headers.get("content-type") || "";
      const bytes = await response.arrayBuffer();
      if (type.includes("jpeg") || /\.jpe?g($|\?)/i.test(url)) return pdf.embedJpg(bytes);
      return pdf.embedPng(bytes);
    } catch {
      // The textual fallback is drawn when neither source can be loaded.
    }
  }
  return null;
}

async function prepareImage(
  pdf: PDFDocument,
  url: string,
  warning: Omit<CatalogImageWarning, "reason" | "detail">,
  warnings: CatalogImageWarning[],
  options: { trimWhitespace?: boolean } = {}
): Promise<LoadedImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) {
      throw new Error("O arquivo cadastrado nao respondeu como imagem.");
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    if (sourceWidth < 500 || sourceHeight < 350) {
      warnings.push({
        ...warning,
        reason: "low-resolution",
        detail: `Imagem com ${sourceWidth} x ${sourceHeight}px. Recomendado: pelo menos 900 x 650px.`
      });
    }
    const scan = document.createElement("canvas");
    scan.width = sourceWidth;
    scan.height = sourceHeight;
    const scanContext = scan.getContext("2d", { willReadFrequently: true });
    if (!scanContext) throw new Error("Nao foi possivel analisar a imagem.");
    scanContext.drawImage(bitmap, 0, 0);
    const pixels = scanContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
    let minX = sourceWidth;
    let minY = sourceHeight;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < sourceHeight; y += Math.max(1, Math.floor(sourceHeight / 700))) {
      for (let x = 0; x < sourceWidth; x += Math.max(1, Math.floor(sourceWidth / 700))) {
        const offset = (y * sourceWidth + x) * 4;
        const alpha = pixels[offset + 3];
        const brightness = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
        const visible = alpha > 18 && brightness < 247;
        if (visible) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const trimWhitespace = options.trimWhitespace !== false;
    const hasSafeBounds = trimWhitespace && found && maxX - minX > sourceWidth * 0.08 && maxY - minY > sourceHeight * 0.08;
    const padX = Math.round(sourceWidth * 0.035);
    const padY = Math.round(sourceHeight * 0.035);
    const sx = hasSafeBounds ? Math.max(0, minX - padX) : 0;
    const sy = hasSafeBounds ? Math.max(0, minY - padY) : 0;
    const sw = hasSafeBounds ? Math.min(sourceWidth - sx, maxX - minX + padX * 2) : sourceWidth;
    const sh = hasSafeBounds ? Math.min(sourceHeight - sy, maxY - minY + padY * 2) : sourceHeight;
    const scale = Math.min(1, 1200 / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Nao foi possivel preparar a imagem.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/jpeg", 0.86));
    if (!jpeg) throw new Error("Nao foi possivel converter a imagem.");
    return {
      image: await pdf.embedJpg(await jpeg.arrayBuffer()),
      sourceWidth,
      sourceHeight,
      ratio: width / height
    };
  } catch (error) {
    warnings.push({
      ...warning,
      reason: "load-error",
      detail: error instanceof Error ? error.message : "Nao foi possivel carregar a imagem."
    });
    return null;
  }
}

function fitImage(page: PDFPage, source: LoadedImage | { image: PDFImage; ratio: number }, x: number, y: number, width: number, height: number, fill = 0.88) {
  const maxWidth = width * fill;
  const maxHeight = height * fill;
  let drawWidth = maxWidth;
  let drawHeight = drawWidth / source.ratio;
  if (drawHeight > maxHeight) {
    drawHeight = maxHeight;
    drawWidth = drawHeight * source.ratio;
  }
  page.drawImage(source.image, {
    x: x + (width - drawWidth) / 2,
    y: y + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight
  });
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number) {
  const words = safeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let truncated = false;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if ((truncated || words.join(" ").length > lines.join(" ").length) && lines.length) {
    let last = lines[lines.length - 1];
    while (last && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trim()}...`;
  }
  return lines;
}

function drawLines(page: PDFPage, lines: string[], x: number, y: number, font: PDFFont, size: number, color = COLORS.ink, leading = size + 2) {
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * leading, font, size, color }));
  return y - lines.length * leading;
}

function drawLogo(page: PDFPage, logo: PDFImage | null, fonts: Fonts, x: number, y: number, width: number, height: number, light = false) {
  if (logo) {
    const ratio = logo.width / logo.height;
    let drawWidth = width;
    let drawHeight = drawWidth / ratio;
    if (drawHeight > height) {
      drawHeight = height;
      drawWidth = drawHeight * ratio;
    }
    page.drawImage(logo, { x, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
    return;
  }
  page.drawText("BRILAND", { x, y: y + height * 0.35, font: fonts.display, size: Math.min(28, height * 0.65), color: light ? COLORS.white : COLORS.navy });
}

function drawHeader(page: PDFPage, fonts: Fonts, logo: PDFImage | null, category?: string) {
  page.drawRectangle({ x: 0, y: 805, width: A4.width, height: 37, color: COLORS.navy });
  drawLogo(page, logo, fonts, 30, 812, 90, 20, true);
  if (category) page.drawText(category.toUpperCase(), { x: 425, y: 818, size: 8, font: fonts.bold, color: COLORS.yellow });
}

function drawFooter(page: PDFPage, fonts: Fonts, pageNumber: number, total: number, edition: string) {
  page.drawLine({ start: { x: 30, y: 27 }, end: { x: 565, y: 27 }, thickness: 0.7, color: COLORS.line });
  page.drawText(`BRILAND | CATALOGO ${edition.toUpperCase()}`, { x: 30, y: 14, size: 6.5, font: fonts.regular, color: COLORS.muted });
  const label = `${pageNumber} / ${total}`;
  page.drawText(label, { x: 565 - fonts.bold.widthOfTextAtSize(label, 7), y: 14, size: 7, font: fonts.bold, color: COLORS.navy });
}

function addInternalLink(pdf: PDFDocument, source: PDFPage, target: PDFPage, rect: [number, number, number, number]) {
  const annotation = pdf.context.register(pdf.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: rect.map((value) => PDFNumber.of(value)),
    Border: [PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)],
    Dest: [target.ref, PDFName.of("Fit")]
  }));
  const key = PDFName.of("Annots");
  const existing = source.node.lookupMaybe(key, PDFArray);
  if (existing) existing.push(annotation);
  else source.node.set(key, pdf.context.obj([annotation]));
}

function drawCover(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  cover: LoadedImage | null,
  settings: Required<Pick<CatalogPdfEditorialSettings, "title" | "edition">>
) {
  if (cover) {
    page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: COLORS.navy });
    fitImage(page, cover, 0, 0, A4.width, A4.height, 1);
    return;
  }
  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: COLORS.navy });
  page.drawRectangle({ x: 0, y: 0, width: 18, height: A4.height, color: COLORS.yellow });
  page.drawCircle({ x: 510, y: 760, size: 185, color: COLORS.navySoft });
  page.drawCircle({ x: 525, y: 755, size: 125, borderColor: COLORS.yellow, borderWidth: 1.2 });
  drawLogo(page, logo, fonts, 52, 731, 180, 56, true);
  page.drawText("SOLUCOES AUTOMOTIVAS", { x: 54, y: 690, size: 10, font: fonts.bold, color: COLORS.yellow });
  drawLines(page, wrapLines(settings.title.toUpperCase(), fonts.display, 40, 465, 3), 52, 613, fonts.display, 40, COLORS.white, 45);
  page.drawText(settings.edition.toUpperCase(), { x: 54, y: 472, size: 14, font: fonts.bold, color: COLORS.yellow });
  page.drawRectangle({ x: 52, y: 115, width: 491, height: 245, color: COLORS.navySoft, borderColor: rgb(0.12, 0.2, 0.31), borderWidth: 1 });
  page.drawText("TECNOLOGIA, DESEMPENHO E CONFIANCA", { x: 82, y: 227, size: 18, font: fonts.display, color: COLORS.white });
  page.drawRectangle({ x: 82, y: 203, width: 120, height: 5, color: COLORS.yellow });
}

function drawInstitutional(
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  title: string,
  body: string,
  contact: string
) {
  drawHeader(page, fonts, logo, "Apresentacao");
  page.drawText("MAIS QUE PRODUTOS.", { x: 42, y: 728, size: 30, font: fonts.display, color: COLORS.navy });
  page.drawText("SOLUCOES PARA O SEU NEGOCIO.", { x: 42, y: 690, size: 30, font: fonts.display, color: COLORS.navy });
  page.drawRectangle({ x: 42, y: 665, width: 88, height: 6, color: COLORS.yellow });
  page.drawText(title, { x: 42, y: 610, size: 15, font: fonts.bold, color: COLORS.ink });
  drawLines(page, wrapLines(body, fonts.regular, 10.5, 485, 16), 42, 580, fonts.regular, 10.5, COLORS.muted, 17);
  page.drawRectangle({ x: 42, y: 160, width: 511, height: 132, color: COLORS.soft });
  page.drawText("ATENDIMENTO COMERCIAL", { x: 64, y: 255, size: 10, font: fonts.bold, color: COLORS.navy });
  drawLines(page, wrapLines(contact, fonts.regular, 10, 450, 5), 64, 229, fonts.regular, 10, COLORS.muted, 16);
}

function drawIndex(page: PDFPage, fonts: Fonts, logo: PDFImage | null, groups: Array<{ category: Categoria; products: Produto[] }>) {
  drawHeader(page, fonts, logo, "Indice");
  page.drawText("INDICE DE CATEGORIAS", { x: 42, y: 738, size: 29, font: fonts.display, color: COLORS.navy });
  page.drawText("Navegue pelas linhas de produtos Briland.", { x: 42, y: 712, size: 10, font: fonts.regular, color: COLORS.muted });
  const entries: Array<{ group: typeof groups[number]; rect: [number, number, number, number] }> = [];
  groups.forEach((group, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 42 + column * 260;
    const y = 650 - row * 76;
    const color = categoryColor(index);
    page.drawRectangle({ x, y, width: 245, height: 59, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.8 });
    page.drawRectangle({ x, y, width: 8, height: 59, color });
    page.drawText(String(index + 1).padStart(2, "0"), { x: x + 20, y: y + 35, size: 11, font: fonts.bold, color });
    drawLines(page, wrapLines(group.category.nome.toUpperCase(), fonts.display, 12, 154, 2), x + 52, y + 37, fonts.display, 12, COLORS.navy, 14);
    const count = `${group.products.length} produtos`;
    page.drawText(count, { x: x + 52, y: y + 11, size: 7, font: fonts.regular, color: COLORS.muted });
    page.drawText(">", { x: x + 222, y: y + 24, size: 13, font: fonts.bold, color });
    entries.push({ group, rect: [x, y, x + 245, y + 59] });
  });
  return entries;
}

async function drawCategoryOpener(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  group: { category: Categoria; products: Produto[] },
  index: number,
  warnings: CatalogImageWarning[],
  categoryArtUrl?: string
) {
  if (categoryArtUrl) {
    const artwork = await prepareImage(
      pdf,
      categoryArtUrl,
      { productName: `Arte editorial da categoria ${group.category.nome}` },
      warnings,
      { trimWhitespace: false }
    );
    if (artwork) {
      page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: categoryColor(index) });
      fitImage(page, artwork, 0, 0, A4.width, A4.height, 1);
      return;
    }
  }
  const color = categoryColor(index);
  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color });
  page.drawRectangle({ x: 0, y: 0, width: 18, height: A4.height, color: COLORS.yellow });
  drawLogo(page, logo, fonts, 45, 752, 140, 40, true);
  page.drawText(String(index + 1).padStart(2, "0"), { x: 45, y: 655, size: 20, font: fonts.bold, color: COLORS.yellow });
  drawLines(page, wrapLines(group.category.nome.toUpperCase(), fonts.display, 42, 490, 3), 45, 610, fonts.display, 42, COLORS.white, 47);
  if (group.category.descricao) {
    drawLines(page, wrapLines(group.category.descricao, fonts.regular, 11, 450, 5), 45, 455, fonts.regular, 11, rgb(0.86, 0.9, 0.94), 17);
  }
  page.drawText(`${group.products.length} PRODUTOS`, { x: 45, y: 385, size: 11, font: fonts.bold, color: COLORS.yellow });
  if (group.category.imagem) {
    const image = await prepareImage(pdf, group.category.imagem, { productName: `Categoria ${group.category.nome}` }, warnings);
    if (image) {
      page.drawRectangle({ x: 285, y: 75, width: 270, height: 280, color: COLORS.white });
      fitImage(page, image, 285, 75, 270, 280, 0.87);
    }
  }
}

async function drawProductCard(
  pdf: PDFDocument,
  page: PDFPage,
  item: ProductPresentation,
  fonts: Fonts,
  grid: Grid,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: ReturnType<typeof rgb>,
  warnings: CatalogImageWarning[]
) {
  page.drawRectangle({ x, y, width, height, color: COLORS.white, borderColor: rgb(0.72, 0.76, 0.82), borderWidth: 0.85 });
  page.drawRectangle({ x, y: y + height - 4, width, height: 4, color: accent });
  const padding = 8;
  const imageHeight = height * 0.43;
  const imageY = y + height - imageHeight - 8;
  if (item.product.imagemPrincipal) {
    const image = await prepareImage(pdf, item.product.imagemPrincipal, {
      productId: item.product.id,
      productCode: item.product.codigoInterno || undefined,
      productName: item.product.nome
    }, warnings);
    if (image) fitImage(page, image, x + padding, imageY, width - padding * 2, imageHeight, 0.84);
  } else {
    warnings.push({
      productId: item.product.id,
      productCode: item.product.codigoInterno || undefined,
      productName: item.product.nome,
      reason: "missing",
      detail: "Produto sem imagem principal."
    });
    page.drawRectangle({ x: x + padding, y: imageY + 5, width: width - padding * 2, height: imageHeight - 10, color: COLORS.soft });
    page.drawText("IMAGEM EM ATUALIZACAO", { x: x + padding + 5, y: imageY + imageHeight / 2, size: 6.5, font: fonts.bold, color: COLORS.ink });
  }
  const codeSize = 8.8;
  const nameSize = 8.4;
  let cursor = imageY - 5;
  const codeText = safeText(item.product.codigoInterno) || "SEM CODIGO";
  page.drawText(codeText, { x: x + padding, y: cursor, size: codeSize, font: fonts.bold, color: accent });
  if (item.brand) {
    const brand = safeText(item.brand).toUpperCase();
    const brandWidth = fonts.bold.widthOfTextAtSize(brand, 5.8);
    const codeWidth = fonts.bold.widthOfTextAtSize(codeText, codeSize);
    if (codeWidth + brandWidth + 8 < width - padding * 2) {
      page.drawText(brand, { x: x + width - padding - brandWidth, y: cursor + 1, size: 5.8, font: fonts.bold, color: COLORS.navySoft });
    }
  }
  cursor -= nameSize + 4;
  const nameLines = wrapLines(item.product.nome.toUpperCase(), fonts.bold, nameSize, width - padding * 2, 3);
  cursor = drawLines(page, nameLines, x + padding, cursor, fonts.bold, nameSize, COLORS.ink, nameSize + 2);
  const applicationMax = 2;
  if (item.applications.length && cursor > y + 50) {
    cursor -= 2;
    page.drawText("APLICACAO", { x: x + padding, y: cursor, size: 6.2, font: fonts.bold, color: COLORS.navy });
    cursor -= 9;
    const application = item.applications.slice(0, applicationMax).join(" | ");
    const applicationSize = 6.8;
    cursor = drawLines(page, wrapLines(application, fonts.regular, applicationSize, width - padding * 2, applicationMax + 1), x + padding, cursor, fonts.regular, applicationSize, COLORS.ink, applicationSize + 2);
    if (item.applications.length > applicationMax) {
      page.drawText(`+ ${item.applications.length - applicationMax} no indice tecnico`, { x: x + padding, y: Math.max(y + 37, cursor), size: 6.1, font: fonts.bold, color: accent });
    }
  }
  if (item.commercial.length && cursor > y + 62) {
    cursor -= 6;
    drawLines(page, wrapLines(item.commercial[0], fonts.regular, 6.5, width - padding * 2, 2), x + padding, cursor, fonts.regular, 6.5, COLORS.ink, 8.5);
  }
  if (item.technical.length) {
    const label = item.technical.join("  |  ");
    const stripHeight = 32;
    const technicalSize = 6.2;
    page.drawRectangle({ x, y, width, height: stripHeight, color: rgb(1, 0.965, 0.79) });
    drawLines(page, wrapLines(label, fonts.bold, technicalSize, width - padding * 2, 2), x + padding, y + stripHeight - 10, fonts.bold, technicalSize, COLORS.ink, technicalSize + 2.5);
  }
}

async function drawGridPage(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  logo: PDFImage | null,
  items: ProductPresentation[],
  grid: Grid,
  category: Categoria,
  categoryIndex: number,
  warnings: CatalogImageWarning[]
) {
  drawHeader(page, fonts, logo, category.nome);
  const marginX = 30;
  const gap = 7;
  const top = 792;
  const bottom = 38;
  const usableWidth = A4.width - marginX * 2;
  const usableHeight = top - bottom;
  const cardWidth = (usableWidth - gap * (grid.columns - 1)) / grid.columns;
  const cardHeight = (usableHeight - gap * (grid.rows - 1)) / grid.rows;
  const accent = categoryColor(categoryIndex);
  await Promise.all(items.map((item, index) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const x = marginX + column * (cardWidth + gap);
    const y = top - (row + 1) * cardHeight - row * gap;
    return drawProductCard(pdf, page, item, fonts, grid, x, y, cardWidth, cardHeight, accent, warnings);
  }));
}

function drawApplicationTables(pdf: PDFDocument, fonts: Fonts, logo: PDFImage | null, items: ProductPresentation[]) {
  const detailed = items.filter((item) => item.applications.length > 3);
  if (!detailed.length) return;
  let page = pdf.addPage([A4.width, A4.height]);
  let y = 748;
  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    y = 748;
    drawHeader(page, fonts, logo, "Indice de aplicacoes");
    page.drawText("INDICE DE APLICACOES", { x: 34, y: 766, size: 17, font: fonts.display, color: COLORS.navy });
  };
  drawHeader(page, fonts, logo, "Indice de aplicacoes");
  page.drawText("INDICE DE APLICACOES", { x: 34, y: 766, size: 17, font: fonts.display, color: COLORS.navy });
  for (const item of detailed) {
    const lines = item.applications.flatMap((application) => wrapLines(application, fonts.regular, 7.5, 338, 2));
    const rowHeight = Math.max(30, 18 + lines.length * 10);
    if (y - rowHeight < 44) newPage();
    page.drawRectangle({ x: 34, y: y - rowHeight, width: 527, height: rowHeight, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.6 });
    page.drawRectangle({ x: 34, y: y - rowHeight, width: 139, height: rowHeight, color: COLORS.soft });
    page.drawText(safeText(item.product.codigoInterno) || "SEM CODIGO", { x: 44, y: y - 15, size: 7.5, font: fonts.bold, color: COLORS.navy });
    drawLines(page, wrapLines(item.product.nome, fonts.bold, 7, 119, 3), 44, y - 28, fonts.bold, 7, COLORS.ink, 9);
    drawLines(page, lines, 188, y - 15, fonts.regular, 7.5, COLORS.muted, 10);
    y -= rowHeight + 5;
  }
}

function drawBackCover(page: PDFPage, fonts: Fonts, logo: PDFImage | null, backCover: LoadedImage | null, contact: string, edition: string) {
  if (backCover) {
    page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: COLORS.navy });
    fitImage(page, backCover, 0, 0, A4.width, A4.height, 1);
    return;
  }
  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: COLORS.navy });
  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: 14, color: COLORS.yellow });
  drawLogo(page, logo, fonts, 54, 235, 190, 55, true);
  page.drawText("CONHECA A LINHA COMPLETA.", { x: 54, y: 190, size: 21, font: fonts.display, color: COLORS.white });
  drawLines(page, wrapLines(contact, fonts.regular, 9.5, 455, 5), 54, 155, fonts.regular, 9.5, rgb(0.8, 0.85, 0.9), 15);
  page.drawText(edition.toUpperCase(), { x: 54, y: 55, size: 9, font: fonts.bold, color: COLORS.yellow });
}

export async function buildCatalogPdf(
  data: AppData,
  role: CatalogPdfRole,
  editorial: CatalogPdfEditorialSettings = {}
): Promise<CatalogPdfBuildResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(editorial.title || "Catalogo de Produtos Briland");
  pdf.setAuthor("Briland");
  pdf.setSubject("Catalogo comercial de produtos e aplicacoes automotivas");
  pdf.setCreator("Gerador Editorial Briland");
  pdf.setProducer("Briland");
  pdf.setCreationDate(new Date());
  const fonts = await embedFonts(pdf);
  const logo = await embedLogo(pdf, data.settings.catalogAppearance?.logoUrl);
  const warnings: CatalogImageWarning[] = [];
  const activeProducts = data.produtos.filter((product) => product.ativo !== false);
  const groups = data.categorias
    .filter((category) => category.ativo !== false)
    .map((category) => ({
      category,
      products: activeProducts
        .filter((product) => product.categoriaId === category.id)
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || safeText(a.codigoInterno).localeCompare(safeText(b.codigoInterno), "pt-BR", { numeric: true }))
    }))
    .filter((group) => group.products.length);
  const knownCategoryIds = new Set(data.categorias.map((category) => category.id));
  const uncategorized = activeProducts.filter((product) => !product.categoriaId || !knownCategoryIds.has(product.categoriaId));
  if (uncategorized.length) groups.push({ category: { id: "sem-categoria", nome: "Outros produtos", ativo: true }, products: uncategorized });

  const currentYear = new Date().getFullYear();
  const title = safeText(editorial.title) || "Catalogo de Produtos";
  const edition = safeText(editorial.edition) || `Edicao ${currentYear}`;
  const institutionalTitle = safeText(editorial.institutionalTitle) || "Bem-vindo a Briland";
  const institutionalBody = safeText(editorial.institutionalBody)
    || "A Briland conecta produtos, tecnologia e atendimento para oferecer solucoes automotivas confiaveis. Este catalogo foi organizado para tornar a consulta mais rapida, clara e comercial.";
  const contact = safeText(editorial.contactText)
    || "Fale com a equipe Briland para informacoes comerciais, disponibilidade e suporte.";

  const cover = editorial.coverImage
    ? await prepareImage(pdf, editorial.coverImage, { productName: "Capa do catalogo" }, warnings, { trimWhitespace: false })
    : null;
  const backCover = editorial.backCoverImage
    ? await prepareImage(pdf, editorial.backCoverImage, { productName: "Contracapa do catalogo" }, warnings, { trimWhitespace: false })
    : null;

  const coverPage = pdf.addPage([A4.width, A4.height]);
  drawCover(coverPage, fonts, logo, cover, { title, edition });
  const institutionalPage = pdf.addPage([A4.width, A4.height]);
  drawInstitutional(institutionalPage, fonts, logo, institutionalTitle, institutionalBody, contact);
  const indexPage = pdf.addPage([A4.width, A4.height]);
  const indexEntries = drawIndex(indexPage, fonts, logo, groups);
  const categoryTargets = new Map<string, PDFPage>();
  const allPresentations: ProductPresentation[] = [];

  for (let categoryIndex = 0; categoryIndex < groups.length; categoryIndex += 1) {
    const group = groups[categoryIndex];
    const opener = pdf.addPage([A4.width, A4.height]);
    categoryTargets.set(group.category.id, opener);
    await drawCategoryOpener(pdf, opener, fonts, logo, group, categoryIndex, warnings, editorial.categoryArt?.[group.category.id]);
    const subcategories = data.subcategorias.filter((item) => item.categoriaId === group.category.id && item.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
    const sections: Array<{ label: string; products: Produto[] }> = [{ label: group.category.nome, products: group.products.filter((product) => !product.subcategoriaId) }];
    for (const subcategory of subcategories) {
      sections.push({ label: `${group.category.nome} › ${subcategory.nome}`, products: group.products.filter((product) => product.subcategoriaId === subcategory.id && !product.grupoProdutoId) });
      for (const productGroup of data.gruposProduto.filter((item) => item.subcategoriaId === subcategory.id && item.ativo !== false).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"))) {
        sections.push({ label: `${group.category.nome} › ${subcategory.nome} › ${productGroup.nome}`, products: group.products.filter((product) => product.grupoProdutoId === productGroup.id) });
      }
    }
    for (const section of sections.filter((item) => item.products.length)) {
      const sectionCategory = { ...group.category, nome: section.label };
      const presentations = section.products.map((product) => buildPresentation(product, sectionCategory, data, role));
      allPresentations.push(...presentations);
      const grid = chooseGrid();
      let cursor = 0;
      while (cursor < presentations.length) {
        const remaining = presentations.length - cursor;
        const pagesRemaining = Math.ceil(remaining / grid.capacity);
        const balancedBatchSize = Math.ceil(remaining / pagesRemaining);
        const page = pdf.addPage([A4.width, A4.height]);
        const batch = presentations.slice(cursor, cursor + balancedBatchSize);
        await drawGridPage(pdf, page, fonts, logo, batch, grid, sectionCategory, categoryIndex, warnings);
        cursor += batch.length;
      }
    }
  }

  drawApplicationTables(pdf, fonts, logo, allPresentations);
  const backPage = pdf.addPage([A4.width, A4.height]);
  drawBackCover(backPage, fonts, logo, backCover, contact, edition);

  indexEntries.forEach((entry) => {
    const target = categoryTargets.get(entry.group.category.id);
    if (target) addInternalLink(pdf, indexPage, target, entry.rect);
  });
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    if (index !== 0 && index !== pages.length - 1) drawFooter(page, fonts, index + 1, pages.length, edition);
  });
  pdf.setKeywords(["Briland", "catalogo", "automotivo", roleLabel[role]]);
  return { bytes: await pdf.save(), warnings, pageCount: pages.length };
}
