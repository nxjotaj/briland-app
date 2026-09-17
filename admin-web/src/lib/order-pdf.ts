import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildCommercialOrderPdf } from "../../../catalog-web/src/lib/order-pdf-core";
import type { SalesOrder } from "./types";

export async function orderPdfFile(order: SalesOrder, logoUrl = "/catalog-assets/briland-logo.png") {
  const logoResponse = await fetch(logoUrl);
  if (!logoResponse.ok) throw new Error("Não foi possível carregar a logo da Briland.");
  const bytes = await buildCommercialOrderPdf(order, new Uint8Array(await logoResponse.arrayBuffer()), { PDFDocument, StandardFonts, rgb });
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  return new File([blob], `pedido-${String(order.orderNumber).padStart(6, "0")}.pdf`, { type: "application/pdf" });
}
