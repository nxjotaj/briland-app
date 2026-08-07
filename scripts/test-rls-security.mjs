import pg from "pg";
const {Client}=pg;
const connectionString=process.env.SUPABASE_DATABASE_URL;
if(!connectionString)throw new Error("SUPABASE_DATABASE_URL não configurada.");
const client=new Client({connectionString,ssl:{rejectUnauthorized:false}});
const results=[];
const assert=(condition,label,details)=>{results.push({label,ok:Boolean(condition),details});if(!condition)throw new Error(`${label}: ${details}`);};
async function assume(role,authUserId){await client.query("reset role");await client.query("select set_config('request.jwt.claim.sub',$1,false)",[authUserId||""]);await client.query(`set role ${role}`);}
async function count(sql){return Number((await client.query(sql)).rows[0].count);}
async function verifyCatalogRole(roleName,id){
  await assume("authenticated",id);
  assert(await count(`select count(*) from public."User"`)==1,`${roleName} lê somente o próprio usuário`,`esperado 1`);
  assert(await count(`select count(*) from public."ProductFieldPermission"`)==0,`${roleName} não lê matriz administrativa`,`esperado 0`);
  assert(await count(`select count(*) from public."Produto"`)==0,`${roleName} não lê produto bruto`,`esperado 0`);
  assert(await count(`select count(*) from public.get_visible_products(null)`)>0,`${roleName} recebe catálogo filtrado`,`RPC sem produtos`);
}
try{
  await client.connect();
  const identities=(await client.query(`select distinct on (role) role::text role,"authUserId" auth_id from public."User" where status::text='ACTIVE' and "authUserId" is not null order by role`)).rows;
  const byRole=new Map(identities.map(row=>[row.role,row.auth_id]));
  await assume("anon",null);
  assert(await count(`select count(*) from public."User"`)==0,"Visitante não lê usuários","esperado 0");
  assert(await count(`select count(*) from public."ProductFieldPermission"`)==0,"Visitante não lê matriz de permissões","esperado 0");
  assert(await count(`select count(*) from public."Produto"`)==0,"Visitante não contorna campos pelo produto bruto","esperado 0");
  assert(await count(`select count(*) from public.get_visible_products(null)`)>0,"Visitante acessa somente produtos filtrados","RPC sem produtos");
  const donor=byRole.get("REPRESENTANTE")||byRole.get("CLIENTE")||byRole.get("NAO_CLIENTE");
  if(!donor)throw new Error("Usuário comercial ativo não encontrado para os testes.");
  for(const roleName of ["NAO_CLIENTE","CLIENTE","REPRESENTANTE"]){
    const id=byRole.get(roleName);
    if(id){await verifyCatalogRole(roleName,id);continue;}
    await client.query("reset role");await client.query("begin");
    try{await client.query(`update public."User" set role=$1::public."UserRole" where "authUserId"=$2`,[roleName,donor]);await verifyCatalogRole(roleName,donor);await client.query("reset role");await client.query("rollback");}
    catch(error){await client.query("reset role");await client.query("rollback");throw error;}
  }
  const master=byRole.get("ADMIN_MASTER")||byRole.get("ADMIN");if(!master)throw new Error("Admin Master ativo não encontrado.");
  const collaborator=byRole.get("ADMIN_COLABORADOR");
  if(collaborator){await assume("authenticated",collaborator);}else{await client.query("reset role");await client.query("begin");await client.query(`update public."User" set role='ADMIN_COLABORADOR'::public."UserRole" where "authUserId"=$1`,[master]);await assume("authenticated",master);}
  assert(await count(`select count(*) from public."User"`)==1,"Administrador colaborador lê somente o próprio usuário","esperado 1");
  assert(await count(`select count(*) from public."ProductFieldPermission"`)==0,"Administrador colaborador não lê matriz master","esperado 0");
  assert(await count(`select count(*) from public."Produto"`)>0,"Administrador colaborador gerencia produtos","catálogo administrativo vazio");
  assert(await count(`select count(*) from public."AuditLog"`)==0,"Administrador colaborador não lê auditoria master","esperado 0");
  if(!collaborator){await client.query("reset role");await client.query("rollback");}
  await assume("authenticated",master);
  assert(await count(`select count(*) from public."User"`)>0,"Admin Master lê usuários","lista vazia");
  assert(await count(`select count(*) from public.get_admin_product_permissions()`)==28,"Admin Master lê as 28 permissões","contagem divergente");
  assert(await count(`select count(*) from public."AuditLog"`)>=0,"Admin Master acessa auditoria","acesso negado");
  await client.query("reset role");
  console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,total:results.length,results},null,2));
}finally{await client.end();}
