import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { ROOT, loadEnv, getStores, getStore, getStoreBySlug, getPackage, CHANNELS } from "./config.js";
import * as db from "./db.js";
import * as ai from "./ai.js";
import { readVersion } from "./sites.js";
import { paymentRequestText } from "./payments.js";
import { notify } from "./notify.js";
import * as v from "./views.js";

loadEnv();
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1");
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "300kb" }));
app.use(express.static(path.join(ROOT, "public")));

const send = (res, page, status = 200) => res.status(status).type("html").send(String(page));
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// Límite simple por IP para formularios públicos (evita spam).
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip, t = Date.now(), windowMs = 10 * 60 * 1000;
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(key, list);
  if (list.length > 15) return send(res, v.errorPage(429, "Demasiados envíos. Intenta de nuevo en unos minutos."), 429);
  next();
}

// Las vistas previas de sitios generados se sirven en un sandbox para que su JS no pueda actuar sobre el panel.
function sendSite(res, htmlDoc, download, name) {
  res.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
  res.set("X-Robots-Tag", "noindex");
  if (download) res.attachment(name);
  res.type("html").send(htmlDoc);
}

// ------------------------------------------------------------------ Público

app.get("/", (req, res) => send(res, v.homePage(getStores())));

app.get("/s/:slug", (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return send(res, v.errorPage(404, "Tienda no encontrada"), 404);
  send(res, v.storePage(store));
});

app.post("/s/:slug/pedido", rateLimit, async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store || store.channel === "fiverr") return send(res, v.errorPage(404, "Tienda no encontrada"), 404);
  const f = req.body;
  if (f.website) return res.redirect(303, "/"); // honeypot anti-bots
  if (!getPackage(store, f.packageId) || !f.clientName || !f.clientEmail || !f.businessName || !f.description) {
    return send(res, v.storePage(store, "Completa los campos obligatorios.", f), 400);
  }
  const order = db.createOrder({ ...f, price: undefined, feePercent: undefined, storeId: store.id, channel: "web" });
  notify(`🛒 Nuevo pedido ${order.id} en "${store.name}": ${order.client.name} — ${order.brief.businessName} (${order.price} ${store.packages.find((p) => p.id === order.packageId)?.name})\n${baseUrl(req)}/admin/pedidos/${order.id}`);
  res.redirect(303, `/o/${order.token}?ok=1`);
});

app.get("/o/:token", (req, res) => {
  const order = db.getOrderByToken(req.params.token);
  if (!order) return send(res, v.errorPage(404, "Pedido no encontrado"), 404);
  const flash = req.query.ok === "1" ? "¡Pedido recibido! Te contactaremos muy pronto." : req.query.ok === "2" ? "Mensaje enviado." : "";
  send(res, v.clientPortal(order, flash));
});

app.post("/o/:token/mensaje", rateLimit, (req, res) => {
  const order = db.getOrderByToken(req.params.token);
  if (!order) return send(res, v.errorPage(404, "Pedido no encontrado"), 404);
  try {
    db.addMessage(order.id, "cliente", req.body.text);
  } catch (e) {
    return send(res, v.errorPage(400, e.message), 400);
  }
  notify(`💬 Mensaje nuevo en ${order.id} (${order.client.name}): ${String(req.body.text).slice(0, 300)}\n${baseUrl(req)}/admin/pedidos/${order.id}`);
  res.redirect(303, `/o/${order.token}?ok=2`);
});

app.get("/o/:token/preview", (req, res) => {
  const order = db.getOrderByToken(req.params.token);
  const doc = order && readVersion(order.id);
  if (!doc) return send(res, v.errorPage(404, "Vista previa no disponible todavía"), 404);
  sendSite(res, doc);
});

// ------------------------------------------------------------------ Admin

const admin = express.Router();

