const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const money = (value) => value == null || !Number.isFinite(Number(value))
  ? "Consulte"
  : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export function renderComposition(job, imageFileName, logoFileName = null, sceneVideoFileName = null) {
  const vertical = job.format === "vertical";
  const width = 1080;
  const height = vertical ? 1920 : 1080;
  const duration = job.durationSeconds;
  const product = job.inputPayload?.product || {};
  const offer = job.templateKey === "commercial-offer";
  const arrival = job.templateKey === "new-arrival";
  const eyebrow = arrival ? "NOVIDADE BRILAND" : offer ? "OFERTA COMERCIAL" : "DESTAQUE BRILAND";
  const image = imageFileName
    ? `<img class="product-image" src="./${escapeHtml(imageFileName)}" alt="${escapeHtml(product.name)}">`
    : `<div class="image-placeholder">IMAGEM<br>INDISPONÍVEL</div>`;
  const brand = logoFileName
    ? `<img class="brand-logo" src="./${escapeHtml(logoFileName)}" alt="Briland">`
    : `<span>BRILAND</span>`;
  const scene = sceneVideoFileName ? `<video id="ai-generated-scene" class="ai-scene clip" src="./${escapeHtml(sceneVideoFileName)}" muted loop playsinline data-start="0" data-duration="${duration}" data-track-index="0"></video>` : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#061a38;font-family:Arial,Helvetica,sans-serif}
    #stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;color:#fff;background:linear-gradient(145deg,#061a38 0%,#0a3971 54%,#1372c4 100%)}
    #stage:before{content:"";position:absolute;width:900px;height:900px;right:-280px;top:-330px;border-radius:50%;background:radial-gradient(circle,rgba(255,211,0,.62),rgba(255,211,0,0) 68%)}
    #stage:after{content:"";position:absolute;width:700px;height:700px;left:-420px;bottom:-260px;border:1px solid rgba(255,255,255,.18);border-radius:50%}
    .ai-scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38;filter:saturate(.9) contrast(1.08)}
    .ai-scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,26,56,.82),rgba(6,26,56,.30));display:${sceneVideoFileName ? "block" : "none"}}
    .brand{position:absolute;z-index:2;top:${vertical ? 70 : 42}px;left:${vertical ? 76 : 68}px;width:${vertical ? 300 : 230}px;height:${vertical ? 92 : 70}px;display:flex;align-items:center;font-size:${vertical ? 34 : 25}px;font-weight:900;letter-spacing:.19em}.brand-logo{display:block;max-width:100%;max-height:100%;object-fit:contain;filter:brightness(0) invert(1)}
    .eyebrow{position:absolute;z-index:2;top:${vertical ? 170 : 118}px;left:${vertical ? 76 : 68}px;padding:14px 22px;border-radius:999px;background:rgba(255,255,255,.12);font-size:${vertical ? 24 : 18}px;font-weight:900;letter-spacing:.13em;color:#ffd300}
    .media{position:absolute;z-index:2;left:${vertical ? 76 : 68}px;right:${vertical ? 76 : 580}px;top:${vertical ? 290 : 215}px;height:${vertical ? 820 : 650}px;border-radius:48px;background:#fff;display:flex;align-items:center;justify-content:center;padding:58px;box-shadow:0 36px 80px rgba(0,0,0,.28);overflow:hidden}
    .product-image{width:100%;height:100%;object-fit:contain}.image-placeholder{text-align:center;color:#8b98a9;font-size:34px;font-weight:900;line-height:1.25}
    .copy{position:absolute;z-index:2;left:${vertical ? 76 : 570}px;right:${vertical ? 76 : 68}px;top:${vertical ? 1190 : 210}px;bottom:${vertical ? 110 : 90}px;display:flex;flex-direction:column;justify-content:center}
    h1{margin:0;font-size:${vertical ? 84 : 54}px;line-height:.98;letter-spacing:-.04em;font-weight:900;overflow-wrap:anywhere}p{margin:30px 0 0;color:rgba(255,255,255,.72);font-size:${vertical ? 34 : 23}px;line-height:1.35;font-weight:600;overflow-wrap:anywhere}
    .price{margin-top:36px;font-size:${vertical ? 68 : 48}px;color:#ffd300;font-weight:900}.code{margin-top:22px;font-size:${vertical ? 25 : 18}px;color:rgba(255,255,255,.55);font-weight:700}
    .cta{align-self:flex-start;margin-top:42px;padding:${vertical ? "24px 36px" : "18px 27px"};border-radius:999px;background:#ffd300;color:#061a38;font-size:${vertical ? 28 : 20}px;font-weight:900}
    .brand,.eyebrow,.media,.copy{animation-fill-mode:both;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
    .brand{animation:fade-down 1s}.eyebrow{animation:fade-down 1s .15s}.media{animation:media-in 1.2s .25s}.copy{animation:copy-in 1.1s .45s}
    @keyframes fade-down{from{opacity:0;transform:translateY(-35px)}to{opacity:1;transform:none}}
    @keyframes media-in{from{opacity:0;transform:scale(.88) rotate(-2deg)}to{opacity:1;transform:none}}
    @keyframes copy-in{from{opacity:0;transform:translateY(55px)}to{opacity:1;transform:none}}
  </style>
</head>
<body>
  <main id="stage" data-composition-id="briland-product" data-no-timeline data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
    ${scene}<div class="ai-scrim"></div>
    <div id="briland-brand" class="brand clip" data-start="0" data-duration="${duration}" data-track-index="1">${brand}</div>
    <div id="video-eyebrow" class="eyebrow clip" data-start="0" data-duration="${duration}" data-track-index="2">${eyebrow}</div>
    <div id="product-media" class="media clip" data-start="0" data-duration="${duration}" data-track-index="3">${image}</div>
    <section id="product-copy" class="copy clip" data-start="0" data-duration="${duration}" data-track-index="4">
      ${job.headline ? `<h1>${escapeHtml(job.headline)}</h1>` : ""}
      ${job.subheadline ? `<p>${escapeHtml(job.subheadline)}</p>` : ""}
      ${offer ? `<div class="price">${escapeHtml(money(product.price))}</div>` : ""}
      ${product.code ? `<div class="code">CÓDIGO ${escapeHtml(product.code)}</div>` : ""}
      ${job.cta ? `<div class="cta">${escapeHtml(job.cta)}</div>` : ""}
    </section>
  </main>
</body>
</html>`;
}
