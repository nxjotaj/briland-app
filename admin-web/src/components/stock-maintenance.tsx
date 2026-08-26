"use client";

import { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  Loader2,
  PackageCheck,
  Search,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Categoria, Produto } from "@/lib/types";

type Notify = (message: string) => void;
type ManualLine = {
  productCode: string;
  quantity: number;
  mode: "AJUSTE" | "INVENTARIO";
  product?: Produto;
  error?: string;
};
type FiscalNature =
  | "COMPRA_IMPORTACAO"
  | "VENDA"
  | "TRANSFERENCIA"
  | "DEVOLUCAO"
  | "CANCELAMENTO"
  | "NAO_RECONHECIDA";
type FiscalItem = {
  lineNumber: number;
  productCode: string;
  description: string;
  quantity: number;
  cfop: string;
  product?: Produto;
  currentBalance: number;
  projectedBalance: number;
  error?: string;
};
type FiscalDocument = {
  file: File;
  accessKey: string;
  eventId: string;
  number: string;
  series: string;
  issuedAt: string;
  issuer: Record<string, string>;
  recipient: Record<string, string>;
  purpose: string;
  operationNature: string;
  cfops: string[];
  nature: FiscalNature;
  authorized: boolean;
  classifiedManually?: boolean;
  items: FiscalItem[];
  storagePath?: string;
  manualClassificationReason?: string;
  errors: string[];
};
type HistoryRow = {
  movementId: string;
  createdAt: string;
  batchId: string;
  productId: string;
  productCode: string;
  productName: string;
  kind: string;
  quantity: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  accessKey?: string | null;
  documentNature?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
};

const normalizeCode = (value: string) =>
  value.trim().toLocaleUpperCase("pt-BR");
const localName = (element: Element, name: string) =>
  Array.from(element.getElementsByTagName("*"))
    .find((node) => node.localName === name)
    ?.textContent?.trim() || "";
const descendants = (element: Element, name: string) =>
  Array.from(element.getElementsByTagName("*")).filter(
    (node) => node.localName === name,
  );
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "-";
const csvEscape = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

function classifyNature(
  operation: string,
  cfops: string[],
  eventType: string,
): FiscalNature {
  if (eventType === "110111") return "CANCELAMENTO";
  const text = operation
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/devoluc|retorno/.test(text)) return "DEVOLUCAO";
  if (/transfer/.test(text)) return "TRANSFERENCIA";
  if (/import|compra|entrada/.test(text)) return "COMPRA_IMPORTACAO";
  if (/venda|saida/.test(text)) return "VENDA";
  if (
    cfops.some((value) =>
      /^(1202|1203|2202|2203|5201|5202|5208|5209|6201|6202|6208|6209)$/.test(
        value,
      ),
    )
  )
    return "DEVOLUCAO";
  if (cfops.some((value) => /^(5151|5152|6151|6152|6155|6156)/.test(value)))
    return "TRANSFERENCIA";
  if (cfops.some((value) => /^(3|1|2)/.test(value))) return "COMPRA_IMPORTACAO";
  if (cfops.some((value) => /^(5|6|7)/.test(value))) return "VENDA";
  return "NAO_RECONHECIDA";
}

