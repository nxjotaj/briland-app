export function money(value?: number | null) {
  if (typeof value !== "number") return "Sob consulta";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `produto-${Date.now()}`;
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function leadDepartment(message?: string | null, origin?: string | null) {
  const source = `${origin || ""} ${message || ""}`.toLowerCase();
  if (source.includes("suporte")) return "Suporte";
  if (source.includes("comercial")) return "Comercial";
  return "Não informado";
}

export function leadMessageBody(message?: string | null) {
  return (message || "").replace(/^\[(Comercial|Suporte)\]\s*/i, "").trim();
}

type ImageTransformOptions = {
  width: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
  version?: number;
};

export function optimizedImageUrl(url?: string | null, options?: ImageTransformOptions) {
  if (!url || !options) return url || "";
  const marker = "/storage/v1/object/public/";
  if (!url.includes(marker)) return url;
  try {
    const parsed = new URL(url.replace(marker, "/storage/v1/render/image/public/"));
    parsed.searchParams.set("width", String(options.width));
    if (options.height) parsed.searchParams.set("height", String(options.height));
    parsed.searchParams.set("resize", options.resize || "contain");
    parsed.searchParams.set("quality", String(options.quality ?? 78));
    if (options.version) parsed.searchParams.set("_v", String(options.version));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function loginErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) return "Senha incorreta ou e-mail incorreto.";
  if (lower.includes("email not confirmed")) return "E-mail ainda não confirmado.";
  if (lower.includes("user") && lower.includes("not")) return "E-mail incorreto ou usuário não encontrado.";
  return "Não foi possível entrar. Confira e-mail e senha.";
}

export function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }
  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const [headers = [], ...body] = rows;
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index]?.trim() ?? ""])));
}
