type PdfRuntime = {
  PDFDocument: { create: () => Promise<any> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb: (red: number, green: number, blue: number) => any;
};

type OrderItem = {
  productCode: string;
  productName: string;
  quantity: number;
  listPrice: number;
  manualDiscountPercent: number;
  paymentDiscountPercent: number;
  unitPrice: number;
  lineTotal: number;
};

export type CommercialOrder = {
  orderNumber: number;
  status: string;
  freightType?: string | null;
  redispatchName?: string | null;
  redispatchPhone?: string | null;
  paymentType?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  subtotal: number;
  discount: number;
  total: number;
  clientSnapshot: Record<string, any>;
  representativeSnapshot: Record<string, any>;
  createdAt: string;
  submittedAt?: string | null;
  items?: OrderItem[];
};

const PAGE = { width: 595.28, height: 841.89 };

export async function buildCommercialOrderPdf(order: CommercialOrder, logoBytes: Uint8Array, runtime: PdfRuntime) {
  const { PDFDocument, StandardFonts, rgb } = runtime;
  const navy = rgb(0.008, 0.067, 0.149);
  const yellow = rgb(0.988, 0.727, 0);
  const ink = rgb(0.08, 0.1, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.87, 0.89, 0.92);
  const soft = rgb(0.96, 0.97, 0.98);
  const text = (value: unknown) => String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
  const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "-";
  const wrap = (value: string, font: any, size: number, max: number) => {
    const words = text(value).split(" "); const rows: string[] = []; let row = "";
    for (const word of words) { const next = row ? `${row} ${word}` : word; if (font.widthOfTextAtSize(next, size) > max && row) { rows.push(row); row = word; } else row = next; }
    if (row) rows.push(row); return rows;
  };
  const header = (page: any, logo: any, bold: any, regular: any, pageNumber: number) => {
    page.drawRectangle({ x: 0, y: PAGE.height - 98, width: PAGE.width, height: 98, color: navy });
    page.drawRectangle({ x: 0, y: PAGE.height - 103, width: PAGE.width, height: 5, color: yellow });
    page.drawImage(logo, { x: 27, y: PAGE.height - 100, width: 220, height: 100 });
    page.drawText("PEDIDO COMERCIAL", { x: 38, y: PAGE.height - 78, size: 9, font: regular, color: yellow });
    page.drawText(`PEDIDO ${String(order.orderNumber).padStart(6,"0")}`, { x: 390, y: PAGE.height - 52, size: 13, font: bold, color: rgb(1,1,1) });
    page.drawText(`Pagina ${pageNumber}`, { x: 478, y: PAGE.height - 76, size: 8, font: regular, color: rgb(.75,.8,.88) });
  };
  const footer = (page: any, regular: any) => {
    page.drawLine({ start:{x:38,y:34}, end:{x:557,y:34}, thickness:.7, color:line });
    page.drawText("Documento comercial gerado pelo sistema Briland", { x:38,y:19,size:7.5,font:regular,color:muted });
  };
  const field = (page: any, bold: any, regular: any, label: string, value: unknown, x: number, y: number, width: number) => {
    page.drawText(label.toUpperCase(), { x, y, size:7, font:bold, color:muted });
    wrap(text(value),regular,9,width).slice(0,2).forEach((row,index)=>page.drawText(row,{x,y:y-14-index*11,size:9,font:regular,color:ink}));
  };

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(logoBytes);
  const items = order.items || [];
  let page = pdf.addPage([PAGE.width,PAGE.height]);
  let y=PAGE.height-132;
  const client=order.clientSnapshot||{}; const representative=order.representativeSnapshot||{};
  page.drawText("DADOS DO PEDIDO",{x:38,y,size:10,font:bold,color:navy}); y-=20;
  page.drawRectangle({x:38,y:y-98,width:519,height:102,color:soft,borderColor:line,borderWidth:.6});
  field(page,bold,regular,"Cliente",client.company||client.name,50,y-15,230); field(page,bold,regular,"CNPJ",client.cnpj,300,y-15,120); field(page,bold,regular,"Inscricao estadual",client.stateRegistration,430,y-15,110);
  field(page,bold,regular,"Responsavel",client.name,50,y-48,230); field(page,bold,regular,"Representante",representative.name,300,y-48,240);
  field(page,bold,regular,"Endereco",`${text(client.address)}, ${text(client.neighborhood)} - ${text(client.city)}/${text(client.state)} - CEP ${text(client.zipCode)}`,50,y-81,490); y-=122;
  page.drawRectangle({x:38,y:y-52,width:519,height:56,borderColor:line,borderWidth:.6});
  field(page,bold,regular,"Frete",order.freightType,50,y-13,70); field(page,bold,regular,"Redespacho",order.redispatchName,130,y-13,160); field(page,bold,regular,"Telefone",order.redispatchPhone,305,y-13,100); field(page,bold,regular,"Pagamento",order.paymentType==="UPFRONT"?"A vista antecipado (+5% apos desconto comercial)":`Parcelado - ${text(order.paymentTerms)}`,420,y-13,125); y-=80;
  const drawTableHeader=()=>{page.drawRectangle({x:38,y:y-22,width:519,height:25,color:navy});[["CODIGO",44],["PRODUTO",105],["QTD",312],["TABELA",350],["DESC.",414],["UNITARIO",458],["TOTAL",516]].forEach(([label,x])=>page.drawText(String(label),{x:Number(x),y:y-14,size:7,font:bold,color:rgb(1,1,1)}));y-=29;};
  drawTableHeader();
  for(const item of items){
    if(y<92){page=pdf.addPage([PAGE.width,PAGE.height]);y=PAGE.height-132;drawTableHeader();}
    const name=wrap(item.productName,regular,8,195).slice(0,2); const rowHeight=Math.max(29,name.length*10+11);
    page.drawLine({start:{x:38,y:y-rowHeight+5},end:{x:557,y:y-rowHeight+5},thickness:.45,color:line});
    page.drawText(text(item.productCode),{x:44,y:y-10,size:7.5,font:bold,color:ink}); name.forEach((row,i)=>page.drawText(row,{x:105,y:y-9-i*10,size:8,font:regular,color:ink}));
    page.drawText(String(item.quantity),{x:320,y:y-10,size:8,font:regular,color:ink}); page.drawText(money(item.listPrice),{x:350,y:y-10,size:7.5,font:regular,color:ink});
    const discountLabel=item.paymentDiscountPercent>0?`${item.manualDiscountPercent}% + ${item.paymentDiscountPercent}%`:`${item.manualDiscountPercent}%`;
    page.drawText(discountLabel,{x:410,y:y-10,size:7.2,font:regular,color:ink}); page.drawText(money(item.unitPrice),{x:458,y:y-10,size:7.5,font:regular,color:ink}); page.drawText(money(item.lineTotal),{x:514,y:y-10,size:7.5,font:bold,color:ink}); y-=rowHeight;
  }
  if(y<185){page=pdf.addPage([PAGE.width,PAGE.height]);y=PAGE.height-140;}
  y-=12; page.drawRectangle({x:332,y:y-86,width:225,height:90,color:soft,borderColor:line,borderWidth:.7});
  [["Subtotal",money(order.subtotal)],["Descontos",`- ${money(order.discount)}`],["TOTAL",money(order.total)]].forEach(([label,value],i)=>{const yy=y-20-i*27;page.drawText(label,{x:346,y:yy,size:i===2?10:8,font:i===2?bold:regular,color:i===2?navy:muted});page.drawText(value,{x:472,y:yy,size:i===2?12:9,font:bold,color:i===2?navy:ink});});
  field(page,bold,regular,"Observacoes",order.notes,38,y-12,270); y-=110;
  page.drawText(`Status: ${order.status}  |  Criado em: ${date(order.createdAt)}  |  Enviado em: ${date(order.submittedAt)}`,{x:38,y,size:7.5,font:regular,color:muted});
  pdf.getPages().forEach((entry:any,index:number)=>{header(entry,logo,bold,regular,index+1);footer(entry,regular);});
  return pdf.save();
}
