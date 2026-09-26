#!/usr/bin/env node
// Simulación de punta a punta del negocio: un cliente real (por HTTP, como un navegador) y el dueño (panel y CLI)
// recorren todo el ciclo de un pedido, y se verifica cada paso.
//
//   npm run simulacion              → usa Claude de verdad si hay ANTHROPIC_API_KEY en el entorno o en .env;
//                                      si no, usa una API de Claude simulada (mismo código, respuestas de prueba).
//   npm run simulacion -- --offline → fuerza la API simulada (no gasta créditos).
//
// Netlify, Telegram/webhook y el email se simulan siempre (salvo NETLIFY_TOKEN real + --netlify-real).
// Resultado: carpeta simulacion-resultado/ con INFORME.md, los sitios generados, el ZIP entregado y los emails.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "simulacion-resultado");
const args = process.argv.slice(2);

// ---- Entorno aislado ------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
// Lee .env solo para saber si hay claves reales (el resto de la configuración se aísla abajo).
// Importante: los módulos del sistema se importan DESPUÉS de fijar DATA_DIR/SITES_DIR.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const m of fs.readFileSync(envFile, "utf8").matchAll(/^\s*(ANTHROPIC_API_KEY|AI_MODEL|NETLIFY_TOKEN)\s*=\s*"?([^"\n]*)"?\s*$/gm)) {
    if (m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const realAI = Boolean(process.env.ANTHROPIC_API_KEY) && !args.includes("--offline");
const realNetlify = Boolean(process.env.NETLIFY_TOKEN) && args.includes("--netlify-real");
Object.assign(process.env, {
  DATA_DIR: path.join(OUT, "data"),
  SITES_DIR: path.join(OUT, "sites"),
  ADMIN_USER: "admin",
  ADMIN_PASSWORD: "simulacion-secreta",
  MAIL_OUTBOX: "1",
  BUSINESS_NAME: "Estudio Web Simulado",
  PUBLIC_URL: "",
  // Vacíos a propósito: impiden que .env active emails o Telegram reales durante la simulación.
  SMTP_HOST: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  OWNER_EMAIL: "",
});

// ---- Servicios externos simulados (Claude, Netlify, webhook de avisos) -------
const captured = { notifications: [], aiRequests: [], netlifyUploads: [] };
let db, templates;

function sse(res, model, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_sim", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < text.length; i += 2000) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 2000) } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: Math.ceil(text.length / 4) } });
  ev("message_stop", {});
  res.end();
}

function fakeClaude(body) {
  const blocks = typeof body.messages[0].content === "string" ? [{ type: "text", text: body.messages[0].content }] : body.messages[0].content;
  const prompt = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const images = blocks.filter((b) => b.type === "image").length;
  captured.aiRequests.push({ system: body.system, prompt, images, model: body.model, fallbacks: body.fallbacks, thinking: body.thinking, effort: body.output_config?.effort });
  const schema = body.output_config?.format?.schema;
  if (schema?.properties?.externalRef) {
    const pick = (re) => prompt.match(re)?.[1]?.trim() ?? "";
    return JSON.stringify({
      externalRef: pick(/Order\s*#?\s*([A-Z0-9]+)/i), clientUsername: pick(/buyer:\s*(\S+)/i), clientName: "", clientCountry: pick(/from\s+([A-Za-zÀ-ÿ ]+?)\s*[·\n]/i),
      packageName: pick(/(Básico|Estándar|Premium)/i), price: Number(pick(/\$\s*(\d+)/)) || 0, businessName: pick(/business:\s*([^\n·]+)/i),
      businessType: pick(/type:\s*([^\n·]+)/i), description: pick(/requirements:\s*([^\n]+)/i), sections: "", colors: pick(/colors?:\s*([^\n·]+)/i),
      references: "", domain: "", deadline: "",
    });
  }
  if (schema?.properties?.tags) {
    return JSON.stringify({ title: "Crearé una web profesional para tu negocio", description: "Descripción simulada del gig.", tags: ["web", "landing", "wordpress", "diseño", "responsive"], faq: [{ q: "¿Incluye dominio?", a: "Te ayudo a configurarlo." }], packages: [{ name: "Básico", title: "Landing", description: "1 página" }], requirements: ["Logo", "Fotos"] });
  }
  const code = prompt.match(/Código: (WEB-\d+)/)?.[1];
  const order = code && db.getOrder(code);
  if (prompt.includes("<sitio_actual>")) {
    const changes = prompt.match(/<cambios>\s*([\s\S]*?)\s*<\/cambios>/)?.[1] ?? "";
    const htmlDoc = templates.generateTemplateSite(order, { colorOverride: templates.pickColor(changes, undefined) })
      .replace("</main>", `<section id="horarios"><div class="wrap"><h2>Horarios</h2><p>Martes a domingo de 12:00 a 23:00.</p></div></section>\n</main>`)
      .replace("<head>", `<head>\n<!-- Cambios aplicados: ${changes.replace(/--/g, "")} -->`);
    return `Listo, apliqué los cambios:\n\`\`\`html\n${htmlDoc}\n\`\`\``;
  }
  if (prompt.includes("Crea la primera versión del sitio")) {
    return `Aquí está la primera versión:\n\`\`\`html\n${templates.generateTemplateSite(order)}\n\`\`\``;
  }
  if (prompt.includes("Prepara un informe breve")) {
    return `- Resumen: sitio para ${order.brief.businessName} (${order.brief.businessType}).\n- Falta: horarios de atención y dirección exacta.\n- Estructura: Inicio, Carta, Galería, Reservas, Contacto.\n- Extra sugerido: carta digital con QR.\n- Próximo paso: saludar, pedir horarios y cobrar el anticipo.`;
  }
  if (prompt.includes("Redacta el próximo mensaje")) {
    return `¡Hola ${order.client.name || order.client.username}! Gracias por tu pedido de ${order.brief.businessName}. Ya recibí tu logo y fotos. ¿Me confirmas tus horarios de atención y la dirección para ponerlos en la web?`;
  }
  return "Respuesta simulada.";
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const mock = http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.url.startsWith("/v1/messages")) {
    const json = JSON.parse(body.toString("utf8"));
    return sse(res, json.model, fakeClaude(json));
  }
  if (req.url === "/webhook") {
    captured.notifications.push(JSON.parse(body.toString("utf8")).text);
    return res.end("ok");
  }
  if (req.url.startsWith("/netlify/")) {
    const route = req.url.slice("/netlify".length);
    if (req.method === "POST" && (route === "/sites" || /^\/sites\/[^/]+\/deploys$/.test(route))) {
      captured.netlifyUploads.push({ route, zip: body });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "site_sim_123", ssl_url: "https://sitio-simulado.netlify.app" }));
    }
    if (req.method === "PATCH") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "site_sim_123", ssl_url: "https://la-trattoria-web-0001.netlify.app" }));
    }
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
process.env.NOTIFY_WEBHOOK_URL = `${mockUrl}/webhook`;
if (!realAI) Object.assign(process.env, { ANTHROPIC_BASE_URL: mockUrl, ANTHROPIC_API_KEY: "sim-key" });
if (!realNetlify) Object.assign(process.env, { NETLIFY_API_URL: `${mockUrl}/netlify`, NETLIFY_TOKEN: "sim-token" });