async function parseFiscalXml(
  file: File,
  products: Produto[],
  direction: "ENTRADA" | "SAIDA",
): Promise<FiscalDocument> {
  const source = await file.text();
  const xml = new DOMParser().parseFromString(source, "application/xml");
  if (xml.querySelector("parsererror"))
    throw new Error(`${file.name}: o arquivo não contém um XML válido.`);
  const root = xml.documentElement;
  const eventNode = descendants(root, "infEvento")[0];
  const eventType = eventNode ? localName(eventNode, "tpEvento") : "";
  const nfeInfo = descendants(root, "infNFe")[0];
  const accessKey = (
    eventNode
      ? localName(eventNode, "chNFe")
      : nfeInfo?.getAttribute("Id") || localName(root, "chNFe")
  )
    .replace(/^NFe/i, "")
    .replace(/\D/g, "");
  const eventId = eventNode?.getAttribute("Id") || localName(root, "Id");
  const operationNature = localName(root, "natOp");
  const cfops = Array.from(
    new Set(
      descendants(root, "CFOP")
        .map((node) => node.textContent?.trim() || "")
        .filter(Boolean),
    ),
  );
  const nature = classifyNature(operationNature, cfops, eventType);
  const statusCode = localName(root, "cStat");
  const authorized =
    eventType === "110111"
      ? ["135", "136", "155"].includes(statusCode)
      : ["100", "150"].includes(statusCode);
  const itemNodes = descendants(root, "det");
  const productIndex = new Map<string, Produto[]>();
  products.forEach((product) => {
    const key = normalizeCode(product.codigoInterno || "");
    if (key) productIndex.set(key, [...(productIndex.get(key) || []), product]);
  });
  const running = new Map<string, number>();
  const items: FiscalItem[] = itemNodes.map((node, index) => {
    const code = normalizeCode(localName(node, "cProd"));
    const quantity = Number(localName(node, "qCom").replace(",", "."));
    const matches = productIndex.get(code) || [];
    const product = matches.length === 1 ? matches[0] : undefined;
    const current = Number(product?.estoque || 0);
    const prior = running.get(product?.id || code) ?? current;
    const projected = prior + (direction === "ENTRADA" ? quantity : -quantity);
    running.set(product?.id || code, projected);
    let error = "";
    if (!code) error = "Item sem cProd.";
    else if (matches.length === 0)
      error = `Não existe produto com o código ${code}.`;
    else if (matches.length > 1)
      error = `Existem ${matches.length} produtos com o código ${code}.`;
    else if (!Number.isInteger(quantity) || quantity <= 0)
      error = `A quantidade de ${code} deve ser inteira e positiva.`;
    else if (projected < 0)
      error = `${code} ficaria com saldo negativo (${projected}).`;
    return {
      lineNumber: Number(node.getAttribute("nItem") || index + 1),
      productCode: code,
      description: localName(node, "xProd"),
      quantity,
      cfop: localName(node, "CFOP"),
      product,
      currentBalance: prior,
      projectedBalance: projected,
      error: error || undefined,
    };
  });
  const errors: string[] = [];
  if (accessKey.length !== 44)
    errors.push("Chave de acesso da NF-e ausente ou inválida.");
  if (!authorized)
    errors.push(
      `Documento não autorizado (cStat ${statusCode || "não informado"}).`,
    );
  if (nature === "NAO_RECONHECIDA")
    errors.push(
      "Natureza fiscal não reconhecida; selecione a classificação e justifique.",
    );
  if (
    (nature === "COMPRA_IMPORTACAO" && direction === "SAIDA") ||
    (nature === "VENDA" && direction === "ENTRADA")
  )
    errors.push(
      "A natureza fiscal contradiz a direção escolhida; revise e justifique a classificação.",
    );
  if (nature !== "CANCELAMENTO" && !items.length)
    errors.push("NF-e sem itens de produto.");
  errors.push(...items.flatMap((item) => (item.error ? [item.error] : [])));
  const emit = descendants(root, "emit")[0];
  const dest = descendants(root, "dest")[0];
  return {
    file,
    accessKey,
    eventId,
    number: localName(root, "nNF"),
    series: localName(root, "serie"),
    issuedAt: localName(root, "dhEmi") || localName(root, "dEmi"),
    issuer: {
      cnpj: emit ? localName(emit, "CNPJ") : "",
      name: emit ? localName(emit, "xNome") : "",
    },
    recipient: {
      cnpj: dest ? localName(dest, "CNPJ") : "",
      name: dest ? localName(dest, "xNome") : "",
    },
    purpose: localName(root, "finNFe"),
    operationNature,
    cfops,
    nature,
    authorized,
    items,
    errors,
  };
}