admin.use((req, res, next) => {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return send(res, v.errorPage(503, "Define ADMIN_PASSWORD en el archivo .env para activar el panel."), 503);
  const [scheme, encoded] = (req.get("authorization") || "").split(" ");
  const [user, ...rest] = Buffer.from(encoded || "", "base64").toString().split(":");
  const ok = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  if (scheme !== "Basic" || !ok(user, process.env.ADMIN_USER || "admin") || !ok(rest.join(":"), pass)) {
    res.set("WWW-Authenticate", 'Basic realm="Panel", charset="UTF-8"');
    return res.status(401).send("Acceso restringido");
  }
  // Protección CSRF: los POST del panel deben venir del propio panel.
  if (req.method === "POST") {
    const origin = req.get("origin") || req.get("referer") || "";
    let host = "";
    try { host = new URL(origin).host; } catch {}
    if (host !== req.get("host")) return send(res, v.errorPage(403, "Origen no permitido", true), 403);
  }
  res.set("Cache-Control", "no-store");
  next();
});

admin.get("/", (req, res) => {
  const filters = { storeId: req.query.storeId || "", status: req.query.status || "", channel: req.query.channel || "", q: req.query.q || "" };
  send(res, v.dashboard({ stats: db.stats(), orders: db.listOrders(filters), stores: getStores(), filters }));
});

admin.get("/pedidos/nuevo", (req, res) => send(res, v.newOrderPage({ stores: getStores() })));

admin.post("/pedidos/importar", async (req, res) => {
  try {
    const data = await ai.extractOrder(String(req.body.raw || "").slice(0, 30000));
    // Intenta asociar el paquete por nombre/precio.
    let storeId = "", packageId = "";
    for (const s of getStores().filter((s) => s.channel === "fiverr")) {
      const p = s.packages.find((p) => data.packageName && p.name.toLowerCase().includes(data.packageName.toLowerCase().split(" ")[0])) || s.packages.find((p) => p.price === data.price);
      if (p) { storeId = s.id; packageId = p.id; break; }
    }
    send(res, v.newOrderPage({ stores: getStores(), prefill: { ...data, price: data.price || "", storeId, packageId, channel: "fiverr", imported: true, notes: `Importado con IA. Paquete indicado: ${data.packageName}` } }));
  } catch (e) {
    send(res, v.newOrderPage({ stores: getStores(), aiError: ai.describeError(e) }), 502);
  }
});

admin.post("/pedidos", (req, res) => {
  const [storeId, packageId] = String(req.body.storePkg || "").split("|");
  try {
    if (!CHANNELS[req.body.channel]) throw new Error("Canal inválido");
    const order = db.createOrder({ ...req.body, storeId, packageId });
    res.redirect(303, `/admin/pedidos/${order.id}?ok=Pedido+creado`);
  } catch (e) {
    send(res, v.newOrderPage({ stores: getStores(), prefill: { ...req.body, storeId, packageId }, error: e.message }), 400);
  }
});

function withOrder(handler) {
  return async (req, res) => {
    const order = db.getOrder(req.params.id);
    if (!order) return send(res, v.errorPage(404, "Pedido no encontrado", true), 404);
    try {
      await handler(req, res, order);
    } catch (e) {
      res.redirect(303, `/admin/pedidos/${order.id}?err=${encodeURIComponent(ai.describeError(e))}`);
    }
  };
}

admin.get("/pedidos/:id", withOrder((req, res, order) => {
  send(res, v.orderDetail(order, { baseUrl: baseUrl(req), flash: req.query.ok, error: req.query.err }));
  db.markMessagesRead(order.id);
}));

admin.post("/pedidos/:id/estado", withOrder((req, res, order) => {
  db.setStatus(order.id, req.body.status);
  res.redirect(303, `/admin/pedidos/${order.id}?ok=Estado+actualizado`);
}));

admin.post("/pedidos/:id/mensaje", withOrder((req, res, order) => {
  const from = req.body.from === "cliente" ? "cliente" : "yo";
  db.addMessage(order.id, from, req.body.text);
  if (from === "yo") db.updateOrder(order.id, (o) => { o.ai.draftReply = ""; if (o.status === "nuevo") o.status = "contactado"; });
  res.redirect(303, `/admin/pedidos/${order.id}?ok=Mensaje+guardado`);
}));

admin.post("/pedidos/:id/pago", withOrder((req, res, order) => {
  db.addPayment(order.id, req.body.amount, req.body.method, req.body.note);
  res.redirect(303, `/admin/pedidos/${order.id}?ok=Pago+registrado`);
}));

