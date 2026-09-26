#!/usr/bin/env node
// Regenera las imágenes del portafolio a partir del sitio de DORN AGRO (o de cualquier versión nueva de la demo):
//   public/portafolio/dorn-agro-{portada,panel,movil}.jpg   → proyecto destacado de las tiendas
//   portafolio/fiverr/{1,2,3}-*.jpg (1280x769)               → galería de los gigs de Fiverr
//
// Uso:
//   1) Sirve el sitio:  cd ../dorn-agro && python3 -m http.server 8765
//   2) npm run portafolio -- --sitio http://127.0.0.1:8765/
//      (también sirve la URL publicada, p. ej. --sitio https://joakovrd-designer.github.io/dorn-agro/)
//
// Navegador: usa CHROME_PATH si está definido; si no, el Google Chrome instalado (channel "chrome").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const SITIO = arg("sitio", "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const FRAME = arg("fotograma", "assets/frames/frame_048.webp"); // fondo limpio (sin textos) para la imagen 1
const WEB = path.join(ROOT, "public", "portafolio");
const FIVERR = path.join(ROOT, "portafolio", "fiverr");
fs.mkdirSync(WEB, { recursive: true });
fs.mkdirSync(FIVERR, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
  // En entornos con proxy (p. ej. la nube de Claude Code) las fuentes de Google pasan por él.
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}),
});
const newContext = (viewport, mobile) =>
  browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, ignoreHTTPSErrors: Boolean(process.env.HTTPS_PROXY) }).then(async (ctx) => {
    // La demo muestra el panel con el simulador ESP32 integrado (sin depender del broker MQTT).
    await ctx.addInitScript(() => localStorage.setItem("dornagro:ajustes", JSON.stringify({ transporte: "local", simIntegrado: true })));
    return ctx;
  });
const shots = {};

async function heroShots(name, viewport, mobile, fractions) {
  const ctx = await newContext(viewport, mobile);
  const p = await ctx.newPage();
  await p.goto(SITIO, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(2500);
  const height = await p.evaluate(() => document.getElementById("hero").offsetHeight - innerHeight);
  for (const f of fractions) {
    await p.evaluate((y) => scrollTo(0, y), Math.round(height * f));
    await p.waitForTimeout(1300);
    shots[`${name}-${Math.round(f * 100)}`] = await p.screenshot({ type: "jpeg", quality: 88 });
  }
  await ctx.close();
}

async function panelShot(name, viewport, mobile) {
  const ctx = await newContext(viewport, mobile);
  const p = await ctx.newPage();
  await p.goto(`${SITIO}app.html`, { waitUntil: "networkidle" });
  await p.getByText("Probar sin cuenta (demo)").click();
  await p.waitForTimeout(6000);
  await p.getByRole("button", { name: "Encender" }).first().click().catch(() => {});
  await p.waitForTimeout(3000);
  const online = await p.evaluate(() => document.body.innerText.includes("En línea"));
  if (!online) console.warn(`⚠ ${name}: el panel no muestra "En línea"; revisa la demo antes de usar esta captura.`);
  shots[name] = await p.screenshot({ type: "jpeg", quality: 88 });
  await ctx.close();
}

await heroShots("hero-desk", { width: 1440, height: 900 }, false, [0]);
await heroShots("hero-mov", { width: 390, height: 844 }, true, [0, 0.5]);
await panelShot("panel-desk", { width: 1440, height: 900 }, false);
await panelShot("panel-mov", { width: 390, height: 844 }, true);

// ---- Composición: se hace sobre la portada del propio sitio para usar sus fuentes (Sora y Manrope) ya cargadas.
const img = (key) => `data:image/jpeg;base64,${shots[key].toString("base64")}`;
const CSS = `*{margin:0;box-sizing:border-box}html,body{background:#0a0b0a!important;overflow:hidden}body{font-family:Manrope,sans-serif;color:#eef1ea}
.phone{border-radius:34px;padding:10px;background:#111;box-shadow:0 30px 70px #000c,0 0 0 2px #ffffff22}.phone img{border-radius:26px;display:block}
.laptop{border-radius:14px;overflow:hidden;box-shadow:0 30px 80px #000c,0 0 0 1px #ffffff22}.laptop .bar{height:26px;background:#1b1d1b;display:flex;gap:7px;align-items:center;padding:0 12px}.laptop .bar i{width:10px;height:10px;border-radius:50%;background:#3a3d3a}
h1{font-family:Sora,sans-serif;font-weight:700;line-height:1.05;letter-spacing:-.02em}.tag{color:#8fc86f;font-weight:600;letter-spacing:.18em;text-transform:uppercase;font-size:15px}
.chips{display:flex;gap:10px;flex-wrap:wrap}.chips span{border:1px solid #ffffff2e;border-radius:999px;padding:8px 14px;font-size:15px;color:#d7dcd3}`;

const ctx = await browser.newContext({ deviceScaleFactor: 1, ignoreHTTPSErrors: Boolean(process.env.HTTPS_PROXY) });
const page = await ctx.newPage();
await page.goto(SITIO, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

async function render(markup, width, height, file, quality = 86) {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ markup, css }) => {
    document.querySelectorAll('link[rel="stylesheet"]:not([href*="fonts.googleapis"]), style').forEach((n) => n.remove());
    document.body.className = "";
    document.body.innerHTML = `<style>${css}</style>${markup}`;
    scrollTo(0, 0);
  }, { markup, css: CSS });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  const fonts = await page.evaluate(() => document.fonts.check("700 40px Sora") && document.fonts.check("500 20px Manrope"));
  if (!fonts) console.warn(`⚠ ${path.basename(file)}: las fuentes Sora/Manrope no cargaron; se usará una alternativa.`);
  fs.writeFileSync(file, await page.screenshot({ type: "jpeg", quality }));
  console.log(`✔ ${path.relative(ROOT, file)}`);
}

