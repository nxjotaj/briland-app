import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4317;
const defaultSupabaseUrl = "https://jdxbxsufqjiinkfvvbda.supabase.co";
const nonce = randomBytes(24).toString("hex");
const workerEntry = fileURLToPath(new URL("../src/index.mjs", import.meta.url));
const workerDirectory = fileURLToPath(new URL("..", import.meta.url));

function isServiceRoleJwt(value) {
  try {
    const [, payload] = value.split(".");
    if (!payload) return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.role === "service_role";
  } catch {
    return false;
  }
}

const page = (message = "") => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ativar worker Briland</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#061a38;color:#fff;font-family:Arial,sans-serif}.card{width:min(520px,calc(100% - 40px));padding:34px;border-radius:28px;background:#fff;color:#061a38;box-shadow:0 30px 80px #0006}h1{margin:0 0 10px}p{color:#5d6b7e;line-height:1.5}input{box-sizing:border-box;width:100%;padding:15px;border:1px solid #ccd4df;border-radius:12px}button{margin-top:16px;padding:14px 22px;border:0;border-radius:999px;background:#ffd300;color:#061a38;font-weight:900}.message{color:#b42318;font-weight:700}</style></head><body><form class="card" method="post" action="/${nonce}"><h1>Ativar renderizador</h1><p>Cole a chave <strong>service_role</strong>. Ela será validada em memória, enviada somente para este computador e não será salva em arquivo.</p>${message ? `<p class="message">${message}</p>` : ""}<input type="password" name="secret" required autocomplete="off" aria-label="Chave service role"><button type="submit">Iniciar worker</button></form></body></html>`;

const server = createServer((request, response) => {
  if (request.url !== `/${nonce}`) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page());
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405).end("Method not allowed");
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10000) request.destroy();
  });
  request.on("end", () => {
    const secret = new URLSearchParams(body).get("secret")?.trim() || "";
    if (!isServiceRoleJwt(secret)) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(page("A chave informada não possui o papel service_role."));
      return;
    }
    const child = spawn(process.execPath, [workerEntry], {
      cwd: workerDirectory,
      env: { ...process.env, SUPABASE_URL: process.env.SUPABASE_URL || defaultSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY: secret },
      stdio: "inherit"
    });
    child.on("exit", (code) => process.exitCode = code ?? 1);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end("<!doctype html><html><body style='font-family:Arial;padding:40px'><h1>Worker iniciado</h1><p>Você já pode fechar esta aba e gerar um vídeo no Estúdio Briland.</p></body></html>");
    server.close();
  });
});

server.listen(port, host, () => console.log(`Bootstrap local pronto: http://${host}:${port}/${nonce}`));
