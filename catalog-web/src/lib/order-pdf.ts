import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildCommercialOrderPdf } from "../../../shared/order-pdf-core";
import type { SalesOrder, SalesStock } from "./types";

const PAGE = { width: 595.28, height: 841.89 };
const navy = rgb(0.008, 0.067, 0.149);
const yellow = rgb(0.988, 0.727, 0);
const ink = rgb(0.08, 0.1, 0.15);
const soft = rgb(0.96, 0.97, 0.98);
const text = (value: unknown) => String(value ?? "-").replace(/\s+/g, " ").trim() || "-";

export async function buildOrderPdf(order: SalesOrder, logoBytes?: Uint8Array) {
  const resolvedLogo = logoBytes || new Uint8Array(await (await fetch("/briland-logo.png")).arrayBuffer());
  return buildCommercialOrderPdf(order, resolvedLogo, { PDFDocument, StandardFonts, rgb });
}

export async function orderPdfFile(order: SalesOrder, logoUrl = "/briland-logo.png") {
  const logoResponse = await fetch(logoUrl);
  if (!logoResponse.ok) throw new Error("Não foi possível carregar a logo da Briland.");
  const bytes = await buildOrderPdf(order, new Uint8Array(await logoResponse.arrayBuffer()));
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  return new File([blob], `pedido-${String(order.orderNumber).padStart(6, "0")}.pdf`, { type: "application/pdf" });
}

export async function stockPdfFile(rows: SalesStock[]) {
  const pdf=await PDFDocument.create(); const regular=await pdf.embedFont(StandardFonts.Helvetica); const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page=pdf.addPage([PAGE.width,PAGE.height]); let y=PAGE.height-65; let pageNumber=1;
  const head=()=>{page.drawRectangle({x:0,y:PAGE.height-52,width:PAGE.width,height:52,color:navy});page.drawText("BRILAND  |  SALDO DISPONIVEL",{x:35,y:PAGE.height-33,size:16,font:bold,color:rgb(1,1,1)});page.drawText(`Pagina ${pageNumber}`,{x:510,y:PAGE.height-31,size:7,font:regular,color:rgb(.8,.84,.9)});y=PAGE.height-75;page.drawRectangle({x:35,y:y-20,width:525,height:23,color:yellow});[["CODIGO",42],["PRODUTO",125],["SALDO DISPONIVEL",470]].forEach(([v,x])=>page.drawText(String(v),{x:Number(x),y:y-13,size:7,font:bold,color:navy}));y-=27;};head();
  rows.forEach((row,index)=>{if(y<50){pageNumber++;page=pdf.addPage([PAGE.width,PAGE.height]);head();}page.drawRectangle({x:35,y:y-18,width:525,height:21,color:index%2?soft:rgb(1,1,1)});page.drawText(text(row.productCode),{x:42,y:y-10,size:7,font:bold,color:ink});page.drawText(text(row.productName).slice(0,70),{x:125,y:y-10,size:7,font:regular,color:ink});page.drawText(String(row.availableBalance),{x:520,y:y-10,size:7,font:bold,color:row.availableBalance<=0?rgb(.75,.1,.1):ink});y-=21;});
  const bytes=await pdf.save();return new File([new Blob([bytes as BlobPart],{type:"application/pdf"})],`saldo-disponivel-briland-${new Date().toISOString().slice(0,10)}.pdf`,{type:"application/pdf"});
}