// ---- Arranque del sistema real ---------------------------------------------
db = await import("../src/db.js");
templates = await import("../src/templates.js");
const { start } = await import("../src/server.js");
const server = start(0);
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- Utilidades -------------------------------------------------------------
const AUTH = { authorization: `Basic ${Buffer.from("admin:simulacion-secreta").toString("base64")}` };
const ADMIN = { ...AUTH, origin: BASE };
const steps = [];
let current;

async function step(title, fn) {
  current = { title, checks: [], ok: true, ms: 0 };
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    current.ok = false;
    current.checks.push(`✘ ${e.message}`);
  }
  current.ms = Date.now() - t0;
  steps.push(current);
  console.log(`${current.ok ? "✔" : "✘"} ${title}${current.ok ? "" : `\n   ${current.checks.filter((c) => c.startsWith("✘")).join("\n   ")}`}`);
}
function check(cond, what) {
  if (!cond) throw new Error(what);
  current.checks.push(`✔ ${what}`);
}

const form = (obj) => new URLSearchParams(obj);
const get = (url, headers = {}) => fetch(BASE + url, { headers, redirect: "manual" });
const post = (url, body, headers = {}) => fetch(BASE + url, { method: "POST", headers, body, redirect: "manual" });
const text = async (res) => (await res).text();
const location = (res) => res.headers.get("location") || "";

function png(width, height, [r, g, b]) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const k = 0.55 + 0.45 * ((x / width + y / height) / 2);
      row[1 + x * 3] = r * k; row[2 + x * 3] = g * k; row[3 + x * 3] = b * k;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