// Prepara el mensaje de cobro (anticipo o saldo) con los enlaces de PayPal / otros medios configurados.
admin.post("/pedidos/:id/cobro", withOrder((req, res, order) => {
  const text = paymentRequestText(order);
  db.updateOrder(order.id, (o) => { o.ai.draftReply = text; }, "Mensaje de cobro preparado");
  res.redirect(303, `/admin/pedidos/${order.id}?ok=Mensaje+de+cobro+listo:+rev%C3%ADsalo+y+env%C3%ADalo`);
}));

admin.post("/pedidos/:id/notas", withOrder((req, res, order) => {
  db.updateOrder(order.id, (o) => { o.notes = String(req.body.notes || "").slice(0, 8000); });
  res.redirect(303, `/admin/pedidos/${order.id}?ok=Notas+guardadas`);
}));

admin.post("/pedidos/:id/ia/resumen", withOrder((req, res, order) => {
  ai.runJob(order.id, "análisis del pedido", () => ai.summarize(order.id));
  res.redirect(303, `/admin/pedidos/${order.id}`);
}));

admin.post("/pedidos/:id/ia/respuesta", withOrder((req, res, order) => {
  ai.runJob(order.id, "borrador de respuesta", () => ai.draftReply(order.id, String(req.body.intent || "").slice(0, 500)));
  res.redirect(303, `/admin/pedidos/${order.id}`);
}));

admin.post("/pedidos/:id/ia/sitio", withOrder((req, res, order) => {
  ai.runJob(order.id, "generación del sitio", () => ai.generateSite(order.id));
  res.redirect(303, `/admin/pedidos/${order.id}`);
}));

admin.post("/pedidos/:id/ia/cambios", withOrder((req, res, order) => {
  const instruction = String(req.body.instruction || "").trim().slice(0, 8000);
  if (!instruction) throw new Error("Escribe los cambios a aplicar.");
  ai.runJob(order.id, "aplicar cambios al sitio", () => ai.applyChanges(order.id, instruction));
  res.redirect(303, `/admin/pedidos/${order.id}`);
}));

admin.get("/pedidos/:id/sitio", withOrder((req, res, order) => {
  const doc = readVersion(order.id, req.query.v);
  if (!doc) return send(res, v.errorPage(404, "Versión no encontrada", true), 404);
  sendSite(res, doc, req.query.descargar === "1", `${order.id}-index.html`);
}));

const gigJobs = new Map(); // storeId -> estado
admin.get("/tiendas", (req, res) => {
  const running = [...gigJobs.entries()].find(([, s]) => s === "running")?.[0];
  const gigs = Object.fromEntries(getStores().map((s) => [s.id, db.getGig(s.id)]));
  const errors = [...gigJobs.entries()].filter(([, s]) => s.startsWith("error")).map(([id, s]) => { gigJobs.delete(id); return `${getStore(id)?.name}: ${s}`; });
  send(res, v.storesPage({ stores: getStores(), gigs, flash: req.query.ok, error: errors.join(" · ") || req.query.err, running }));
});

admin.post("/tiendas/:id/ia/gig", (req, res) => {
  const store = getStore(req.params.id);
  if (!store) return send(res, v.errorPage(404, "Tienda no encontrada", true), 404);
  if (gigJobs.get(store.id) === "running") return res.redirect(303, "/admin/tiendas");
  gigJobs.set(store.id, "running");
  ai.generateGig(store.id, String(req.body.extra || "").slice(0, 1000))
    .then((gig) => { db.saveGig(store.id, gig); gigJobs.delete(store.id); })
    .catch((e) => { console.error("[IA] gig:", e); gigJobs.set(store.id, `error: ${ai.describeError(e)}`); });
  res.redirect(303, "/admin/tiendas");
});

app.use("/admin", admin);

app.use((req, res) => send(res, v.errorPage(404, "Página no encontrada"), 404));
app.use((err, req, res, next) => {
  console.error(err);
  send(res, v.errorPage(500, "Error interno"), 500);
});

const port = Number(process.env.PORT || 3000);
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, "src", "server.js")) {
  app.listen(port, () => {
    console.log(`Tiendas públicas: http://localhost:${port}/`);
    console.log(`Panel de administración: http://localhost:${port}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.warn("⚠ Define ADMIN_PASSWORD en .env para activar el panel.");
    if (!process.env.ANTHROPIC_API_KEY) console.warn("⚠ Sin ANTHROPIC_API_KEY: las funciones de IA no estarán disponibles.");
  });
}

export default app;