function recalculateFiscalBalances(
  documents: FiscalDocument[],
  direction: "ENTRADA" | "SAIDA",
) {
  const balances = new Map<string, number>();
  return documents.map((document) => ({
    ...document,
    items: document.items.map((item) => {
      const key = item.product?.id || item.productCode;
      const currentBalance =
        balances.get(key) ?? Number(item.product?.estoque || 0);
      const projectedBalance =
        currentBalance +
        (direction === "ENTRADA" ? item.quantity : -item.quantity);
      balances.set(key, projectedBalance);
      const priorErrors =
        item.error &&
        !item.error.includes("saldo negativo") &&
        !item.error.includes("ficaria com saldo negativo")
          ? item.error
          : undefined;
      const error =
        priorErrors ||
        (projectedBalance < 0
          ? `${item.productCode} ficaria com saldo negativo (${projectedBalance}).`
          : undefined);
      return { ...item, currentBalance, projectedBalance, error };
    }),
  }));
}

export function StockMaintenance({
  products,
  categories,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  categories: Categoria[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [section, setSection] = useState<"manual" | "xml" | "history">(
    "manual",
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          ["manual", "Manutenção rápida"],
          ["xml", "Entrada e saída por XML"],
          ["history", "Histórico"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id as typeof section)}
            className={section === id ? "btn-primary" : "btn-white"}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "manual" && (
        <ManualMaintenance
          products={products}
          categories={categories}
          notify={notify}
          reloadProducts={reloadProducts}
        />
      )}{" "}
      {section === "xml" && (
        <XmlMaintenance
          products={products}
          notify={notify}
          reloadProducts={reloadProducts}
        />
      )}{" "}
      {section === "history" && <StockHistory notify={notify} />}
    </div>
  );
}

