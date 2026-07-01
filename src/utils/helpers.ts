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

export function loginErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) return "Senha incorreta ou e-mail incorreto.";
  if (lower.includes("email not confirmed")) return "E-mail ainda não confirmado.";
  if (lower.includes("user") && lower.includes("not")) return "E-mail incorreto ou usuário não encontrado.";
  return "Não foi possível entrar. Confira e-mail e senha.";
}