await render(`<img src="${img("hero-desk-0")}" style="width:1440px;display:block">`, 1440, 900, path.join(WEB, "dorn-agro-portada.jpg"), 80);
await render(`<img src="${img("panel-desk")}" style="width:1440px;display:block">`, 1440, 900, path.join(WEB, "dorn-agro-panel.jpg"), 80);
await render(`<div style="width:1440px;height:900px;display:flex;gap:60px;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 30%,#1c2a1a,#0a0b0a 70%)">
  ${["hero-mov-0", "hero-mov-50", "panel-mov"].map((k) => `<div class="phone"><img src="${img(k)}" style="width:330px"></div>`).join("")}</div>`, 1440, 900, path.join(WEB, "dorn-agro-movil.jpg"), 80);

await render(`<div style="position:relative;width:1280px;height:769px">
  <img src="${SITIO}${FRAME}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:30% 50%;filter:brightness(.7)">
  <div style="position:absolute;inset:0;background:linear-gradient(270deg,#0a0b0af2 0%,#0a0b0acc 45%,transparent 78%)"></div>
  <div style="position:absolute;right:70px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:26px;width:560px">
    <p class="tag">Diseño web cinematográfico</p>
    <h1 style="font-size:66px">Webs que se sienten como una película</h1>
    <p style="font-size:24px;color:#cfd6cb">Animaciones de video que avanzan con el scroll, rápidas y perfectas en el celular.</p>
    <div class="chips"><span>Scroll animado</span><span>Responsive</span><span>SEO</span><span>PWA</span></div>
  </div></div>`, 1280, 769, path.join(FIVERR, "1-webs-cinematograficas.jpg"));
await render(`<div style="width:1280px;height:769px;background:radial-gradient(circle at 80% 20%,#1d2b1b,#0a0b0a 60%);display:flex;align-items:center;gap:40px;padding:0 50px">
  <div style="width:430px;display:flex;flex-direction:column;gap:22px;flex-shrink:0">
    <p class="tag">Apps web a medida</p>
    <h1 style="font-size:52px">Paneles en tiempo real con IA</h1>
    <p style="font-size:21px;color:#cfd6cb">Datos en vivo, control de equipos (IoT/ESP32), inicio de sesión con Google y asistentes de IA.</p>
    <div class="chips"><span>Tiempo real</span><span>IoT</span><span>Agentes de IA</span></div>
  </div>
  <div class="laptop" style="width:720px"><div class="bar"><i></i><i></i><i></i></div><img src="${img("panel-desk")}" style="width:100%;display:block"></div>
</div>`, 1280, 769, path.join(FIVERR, "2-apps-tiempo-real.jpg"));
await render(`<div style="width:1280px;height:769px;background:radial-gradient(circle at 20% 80%,#1d2b1b,#0a0b0a 60%);display:flex;align-items:center;justify-content:space-between;padding:0 70px">
  <div style="width:440px;display:flex;flex-direction:column;gap:22px">
    <p class="tag">Móvil primero</p>
    <h1 style="font-size:56px">Perfecta en cada celular</h1>
    <p style="font-size:21px;color:#cfd6cb">Se instala como app desde el navegador, sin tiendas. Rápida, accesible y lista para vender.</p>
    <p style="font-size:17px;color:#8fc86f;font-weight:600">Proyecto real: DORN AGRO</p>
  </div>
  <div style="display:flex;gap:26px;align-items:center">
    <div class="phone" style="transform:translateY(24px)"><img src="${img("hero-mov-0")}" style="width:250px"></div>
    <div class="phone" style="transform:translateY(-24px)"><img src="${img("panel-mov")}" style="width:250px"></div>
  </div></div>`, 1280, 769, path.join(FIVERR, "3-movil-primero.jpg"));

await browser.close();