// Lector de ZIP para comprobar que las entregas se abren correctamente (verifica CRC de cada archivo).
function readZip(buf) {
  const end = buf.length - 22;
  if (buf.readUInt32LE(end) !== 0x06054b50) throw new Error("ZIP sin directorio central");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (zlib.crc32(data) !== crc) throw new Error(`CRC inválido en ${name}`);
    files[name] = data;
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function waitJob(orderId) {
  const limit = Date.now() + (realAI ? 15 * 60_000 : 20_000);
  while (Date.now() < limit) {
    const job = db.getOrder(orderId).ai.job;
    if (job && job.status !== "running") {
      if (job.status === "error") throw new Error(`La tarea de IA falló: ${job.error}`);
      return job;
    }
    await new Promise((r) => setTimeout(r, realAI ? 3000 : 50));
  }
  throw new Error("La tarea de IA tardó demasiado");
}

const outbox = () => {
  const dir = path.join(OUT, "data", "outbox");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
};
const lastNotification = () => captured.notifications.at(-1) || "";
const waitFor = async (cond, what) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 30));
  check(cond(), what);
};

// ---- Configuración de pagos y contacto del negocio (como la pondría el dueño) --
const { getCatalog } = await import("../src/config.js");
Object.assign(getCatalog().payments, { paypalMe: "estudioweb", depositPercent: 50, links: [{ label: "Mercado Pago", url: "https://link.mercadopago.com.ar/estudioweb" }], instructions: "Transferencia: alias ESTUDIO.WEB.MP" });
getCatalog().contact.discordInvite = "https://discord.gg/estudioweb";

