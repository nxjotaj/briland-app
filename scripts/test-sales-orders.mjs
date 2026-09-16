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
  await client.query(`insert into public."User"(id,name,company,email,"passwordHash",role,status,phone,cnpj,address,"zipCode",neighborhood,city,state,"representanteId","updatedAt") values($1,'Cliente Teste','Empresa Teste',$2,'FIRST_ACCESS_PENDING','CLIENTE','ACTIVE','11999999999','00000000000191','Rua Teste','00000000','Centro','Teste','SP',$3,now())`, [clientId, `${clientId}@example.invalid`, representative.id]);
  await client.query(`insert into public."SalesOrder"(id,"orderNumber","representativeId","representativeSnapshot") values('test_order_tx',-999,$1,'{}')`, [representative.id]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(representative.authUserId)]);
  const saved = (await client.query(`select * from public.save_sales_order('test_order_tx',$1::text,'CIF',null,null,'UPFRONT',null,'Teste',jsonb_build_array(jsonb_build_object('productId',$2::text,'quantity',1,'manualDiscountPercent',15)),true)`, [clientId, product.id])).rows[0];
  ensure(saved.status === "SUBMITTED", "Envio não mudou o status.");
  const item = (await client.query(`select * from public."SalesOrderItem" where "orderId"='test_order_tx'`)).rows[0];
  ensure(Number(item.effectiveDiscountPercent) === 20, "Desconto adicional à vista incorreto.");
  const reservation = (await client.query(`select * from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(reservation.status === "ACTIVE" && reservation.quantity === 1, "Reserva de estoque não criada.");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [String(admin.authUserId)]);
  const approved = (await client.query(`select * from public.transition_sales_order('test_order_tx','APPROVE','Teste transacional')`)).rows[0];
  ensure(approved.status === "APPROVED", "Aprovação não mudou o status.");
  const consumed = (await client.query(`select status from public."StockReservation" where "orderId"='test_order_tx'`)).rows[0];
  ensure(consumed.status === "CONSUMED", "Reserva não foi consumida.");
  await client.query("rollback");
  console.log("Testes transacionais de pedido aprovados; dados de teste revertidos.");
} catch (error) {
  await client.query("rollback");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
