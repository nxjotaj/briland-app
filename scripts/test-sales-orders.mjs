import pg from "pg";

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL não configurada.");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const ensure = (value, message) => { if (!value) throw new Error(message); };

await client.connect();
try {
  await client.query("begin");
  const representative = (await client.query(`select * from public."User" where role='REPRESENTANTE' and status='ACTIVE' and "authUserId" is not null limit 1`)).rows[0];
  const admin = (await client.query(`select * from public."User" where role in ('ADMIN','ADMIN_MASTER') and status='ACTIVE' and "authUserId" is not null limit 1`)).rows[0];
  let product = (await client.query(`select * from public."Produto" where ativo=true and preco is not null and coalesce(estoque,0)>=2 limit 1`)).rows[0];
  ensure(representative, "Não existe representante ativo com credencial para o teste.");
  ensure(admin, "Não existe administrador master ativo com credencial para o teste.");
  for (const account of [admin, representative]) {
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(account.authUserId)]);
    await client.query("set local role authenticated");
    const visibleSelf = (await client.query(`select id from public."User" where "authUserId"=auth.uid()`)).rows;
    ensure(visibleSelf.length === 1, `A política de usuários bloqueou o perfil ${account.role}.`);
    await client.query("reset role");
  }
  if (!product) {
    const productId = `test_product_${Date.now()}`;
    const category = (await client.query(`select id from public."Categoria" where ativo=true limit 1`)).rows[0];
    const brand = (await client.query(`select id from public."Marca" where ativo=true limit 1`)).rows[0];
    ensure(category, "Não existe categoria ativa para criar o produto transacional de teste.");
    ensure(brand, "Não existe marca ativa para criar o produto transacional de teste.");
    product = (await client.query(`insert into public."Produto"(id,nome,"codigoInterno","categoriaId","marcaId",preco,estoque,ativo,destaque,ordem,"updatedAt") values($1,'Produto transacional de teste',$2,$3,$4,100,10,true,false,999999,now()) returning *`, [productId, productId, category.id, brand.id])).rows[0];
  }
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(representative.authUserId)]);
  await client.query("set local role authenticated");
  const representativeStock = (await client.query(`select * from public.get_sales_stock() where "productId"=$1`, [product.id])).rows[0];
  ensure(representativeStock && representativeStock.reservedBalance === 0 && representativeStock.physicalBalance === representativeStock.availableBalance, "A resposta de saldo revelou dados privados ao representante.");
  await client.query("reset role");
  const clientId = `test_client_${Date.now()}`;
  await client.query(`insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,"stateRegistration",address,"zipCode",neighborhood,city,state,"representanteId","updatedAt") values($1,'Cliente Teste','Empresa Teste',$2,'FIRST_ACCESS_PENDING','CLIENTE','ACTIVE','11999999999','00000000000191','110042490114','Rua Teste','00000000','Centro','Teste','SP',$3,now())`, [clientId, `${clientId}@example.invalid`, representative.id]);
  await client.query(`insert into public."SalesOrder"(id,"orderNumber","representativeId","representativeSnapshot") values('test_order_tx',-999,$1,'{}')`, [representative.id]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(representative.authUserId)]);
  const saved = (await client.query(`select * from public.save_sales_order('test_order_tx',$1::text,'CIF',null,null,'UPFRONT',null,'Teste',jsonb_build_array(jsonb_build_object('productId',$2::text,'quantity',2,'manualDiscountPercent',15)),true)`, [clientId, product.id])).rows[0];
  ensure(saved.status === "SUBMITTED", "Envio não mudou o status.");
  const item = (await client.query(`select * from public."SalesOrderItem" where "orderId"='test_order_tx'`)).rows[0];
  ensure(Number(item.effectiveDiscountPercent) === 19.25, "Desconto adicional à vista não foi aplicado sequencialmente.");
  const expectedUnitPrice = Math.round(Number(product.preco) * 0.85 * 0.95 * 100) / 100;
  ensure(Number(item.unitPrice) === expectedUnitPrice, "Preço unitário com desconto sequencial incorreto.");
  ensure(saved.notes === "Teste", "Observação do pedido não foi salva.");
  ensure(saved.clientSnapshot.stateRegistration === "110042490114", "Inscrição estadual ausente do snapshot do pedido.");
  const reservation = (await client.query(`select * from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(reservation.status === "ACTIVE" && reservation.quantity === 2, "Reserva de estoque não criada.");
  const balanceBeforeApproval = Number((await client.query(`select estoque from public."Produto" where id=$1`, [product.id])).rows[0].estoque);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(admin.authUserId)]);
  const approved = (await client.query(`select * from public.transition_sales_order('test_order_tx','APPROVE','Teste transacional')`)).rows[0];
  ensure(approved.status === "APPROVED", "Aprovação não mudou o status.");
  const maintained = (await client.query(`select status from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(maintained.status === "ACTIVE", "A aprovação não manteve a reserva até o faturamento.");
  const balanceAfterApproval = Number((await client.query(`select estoque from public."Produto" where id=$1`, [product.id])).rows[0].estoque);
  ensure(balanceAfterApproval === balanceBeforeApproval, "A aprovação baixou o estoque antes do XML fiscal.");
  const match = (await client.query(`select public.match_sales_order_for_invoice($1,$2,jsonb_build_array(jsonb_build_object('productCode',$3::text,'quantity',1))) result`, ['00000000000191','110042490114',product.codigoInterno])).rows[0].result;
  ensure(match?.orderId === 'test_order_tx' && match?.comparison?.exact === false && match?.comparison?.differences?.length === 1, "A conciliação não sinalizou a divergência de quantidade.");
  const accessKey = '35260900000000000191550010000000021000000001';
  await client.query(`select public.apply_fiscal_stock_batch('SAIDA','Teste de faturamento',jsonb_build_array(jsonb_build_object('accessKey',$1::text,'number','2','series','1','issuedAt',now()::text,'issuer',jsonb_build_object('cnpj','11111111000111','name','Briland'),'recipient',jsonb_build_object('cnpj','00000000000191','ie','110042490114','name','Empresa Teste'),'purpose','1','operationNature','VENDA','cfops',jsonb_build_array('5102'),'nature','VENDA','authorized',true,'salesOrderId','test_order_tx','items',jsonb_build_array(jsonb_build_object('lineNumber',1,'productCode',$2::text,'description','Produto teste','quantity',1,'cfop','5102')))))`, [accessKey, product.codigoInterno]);
  const invoiced = (await client.query(`select * from public."SalesOrder" where id='test_order_tx'`)).rows[0];
  ensure(invoiced.status === 'PARTIALLY_INVOICED' && invoiced.fiscalDocumentId, "O XML não marcou o pedido como faturado parcialmente.");
  const residual = (await client.query(`select status,quantity from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(residual.status === "ACTIVE" && residual.quantity === 1, "A quantidade não faturada não permaneceu reservada.");
  const balanceAfterInvoice = Number((await client.query(`select estoque from public."Produto" where id=$1`, [product.id])).rows[0].estoque);
  ensure(balanceAfterInvoice === balanceBeforeApproval - 1, "O faturamento não baixou exatamente a quantidade da NF-e.");
  const invoiceHistory = (await client.query(`select metadata from public."SalesOrderHistory" where "orderId"='test_order_tx' and action='INVOICED' order by "createdAt" desc limit 1`)).rows[0];
  ensure(invoiceHistory?.metadata?.comparison?.exact === false, "A divergência não foi registrada no histórico do pedido.");
  const review = (await client.query(`select * from public."StockReservationReview" where "orderId"='test_order_tx'`)).rows[0];
  ensure(review?.status === 'PENDING' && review.remainingQuantity === 1, "A pendência administrativa da reserva residual não foi criada.");
  await client.query(`select public.resolve_stock_reservation_review($1,'RELEASE','Teste de liberação')`, [review.id]);
  const released = (await client.query(`select status from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(released.status === 'RELEASED', "A ação administrativa não liberou a reserva residual.");
  await client.query("rollback");
  console.log("Testes transacionais de pedido aprovados; dados de teste revertidos.");
} catch (error) {
  await client.query("rollback");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