console.log(`\nSimulación · IA: ${realAI ? "Claude REAL" : "API de Claude simulada"} · Netlify: ${realNetlify ? "REAL" : "simulado"} · servidor ${BASE}\n`);
const t0 = Date.now();
let token, id, order;
const PHOTOS = { "Portada Salón.png": png(1200, 700, [180, 90, 40]), "plato-pasta.png": png(800, 800, [200, 160, 60]), "pizza horno.png": png(800, 800, [190, 60, 40]) };
const LOGO = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect width="200" height="60" rx="12" fill="#b3261e"/><text x="100" y="40" font-size="26" text-anchor="middle" fill="#fff" font-family="Georgia">La Trattoria</text></svg>`);

// =============================== CLIENTE DIRECTO ===============================

await step("1. El cliente entra a la tienda de restaurantes", async () => {
  const home = await text(get("/"));
  check(home.includes("Webs para Restaurantes"), "la portada lista las tiendas");
  const page = await text(get("/s/restaurantes"));
  check(page.includes("Haz tu pedido") && page.includes("Restaurante Completo"), "la tienda muestra paquetes y formulario");
});

await step("2. El cliente hace su pedido (paquete Restaurante Completo, USD 180)", async () => {
  const res = await post("/s/restaurantes/pedido", form({
    packageId: "estandar", clientName: "Lucía Romero", clientEmail: "lucia@latrattoria.test", clientPhone: "+54 9 11 4567 8910",
    clientDiscord: "lucia.trattoria", clientCountry: "Argentina", businessName: "La Trattoria", businessType: "Restaurante italiano",
    description: "Restaurante italiano familiar en Palermo. Pastas caseras y pizzas a la leña. Queremos que la gente reserve mesa y vea la carta desde el celular.",
    sections: "Inicio, Carta, Galería, Reservas, Contacto", colors: "rojo y tonos cálidos", domain: "latrattoria.com.ar",
  }));
  check(res.status === 303 && location(res).startsWith("/o/"), "el formulario redirige al portal privado del cliente");
  token = location(res).replace(/^\/o\//, "").replace(/\?.*/, "");
  order = db.listOrders({ q: "La Trattoria" })[0];
  id = order.id;
  check(order.price === 180 && order.status === "nuevo", `pedido ${id} creado con precio 180 y estado nuevo`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(order.brief.deadline), `fecha de entrega calculada automáticamente (${order.brief.deadline})`);
  const portal = await text(get(location(res)));
  check(portal.includes("Pedido recibido") && portal.includes(id), "el portal confirma el pedido");
});

await step("3. Avisos automáticos: al dueño (Telegram/webhook) y email de confirmación al cliente", async () => {
  await waitFor(() => captured.notifications.some((n) => n.includes(`Nuevo pedido ${id}`)), "el dueño recibe el aviso de pedido nuevo");
  await waitFor(() => outbox().some((m) => m.subject.includes(`Recibimos tu pedido ${id}`)), "el cliente recibe el email de confirmación");
  const mail = outbox().find((m) => m.subject.includes("Recibimos tu pedido"));
  check(mail.to[0].address === "lucia@latrattoria.test" && mail.text.includes(`/o/${token}`), "el email va a la clienta e incluye su enlace privado");
});

await step("4. El cliente sube su logo (SVG) y 3 fotos desde el portal", async () => {
  const logoForm = new FormData();
  logoForm.append("label", "logo");
  logoForm.append("files", new Blob([LOGO], { type: "image/svg+xml" }), "Logo Trattoria.svg");
  let res = await post(`/o/${token}/archivos`, logoForm);
  check(res.status === 303 && location(res).includes("ok=archivos"), "logo aceptado");
  const photos = new FormData();
  photos.append("label", "foto");
  for (const [name, buf] of Object.entries(PHOTOS)) photos.append("files", new Blob([buf], { type: "image/png" }), name);
  res = await post(`/o/${token}/archivos`, photos);
  check(res.status === 303 && location(res).includes("ok=archivos"), "3 fotos aceptadas");
  order = db.getOrder(id);
  check(order.files.length === 4 && order.files.find((f) => f.label === "logo")?.name === "logo-trattoria.svg", "nombres de archivo normalizados (logo-trattoria.svg, portada-salon.png…)");
  const portal = await text(get(`/o/${token}`));
  check(portal.includes("portada-salon.png"), "el portal muestra las miniaturas");
  const img = await get(`/o/${token}/preview/assets/portada-salon.png`);
  check(img.status === 200 && img.headers.get("content-type") === "image/png" && img.headers.get("content-security-policy")?.includes("sandbox"), "las imágenes se sirven con su tipo y en sandbox");
});

await step("5. Seguridad de subidas: se rechaza un archivo falso y rutas maliciosas", async () => {
  const fake = new FormData();
  fake.append("files", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "virus.png");
  const res = await post(`/o/${token}/archivos`, fake);
  check(res.status === 303 && decodeURIComponent(location(res)).includes("no es un .png válido"), "un .png que no es imagen se rechaza");
  const exe = new FormData();
  exe.append("files", new Blob(["MZ"], { type: "application/octet-stream" }), "programa.exe");
  check(decodeURIComponent(location(await post(`/o/${token}/archivos`, exe))).includes("no permitido"), "extensiones peligrosas (.exe) se rechazan");
  check((await get(`/o/${token}/preview/assets/..%2F..%2Fdata%2Fdb.json`)).status === 404, "no se puede leer la base de datos con rutas ../");
  check((await get(`/o/token-inventado/`)).status === 404, "un enlace de portal inventado no da acceso");
});

await step("6. El cliente escribe un mensaje", async () => {
  const res = await post(`/o/${token}/mensaje`, form({ text: "¡Hola! Abrimos de martes a domingo. ¿Pueden poner un botón para reservar por WhatsApp?" }));
  check(res.status === 303, "mensaje enviado");
  await waitFor(() => lastNotification().includes("Mensaje nuevo") || captured.notifications.some((n) => n.includes("botón para reservar")), "el dueño recibe el aviso del mensaje");
});

// ================================ EL DUEÑO ================================

await step("7. El dueño entra al panel (protegido) y ve el pedido con mensajes sin leer", async () => {
  check((await get("/admin")).status === 401, "sin contraseña no se puede entrar");
  const dash = await text(get("/admin", AUTH));
  check(dash.includes(id) && dash.includes("La Trattoria"), "el panel lista el pedido");
  const detail = await text(get(`/admin/pedidos/${id}`, AUTH));
  check(detail.includes("lucia@latrattoria.test") && detail.includes("wa.me/5491145678910") && detail.includes("lucia.trattoria"), "ve email, WhatsApp y Discord de la clienta");
  check(detail.includes("botón para reservar"), "ve el mensaje de la clienta");
  check((await post(`/admin/pedidos/${id}/notas`, form({ notes: "x" }), AUTH)).status === 403, "protección CSRF: un POST de otro sitio se rechaza");
});

await step("8. IA: analiza el pedido", async () => {
  await post(`/admin/pedidos/${id}/ia/resumen`, form({}), ADMIN);
  await waitJob(id);
  const o = db.getOrder(id);
  check(o.ai.summary.length > 50, "el análisis se guardó en el pedido");
  const req = captured.aiRequests.at(-1);
  if (!realAI) check(req.model === "claude-opus-5" && req.fallbacks === "default" && req.thinking?.type === "adaptive", "llamada a Claude con el modelo, pensamiento adaptativo y fallback correctos");
});

await step("9. IA: redacta la respuesta y el dueño la envía (portal + email)", async () => {
  await post(`/admin/pedidos/${id}/ia/respuesta`, form({ intent: "saludar y pedir horarios" }), ADMIN);
  await waitJob(id);
  const draft = db.getOrder(id).ai.draftReply;
  check(draft.length > 20, "borrador generado");
  if (!realAI) check(captured.aiRequests.at(-1).system.includes("discord.gg/estudioweb"), "a clientes directos la IA puede ofrecer el Discord del negocio");
  const detail = await text(get(`/admin/pedidos/${id}`, AUTH));
  check(detail.includes(draft.slice(0, 30).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;")), "el borrador aparece listo para enviar");
  await post(`/admin/pedidos/${id}/mensaje`, form({ from: "yo", text: draft }), ADMIN);
  const o = db.getOrder(id);
  check(o.status === "contactado" && o.messages.at(-1).from === "yo", "mensaje enviado y estado → contactado");
  await waitFor(() => outbox().some((m) => m.subject.includes("Nuevo mensaje")), "la clienta recibe el email de aviso");
});

await step("10. Cobro del anticipo (50%) por PayPal, sin comisión de plataforma", async () => {
  await post(`/admin/pedidos/${id}/cobro`, form({}), ADMIN);
  const draft = db.getOrder(id).ai.draftReply;
  check(draft.includes("paypalme/estudioweb/90USD") && draft.includes("mercadopago") && draft.includes("ESTUDIO.WEB.MP"), "mensaje de cobro con PayPal por USD 90, Mercado Pago y transferencia");
  await post(`/admin/pedidos/${id}/mensaje`, form({ from: "yo", text: draft }), ADMIN);
  const portal = await text(get(`/o/${token}`));
  check(portal.includes("paypalme/estudioweb/90USD"), "la clienta ve el botón de PayPal en su portal");
  await post(`/admin/pedidos/${id}/pago`, form({ amount: "90", method: "PayPal", note: "Operación 7F3K" }), ADMIN);
  check(db.getOrder(id).payments[0].amount === 90, "pago del anticipo registrado");
});

await step("11. IA: genera el sitio usando el logo y las fotos de la clienta", async () => {
  await post(`/admin/pedidos/${id}/ia/sitio`, form({}), ADMIN);
  await waitJob(id);
  const o = db.getOrder(id);
  check(o.site.versions.length === 1 && o.status === "en_progreso", "versión v1 creada y estado → en progreso");
  if (!realAI) check(captured.aiRequests.at(-1).images === 3, "Claude recibió las 3 fotos para verlas (el SVG va por nombre)");
  const htmlDoc = fs.readFileSync(path.join(OUT, "sites", id, "index.html"), "utf8");
  check(/^<!doctype html>/i.test(htmlDoc.trim()) && htmlDoc.includes("</html>"), "el sitio es un HTML completo");
  const used = o.files.filter((f) => htmlDoc.includes(`assets/${f.name}`)).length;
  check(used >= 2, `el sitio usa los archivos de la clienta (${used} de 4)`);
  const preview = await get(`/admin/pedidos/${id}/sitio/`, AUTH);
  check(preview.status === 200 && preview.headers.get("content-security-policy").includes("sandbox"), "el dueño ve la vista previa (en sandbox)");
  check((await get(`/admin/pedidos/${id}/sitio/assets/logo-trattoria.svg`, AUTH)).status === 200, "las imágenes cargan en la vista previa del panel");
  fs.copyFileSync(path.join(OUT, "sites", id, "v1.html"), path.join(OUT, "sitio-v1.html"));
});

await step("12. La clienta NO ve el borrador hasta que el dueño se lo envía", async () => {
  check((await get(`/o/${token}/preview/`)).status === 404, "vista previa oculta mientras el dueño trabaja");
  await post(`/admin/pedidos/${id}/enviar-revision`, form({}), ADMIN);
  const o = db.getOrder(id);
  check(o.status === "revision" && o.review.sharedVersion === 1, "estado → en revisión, v1 compartida");
  check((await get(`/o/${token}/preview/`)).status === 200, "ahora la clienta ve su sitio");
  check((await get(`/o/${token}/preview/assets/portada-salon.png`)).status === 200, "con sus imágenes");
  await waitFor(() => outbox().some((m) => m.subject.includes("listo para revisar")), "email: 'Tu sitio web está listo para revisar'");
  const portal = await text(get(`/o/${token}`));
  check(portal.includes("Aprobar diseño") && portal.includes("Pedir cambios") && portal.includes("Revisiones usadas: 0 de 3"), "el portal ofrece aprobar o pedir cambios (0 de 3 revisiones)");
});

await step("13. La clienta pide cambios desde el portal", async () => {
  const res = await post(`/o/${token}/cambios`, form({ text: "Me encanta. ¿Podemos cambiar el color principal a verde (como la bandera italiana) y agregar nuestros horarios: martes a domingo de 12 a 23?" }));
  check(location(res).includes("ok=cambios"), "cambios enviados");
  const o = db.getOrder(id);
  check(o.status === "en_progreso" && o.review.revisionsUsed === 1 && o.review.pendingChanges.includes("verde"), "revisión 1 de 3 registrada y cambios pendientes guardados");
  await waitFor(() => captured.notifications.some((n) => n.includes("pidió cambios")), "el dueño recibe el aviso de cambios");
  const detail = await text(get(`/admin/pedidos/${id}`, AUTH));
  check(detail.includes("Cambios pedidos por el cliente"), "el panel muestra los cambios pendientes y los precarga para la IA");
});

await step("14. IA: aplica los cambios → v2", async () => {
  await post(`/admin/pedidos/${id}/ia/cambios`, form({ instruction: db.getOrder(id).review.pendingChanges }), ADMIN);
  await waitJob(id);
  const o = db.getOrder(id);
  check(o.site.versions.length === 2 && !o.review.pendingChanges, "versión v2 creada y cambios marcados como resueltos");
  const v2 = fs.readFileSync(path.join(OUT, "sites", id, "v2.html"), "utf8");
  if (!realAI) check(v2.includes("#2e7d4f") && v2.includes("Horarios"), "v2 tiene el color verde y la sección de horarios");
  else check(v2 !== fs.readFileSync(path.join(OUT, "sites", id, "v1.html"), "utf8"), "v2 es distinta de v1");
  fs.copyFileSync(path.join(OUT, "sites", id, "v2.html"), path.join(OUT, "sitio-v2.html"));
});

await step("15. El dueño envía v2 y la clienta la aprueba", async () => {
  await post(`/admin/pedidos/${id}/enviar-revision`, form({}), ADMIN);
  check(db.getOrder(id).review.sharedVersion === 2, "v2 compartida");
  const res = await post(`/o/${token}/aprobar`, form({}));
  check(location(res).includes("ok=aprobado"), "la clienta aprueba");
  const o = db.getOrder(id);
  check(o.status === "aprobado" && o.review.approvedAt, "estado → aprobado por el cliente");
  await waitFor(() => captured.notifications.some((n) => n.includes("aprobó el diseño")), "el dueño recibe el aviso de aprobación");
  check((await post(`/o/${token}/aprobar`, form({}))).headers.get("location").includes("e="), "no se puede aprobar dos veces");
});

await step("16. Publicación en Netlify con un clic", async () => {
  const res = await post(`/admin/pedidos/${id}/publicar`, form({}), ADMIN);
  check(decodeURIComponent(location(res)).includes("Publicado en https://"), "publicado");
  const o = db.getOrder(id);
  check(o.delivery.publishedUrl?.startsWith("https://") && o.delivery.netlifySiteId, `dirección pública guardada (${o.delivery.publishedUrl})`);
  if (!realNetlify) {
    const files = readZip(captured.netlifyUploads[0].zip);
    check(files["index.html"] && Object.keys(files).some((f) => f.startsWith("assets/")), `Netlify recibió un ZIP válido (${Object.keys(files).length} archivos)`);
  }
});

await step("17. Entrega: la descarga queda bloqueada hasta pagar el saldo", async () => {
  await post(`/admin/pedidos/${id}/entregar`, form({}), ADMIN);
  const o = db.getOrder(id);
  check(o.status === "entregado" && o.delivery.version === 2, "estado → entregado (v2)");
  await waitFor(() => outbox().some((m) => m.subject.includes("está terminado")), "email: 'Tu sitio web está terminado' con la dirección publicada");
  const portal = await text(get(`/o/${token}`));
  check(portal.includes("Tu sitio está terminado") && portal.includes(o.delivery.publishedUrl) && portal.includes("se habilita al completar el pago"), "el portal muestra el sitio publicado y pide el saldo");
  const dl = await get(`/o/${token}/descargar`);
  check(dl.status === 303 && decodeURIComponent(location(dl)).includes("pago completo"), "descargar sin pagar el saldo no está permitido");
});

await step("18. Cobro del saldo y descarga del ZIP final", async () => {
  await post(`/admin/pedidos/${id}/cobro`, form({}), ADMIN);
  check(db.getOrder(id).ai.draftReply.includes("paypalme/estudioweb/90USD") && db.getOrder(id).ai.draftReply.includes("saldo"), "mensaje de cobro del saldo (USD 90)");
  await post(`/admin/pedidos/${id}/pago`, form({ amount: "90", method: "Mercado Pago" }), ADMIN);
  const dl = await get(`/o/${token}/descargar`);
  check(dl.status === 200 && dl.headers.get("content-type") === "application/zip", "descarga habilitada");
  const zip = Buffer.from(await dl.arrayBuffer());
  fs.writeFileSync(path.join(OUT, "entrega-la-trattoria.zip"), zip);
  const files = readZip(zip);
  check(files["index.html"].toString().includes("La Trattoria"), "el ZIP abre bien (CRC verificado) y contiene index.html");
  const assets = Object.keys(files).filter((f) => f.startsWith("assets/"));
  check(assets.length >= 2 && assets.every((a) => files["index.html"].toString().includes(a)), `incluye solo las imágenes que usa el sitio (${assets.join(", ")})`);
});

await step("19. Cierre: pedido completado y números del negocio", async () => {
  await post(`/admin/pedidos/${id}/estado`, form({ status: "completado" }), ADMIN);
  const s = db.stats();
  check(db.getOrder(id).status === "completado", "estado → completado");
  check(s.collected === 180 && s.outstanding === 0, "cobrado directo USD 180, saldo 0");
  check(Math.abs(s.earnedNet - 180 * (1 - 5.4 / 100)) < 0.01, `ganancia neta USD ${s.earnedNet.toFixed(2)} (solo comisión de PayPal, sin 20% de plataforma)`);
});

// ================================ PEDIDO DE FIVERR ================================
let fid;
await step("20. Pedido de Fiverr importado con IA pegando el texto", async () => {
  const raw = "Order #FO9K2ZQ · buyer: marcos_fit from Chile · Premium package $300\nbusiness: Marcos Fit Studio · type: gimnasio\nrequirements: landing para mi gimnasio con planes y horarios\ncolors: negro y naranja";
  const page = await text(post("/admin/pedidos/importar", form({ raw }), ADMIN));
  if (!realAI) check(page.includes("FO9K2ZQ") && page.includes("marcos_fit") && page.includes("Marcos Fit Studio"), "la IA extrajo nº de pedido, usuario y negocio");
  check(page.includes("Revísalos antes de guardar") || page.includes("Registrar pedido"), "formulario precargado para revisar");
  const res = await post("/admin/pedidos", form({ storePkg: "fiverr-landing|premium", channel: "fiverr", externalRef: "FO9K2ZQ", clientUsername: "marcos_fit", clientCountry: "Chile", businessName: "Marcos Fit Studio", businessType: "Gimnasio", description: "Landing para mi gimnasio con planes y horarios", colors: "negro y naranja" }), ADMIN);
  fid = location(res).match(/WEB-\d+/)[0];
  const o = db.getOrder(fid);
  check(o.feePercent === 20 && o.channel === "fiverr", `${fid} creado con comisión de Fiverr (20%)`);
});

await step("21. Reglas de Fiverr: nada de PayPal, Discord, WhatsApp ni portal externo", async () => {
  const detail = await text(get(`/admin/pedidos/${fid}`, AUTH));
  check(!/paypal|discord\.gg|wa\.me/i.test(detail) && detail.includes("fiverr.com/inbox/marcos_fit"), "el panel solo ofrece el chat de Fiverr");
  const cobro = await post(`/admin/pedidos/${fid}/cobro`, form({}), ADMIN);
  check(decodeURIComponent(location(cobro)).includes("dentro de la plataforma"), "no se puede generar un cobro externo");
  const f = db.getOrder(fid);
  const portal = await text(get(`/o/${f.token}`));
  check(!/paypal|discord|subir archivos/i.test(portal), "su portal no muestra pagos externos, Discord ni subidas");
  await post(`/admin/pedidos/${fid}/ia/respuesta`, form({}), ADMIN);
  await waitJob(fid);
  if (!realAI) check(captured.aiRequests.at(-1).system.includes("Nunca pidas ni ofrezcas email, teléfono, WhatsApp, Discord"), "la IA recibe la prohibición de sacar al cliente de Fiverr");
  check(!/paypal|discord\.gg|wa\.me/i.test(db.getOrder(fid).ai.draftReply), "el borrador de la IA no incluye contactos ni pagos externos");
});

await step("22. Fiverr: sitio con plantilla rápida (sin IA), entrega y ZIP para subir a Fiverr", async () => {
  await post(`/admin/pedidos/${fid}/plantilla`, form({}), ADMIN);
  check(db.getOrder(fid).site.versions.length === 1, "versión creada al instante con la plantilla");
  await post(`/admin/pedidos/${fid}/enviar-revision`, form({}), ADMIN);
  await post(`/admin/pedidos/${fid}/entregar`, form({}), ADMIN);
  const f = db.getOrder(fid);
  check(f.status === "entregado" && f.emails.length === 0, "entregado sin enviar emails externos al comprador de Fiverr");
  const zip = await get(`/admin/pedidos/${fid}/zip`, AUTH);
  const files = readZip(Buffer.from(await zip.arrayBuffer()));
  check(files["index.html"].toString().includes("Marcos Fit Studio"), "ZIP listo para subir en la entrega de Fiverr");
  fs.copyFileSync(path.join(OUT, "sites", fid, "index.html"), path.join(OUT, "sitio-fiverr-plantilla.html"));
});

await step("23. La CLI (la que usa Claude Code) ve el mismo estado", async () => {
  const env = { ...process.env };
  const run = (...a) => execFileSync(process.execPath, [path.join(ROOT, "src", "cli.js"), ...a], { env, encoding: "utf8" });
  const resumen = run("resumen");
  check(resumen.includes("Pedidos: 2") && resumen.includes("cobrado $180.00"), "resumen: 2 pedidos, USD 180 cobrados");
  check(run("ver", id).includes("publicado en https://"), "detalle del pedido con la dirección publicada");
  run("respaldo", path.join(OUT, "respaldo.zip"));
  const backup = readZip(fs.readFileSync(path.join(OUT, "respaldo.zip")));
  check(backup["data/db.json"] && Object.keys(backup).some((f) => f.startsWith("sites/")), `respaldo completo (${Object.keys(backup).length} archivos)`);
});

// ---- Informe ----------------------------------------------------------------
server.close();
mock.close();
const ok = steps.filter((s) => s.ok).length;
const emails = outbox();
fs.writeFileSync(path.join(OUT, "emails-enviados.txt"), emails.map((m) => `Para: ${m.to.map((t) => t.address).join(", ")}\nAsunto: ${m.subject}\n\n${m.text}\n${"-".repeat(60)}`).join("\n"));
fs.writeFileSync(path.join(OUT, "avisos-al-dueño.txt"), captured.notifications.join(`\n${"-".repeat(60)}\n`));

const report = `# Informe de simulación

