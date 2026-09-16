const digits = (value: string, limit: number) => value.replace(/\D/g, "").slice(0, limit);

export function maskCnpj(value: string) {
  return digits(value, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function maskCep(value: string) {
  return digits(value, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

export function maskPhone(value: string) {
  const clean = digits(value, 11);
  if (clean.length <= 10) return clean.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return clean.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}