function ManualMaintenance({
  products,
  categories,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  categories: Categoria[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState<"AJUSTE" | "INVENTARIO">("AJUSTE");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            (!category || p.categoriaId === category) &&
            (!query ||
              `${p.codigoInterno} ${p.nome}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .slice(0, 300),
    [products, category, query],
  );
  const lines = useMemo<ManualLine[]>(
    () =>
      Object.entries(values)
        .filter(([, v]) => v.trim() !== "")
        .map(([id, v]) => {
          const product = products.find((p) => p.id === id);
          const quantity = Number(v.replace(",", "."));
          let error = "";
          const projected =
            mode === "INVENTARIO"
              ? quantity
              : Number(product?.estoque || 0) + quantity;
          if (!Number.isInteger(quantity))
            error = "Use somente números inteiros.";
          else if (projected < 0)
            error = `Saldo projetado negativo (${projected}).`;
          return {
            productCode: product?.codigoInterno || "",
            quantity,
            mode,
            product,
            error: error || undefined,
          };
        }),
    [values, products, mode],
  );
  const importPaste = () => {
    const next = { ...values };
    const index = new Map(
      products.map((p) => [normalizeCode(p.codigoInterno || ""), p]),
    );
    const errors: string[] = [];
    paste
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((row, i) => {
        const [code, value] = row.split(/[;\t]/);
        const product = index.get(normalizeCode(code || ""));
        if (!product)
          errors.push(
            `Linha ${i + 1}: produto ${code || "sem código"} não encontrado.`,
          );
        else next[product.id] = String(value || "").trim();
      });
    setValues(next);
    notify(
      errors.length
        ? errors.slice(0, 4).join(" ")
        : "Linhas adicionadas à conferência.",
    );
  };
  const apply = async () => {
    if (!reason.trim()) {
      notify("Informe o motivo da manutenção de saldo.");
      return;
    }
    if (!lines.length) {
      notify("Informe ao menos uma alteração de saldo.");
      return;
    }
    if (lines.some((l) => l.error)) {
      notify("Corrija as linhas inválidas antes de confirmar.");
      return;
    }
    if (!confirm(`Confirmar ${lines.length} alteração(ões) de saldo?`)) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("apply_manual_stock_batch", {
        p_reason: reason.trim(),
        p_items: lines.map((l) => ({
          productCode: l.productCode,
          quantity: l.quantity,
          mode: l.mode,
        })),
      });
      if (error) throw error;
      notify(
        `Saldo atualizado. ${(data as { productsChanged?: number })?.productsChanged || 0} produto(s) alterado(s).`,
      );
      setValues({});
      setPaste("");
      setReason("");
      await reloadProducts();
    } catch (e) {
      notify(stockError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Card title="Manutenção manual em massa">
        <div className="grid gap-4 lg:grid-cols-4">
          <Label text="Modo">
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="AJUSTE">Somar ou subtrair</option>
              <option value="INVENTARIO">Definir saldo absoluto</option>
            </select>
          </Label>
          <Label text="Buscar">
            <div className="relative">
              <Search
                className="absolute left-3 top-3 text-slate-400"
                size={17}
              />
              <input
                className="input pl-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Código ou nome"
              />
            </div>
          </Label>
          <Label text="Categoria">
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Motivo obrigatório">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: inventário de agosto"
            />
          </Label>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <textarea
            className="textarea min-h-24"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"Cole do Excel: código + quantidade\nBRMG4401\t10"}
          />
          <button className="btn-white self-end" onClick={importPaste}>
            Adicionar linhas coladas
          </button>
        </div>
      </Card>
      <Card title={`${lines.length} produto(s) na conferência`}>
        <div className="max-h-[560px] overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Saldo atual</th>
                <th>{mode === "AJUSTE" ? "Ajuste (+/-)" : "Novo saldo"}</th>
                <th>Saldo projetado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const value = values[p.id] || "";
                const numeric = Number(value.replace(",", "."));
                const projected =
                  value === ""
                    ? Number(p.estoque || 0)
                    : mode === "INVENTARIO"
                      ? numeric
                      : Number(p.estoque || 0) + numeric;
                const line = lines.find((l) => l.product?.id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-black">{p.codigoInterno || "-"}</td>
                    <td>{p.nome}</td>
                    <td>{p.estoque ?? 0}</td>
                    <td>
                      <input
                        className={`input w-32 ${line?.error ? "border-red-500" : ""}`}
                        inputMode="numeric"
                        value={value}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [p.id]: e.target.value }))
                        }
                      />
                      {line?.error && (
                        <div className="mt-1 text-xs font-bold text-red-700">
                          {line.error}
                        </div>
                      )}
                    </td>
                    <td
                      className={
                        projected < 0 ? "font-black text-red-700" : "font-black"
                      }
                    >
                      {Number.isFinite(projected) ? projected : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            disabled={saving}
            className="btn-primary"
            onClick={() => void apply()}
          >
            {saving ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <PackageCheck size={17} />
            )}{" "}
            Conferir e aplicar lote
          </button>
        </div>
      </Card>
    </>
  );
}

function XmlMaintenance({
  products,
  notify,
  reloadProducts,
}: {
  products: Produto[];
  notify: Notify;
  reloadProducts: () => Promise<void>;
}) {
  const [direction, setDirection] = useState<"ENTRADA" | "SAIDA">("ENTRADA");
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const max = direction === "ENTRADA" ? 10 : 50;
  const invalid = documents.some(
    (d) =>
      d.errors.length ||
      d.items.some((i) => i.error) ||
      (d.classifiedManually && !d.manualClassificationReason?.trim()),
  );
  const selectFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length > max) {
      notify(`Selecione no máximo ${max} XMLs neste lote.`);
      return;
    }
    setWorking(true);
    try {
      const parsed = [] as FiscalDocument[];
      for (const file of selected) {
        if (!/\.xml$/i.test(file.name)) {
          notify(`${file.name}: formato não aceito.`);
          continue;
        }
        try {
          parsed.push(await parseFiscalXml(file, products, direction));
        } catch (e) {
          notify(stockError(e));
        }
      }
      setDocuments(recalculateFiscalBalances(parsed, direction));
    } finally {
      setWorking(false);
    }
  };
  const reclassify = (index: number, nature: FiscalNature) =>
    setDocuments((current) =>
      current.map((doc, i) =>
        i !== index
          ? doc
          : {
              ...doc,
              nature,
              classifiedManually: true,
              errors: doc.errors.filter(
                (e) =>
                  !e.startsWith("Natureza fiscal") &&
                  !e.startsWith("A natureza fiscal contradiz"),
              ),
            },
      ),
    );
  const apply = async () => {
    if (!documents.length) {
      notify("Selecione os XMLs do lote.");
      return;
    }
    if (invalid) {
      notify(
        "O lote possui pendências. Corrija ou remova os documentos indicados.",
      );
      return;
    }
    if (documents.some((d) => d.nature === "NAO_RECONHECIDA")) {
      notify("Classifique todos os documentos antes de confirmar.");
      return;
    }
    if (
      !confirm(
        `Aplicar ${documents.length} documento(s) como ${direction.toLowerCase()}?`,
      )
    )
      return;
    setWorking(true);
    const uploaded: string[] = [];
    try {
      const payload = [];
      for (const doc of documents) {
        const safe = doc.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
        const { error: uploadError } = await supabase.storage
          .from("fiscal-xml")
          .upload(path, doc.file, {
            contentType: doc.file.type || "application/xml",
            upsert: false,
          });
        if (uploadError)
          throw new Error(
            `${doc.file.name}: falha ao guardar o XML com segurança. ${uploadError.message}`,
          );
        uploaded.push(path);
        payload.push({
          ...doc,
          file: undefined,
          storagePath: path,
          items: doc.items.map(
            ({ product, currentBalance, projectedBalance, error, ...item }) =>
              item,
          ),
        });
      }
      const { data, error } = await supabase.rpc("apply_fiscal_stock_batch", {
        p_direction: direction,
        p_reason: reason.trim() || null,
        p_documents: payload,
      });
      if (error) throw error;
      notify(
        `Lote aplicado: ${(data as { documentsProcessed?: number })?.documentsProcessed || documents.length} documento(s).`,
      );
      setDocuments([]);
      setReason("");
      await reloadProducts();
    } catch (e) {
      if (uploaded.length)
        await supabase.storage.from("fiscal-xml").remove(uploaded);
      notify(stockError(e));
    } finally {
      setWorking(false);
    }
  };
  return (
    <>
      <Card title="Processar XML fiscal">
        <div className="grid gap-4 lg:grid-cols-3">
          <Label text="Direção relativa ao estoque Briland">
            <select
              className="input"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as typeof direction);
                setDocuments([]);
              }}
            >
              <option value="ENTRADA">Entrada — aumenta saldo</option>
              <option value="SAIDA">Saída — reduz saldo</option>
            </select>
          </Label>
          <Label text="Observação do lote">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Opcional quando a natureza é reconhecida"
            />
          </Label>
          <Label text={`XMLs — máximo ${max}`}>
            <label className="btn-white cursor-pointer">
              <Upload size={17} />
              {working ? "Lendo arquivos..." : "Selecionar XMLs"}
              <input
                hidden
                type="file"
                multiple
                accept=".xml,application/xml,text/xml"
                onChange={(e) => void selectFiles(e.target.files)}
              />
            </label>
          </Label>
        </div>
        <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-blue-950">
          O sistema usa exclusivamente o cProd do XML para localizar o código
          interno. Nenhum saldo muda antes da sua confirmação.
        </div>
      </Card>
      <div className="space-y-4">
        {documents.map((doc, index) => (
          <Card
            key={`${doc.file.name}-${index}`}
            title={`${doc.file.name} — NF-e ${doc.number || "sem número"}`}
          >
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <Info label="Chave" value={doc.accessKey || "Não informada"} />
              <Info label="Natureza" value={doc.nature.replaceAll("_", " ")} />
              <Info
                label="Emitente"
                value={doc.issuer.name || doc.issuer.cnpj || "-"}
              />
              <Info
                label="Situação"
                value={doc.authorized ? "Autorizada" : "Não autorizada"}
              />
            </div>
            {(doc.nature === "NAO_RECONHECIDA" ||
              doc.classifiedManually ||
              doc.errors.some((e) =>
                e.startsWith("A natureza fiscal contradiz"),
              )) && (
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <Label text="Classificação manual">
                  <select
                    className="input"
                    value={doc.nature}
                    onChange={(e) =>
                      reclassify(index, e.target.value as FiscalNature)
                    }
                  >
                    <option value="NAO_RECONHECIDA">Selecione</option>
                    <option value="COMPRA_IMPORTACAO">Compra/importação</option>
                    <option value="VENDA">Venda</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                    <option value="DEVOLUCAO">Devolução</option>
                  </select>
                </Label>
                <Label text="Justificativa obrigatória">
                  <input
                    className="input"
                    value={doc.manualClassificationReason || ""}
                    onChange={(e) =>
                      setDocuments((ds) =>
                        ds.map((d, i) =>
                          i === index
                            ? {
                                ...d,
                                classifiedManually: true,
                                manualClassificationReason: e.target.value,
                                errors: d.errors.filter(
                                  (x) =>
                                    !x.startsWith(
                                      "A natureza fiscal contradiz",
                                    ),
                                ),
                              }
                            : d,
                        ),
                      )
                    }
                  />
                </Label>
              </div>
            )}
            {doc.errors.length > 0 && (
              <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
                {doc.errors.map((e) => (
                  <div key={e}>• {e}</div>
                ))}
              </div>
            )}
            <div className="overflow-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>cProd</th>
                    <th>Produto</th>
                    <th>Quantidade</th>
                    <th>Saldo atual</th>
                    <th>Projetado</th>
                    <th>Validação</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((item) => (
                    <tr key={item.lineNumber}>
                      <td>{item.lineNumber}</td>
                      <td className="font-black">{item.productCode}</td>
                      <td>{item.product?.nome || "Não encontrado"}</td>
                      <td>{item.quantity}</td>
                      <td>{item.currentBalance}</td>
                      <td>{item.projectedBalance}</td>
                      <td>
                        {item.error ? (
                          <span className="font-bold text-red-700">
                            {item.error}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                            <CheckCircle2 size={15} />
                            Pronto
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="mt-4 text-sm font-black text-red-700"
              onClick={() =>
                setDocuments((ds) =>
                  recalculateFiscalBalances(
                    ds.filter((_, i) => i !== index),
                    direction,
                  ),
                )
              }
            >
              Retirar documento do lote
            </button>
          </Card>
        ))}
      </div>
      {documents.length > 0 && (
        <div className="flex justify-end">
          <button
            disabled={working || invalid}
            className="btn-primary"
            onClick={() => void apply()}
          >
            {working ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <FileCode2 size={17} />
            )}{" "}
            Confirmar lote completo
          </button>
        </div>
      )}
    </>
  );
}

function StockHistory({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [code, setCode] = useState("");
  const [direction, setDirection] = useState("");
  const [key, setKey] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_stock_maintenance_history",
        {
          p_from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
          p_to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
          p_product_code: code || null,
          p_direction: direction || null,
          p_access_key: key || null,
        },
      );
      if (error) throw error;
      setRows((data || []) as HistoryRow[]);
    } catch (e) {
      notify(stockError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    void (async () => {
      const { data } = await supabase.rpc("get_expired_fiscal_xml_paths");
      const paths = ((data || []) as Array<{ path: string }>)
        .map((row) => row.path)
        .filter(Boolean);
      if (!paths.length) return;
      const { error } = await supabase.storage.from("fiscal-xml").remove(paths);
      if (!error) {
        await supabase.rpc("confirm_fiscal_xml_cleanup", { p_paths: paths });
      }
    })();
  }, []);
  const exportCsv = () => {
    const headers = [
      "Data",
      "Lote",
      "Código",
      "Produto",
      "Tipo",
      "Quantidade",
      "Saldo anterior",
      "Novo saldo",
      "Chave NF-e",
      "Natureza",
      "Responsável",
      "Motivo",
    ];
    const csv = [
      headers,
      ...rows.map((r) => [
        r.createdAt,
        r.batchId,
        r.productCode,
        r.productName,
        r.kind,
        r.quantity,
        r.previousBalance,
        r.newBalance,
        r.accessKey,
        r.documentNature,
        r.actorEmail || r.actorName,
        r.reason,
      ]),
    ]
      .map((row) => row.map(csvEscape).join(";"))
      .join("\r\n");
    download(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
      "historico-saldo.csv",
    );
  };
  const exportXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Movimentações");
    ws.addRow([
      "Data",
      "Lote",
      "Código",
      "Produto",
      "Tipo",
      "Quantidade",
      "Saldo anterior",
      "Novo saldo",
      "Chave NF-e",
      "Natureza",
      "Responsável",
      "Motivo",
    ]);
    rows.forEach((r) =>
      ws.addRow([
        r.createdAt,
        r.batchId,
        r.productCode,
        r.productName,
        r.kind,
        r.quantity,
        r.previousBalance,
        r.newBalance,
        r.accessKey,
        r.documentNature,
        r.actorEmail || r.actorName,
        r.reason,
      ]),
    );
    ws.getRow(1).font = { bold: true };
    const buffer = await wb.xlsx.writeBuffer();
    download(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "historico-saldo.xlsx",
    );
  };
  return (
    <>
      <Card title="Filtros do histórico">
        <div className="grid gap-3 lg:grid-cols-5">
          <Label text="De">
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Label>
          <Label text="Até">
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Label>
          <Label text="Código">
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Label>
          <Label text="Tipo">
            <select
              className="input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="">Todos</option>
              <option>ENTRADA</option>
              <option>SAIDA</option>
              <option>AJUSTE</option>
              <option>INVENTARIO</option>
              <option>REVERSAO</option>
            </select>
          </Label>
          <Label text="Chave NF-e">
            <input
              className="input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => void load()}>
            {loading ? (
              <Loader2 className="animate-spin" size={17} />
            ) : (
              <Search size={17} />
            )}
            Consultar
          </button>
          <button className="btn-white" onClick={exportCsv}>
            <Download size={17} />
            CSV
          </button>
          <button className="btn-white" onClick={() => void exportXlsx()}>
            <Download size={17} />
            XLSX
          </button>
        </div>
      </Card>
      <Card title={`${rows.length} movimentação(ões)`}>
        <div className="max-h-[650px] overflow-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Código / produto</th>
                <th>Tipo</th>
                <th>Quantidade</th>
                <th>Saldo</th>
                <th>NF-e</th>
                <th>Responsável</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.movementId}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>
                    <b>{r.productCode}</b>
                    <div className="text-xs text-slate-500">
                      {r.productName}
                    </div>
                  </td>
                  <td>{r.kind}</td>
                  <td
                    className={
                      r.quantity < 0
                        ? "font-black text-red-700"
                        : "font-black text-emerald-700"
                    }
                  >
                    {r.quantity > 0 ? "+" : ""}
                    {r.quantity}
                  </td>
                  <td>
                    {r.previousBalance} → <b>{r.newBalance}</b>
                  </td>
                  <td>{r.accessKey || "-"}</td>
                  <td>{r.actorEmail || r.actorName || "-"}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function stockError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error
        ? String(
            (error as { message?: string }).message || JSON.stringify(error),
          )
        : String(error);
  if (/duplicate|23505/i.test(raw))
    return `Este documento já foi processado. ${raw}`;
  if (/negative|negativo|23514/i.test(raw))
    return `O lote foi bloqueado para evitar saldo negativo. ${raw}`;
  if (/permission|42501/i.test(raw))
    return "Seu usuário não possui autorização para movimentar o estoque.";
  return raw || "Não foi possível processar o lote.";
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-5 text-lg font-black text-navy">{title}</h3>
      {children}
    </section>
  );
}
function Label({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">
        {text}
      </span>
      {children}
    </label>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[10px] font-black uppercase text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm font-bold">{value}</div>
    </div>
  );
}