- Fecha: ${new Date().toLocaleString("es")}
- IA: **${realAI ? "Claude real (API de Anthropic)" : "API de Claude simulada (mismo código; respuestas de prueba)"}**
- Netlify: ${realNetlify ? "real" : "simulado"} · Emails: guardados en \`emails-enviados.txt\` · Avisos: \`avisos-al-dueño.txt\`
- Resultado: **${ok} de ${steps.length} pasos correctos** en ${((Date.now() - t0) / 1000).toFixed(1)} s
- Verificaciones: ${steps.reduce((n, s) => n + s.checks.filter((c) => c.startsWith("✔")).length, 0)} correctas, ${steps.reduce((n, s) => n + s.checks.filter((c) => c.startsWith("✘")).length, 0)} fallidas

| Paso | Resultado | Tiempo |
|---|---|---|
${steps.map((s) => `| ${s.title} | ${s.ok ? "✅" : "❌"} | ${s.ms} ms |`).join("\n")}

## Detalle

${steps.map((s) => `### ${s.ok ? "✅" : "❌"} ${s.title}\n${s.checks.map((c) => `- ${c}`).join("\n")}`).join("\n\n")}

## Archivos generados

- \`sitio-v1.html\`, \`sitio-v2.html\`: versiones del sitio de La Trattoria (ábrelos junto a \`sites/${id}/assets/\` para ver las imágenes)
- \`entrega-la-trattoria.zip\`: lo que descargó la clienta
- \`sitio-fiverr-plantilla.html\`: sitio del pedido de Fiverr (plantilla rápida)
- \`emails-enviados.txt\` (${emails.length} emails), \`avisos-al-dueño.txt\` (${captured.notifications.length} avisos), \`respaldo.zip\`
`;
fs.writeFileSync(path.join(OUT, "INFORME.md"), report);
console.log(`\n${ok === steps.length ? "✅" : "❌"} ${ok}/${steps.length} pasos correctos · informe en simulacion-resultado/INFORME.md`);
process.exit(ok === steps.length ? 0 : 1);
