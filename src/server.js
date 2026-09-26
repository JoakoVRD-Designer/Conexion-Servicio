import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import { ROOT, loadEnv, getStores, getStore, getStoreBySlug, getPackage, CHANNELS, isMarketplace } from "./config.js";
import * as db from "./db.js";
import * as ai from "./ai.js";
import * as flows from "./flows.js";
import { readVersion, addAsset, deleteAsset, assetPath, assetType, buildZip, MAX_FILE_BYTES } from "./sites.js";
import { paymentRequestText } from "./payments.js";
import { publishToNetlify, netlifyEnabled } from "./deploy.js";
import * as v from "./views.js";

loadEnv();
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1");
app.disable("x-powered-by");
app.set("strict routing", true); // "/preview" y "/preview/" son rutas distintas (las rutas relativas assets/ dependen de ello)
app.use(express.urlencoded({ extended: false, limit: "300kb" }));
app.use(express.static(path.join(ROOT, "public")));

const send = (res, page, status = 200) => res.status(status).type("html").send(String(page));
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const background = (promise) => promise.catch((e) => console.error("[tarea]", e));

// Límite simple por IP para formularios públicos (evita spam).
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip, t = Date.now(), windowMs = 10 * 60 * 1000;
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(key, list);
  if (list.length > 30) return send(res, v.errorPage(429, "Demasiados envíos. Intenta de nuevo en unos minutos."), 429);
  next();
}

// Subida de archivos (logo, fotos): en memoria, se validan y se guardan en sites/<ID>/assets/.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 10 } });
function receiveFiles(req, res) {
  return new Promise((resolve, reject) => {
    upload.array("files", 10)(req, res, (err) => {
      if (err?.code === "LIMIT_FILE_SIZE") return reject(new Error("Cada archivo puede pesar como máximo 10 MB."));
      if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE") return reject(new Error("Máximo 10 archivos por envío."));
      if (err) return reject(err);
      if (!req.files?.length) return reject(new Error("Selecciona al menos un archivo."));
      resolve(req.files);
    });
  });
}
function saveUploads(orderId, files, from, label) {
  const saved = [], errors = [];
  for (const f of files) {
    // multer entrega el nombre en latin1; se convierte a UTF-8 para conservar acentos.
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    try { saved.push(addAsset(orderId, name, f.buffer, from, label)); } catch (e) { errors.push(e.message); }
  }
  return { saved, errors };
}

// Los sitios y archivos subidos se sirven en un sandbox: su JavaScript no puede actuar sobre el panel ni el portal.
function sandbox(res) {
  res.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Robots-Tag", "noindex");
}
function sendSite(res, htmlDoc) {
  sandbox(res);
  res.type("html").send(htmlDoc);
}
function sendAsset(res, orderId, name) {
  const file = assetPath(orderId, name);
  if (!file) return send(res, v.errorPage(404, "Archivo no encontrado"), 404);
  sandbox(res);
  res.set("Cache-Control", "private, max-age=300");
  res.type(assetType(name)).sendFile(file);
}
function sendZip(res, order, version) {
  const slug = (order.brief.businessName || "sitio").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sitio";
  res.attachment(`${slug}-${order.id}.zip`).type("application/zip").send(buildZip(order.id, version));
}

// ------------------------------------------------------------------ Público

app.get("/", (req, res) => send(res, v.homePage(getStores())));

app.get("/s/:slug", (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return send(res, v.errorPage(404, "Tienda no encontrada"), 404);
  send(res, v.storePage(store));
});

app.post("/s/:slug/pedido", rateLimit, (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store || isMarketplace(store.channel)) return send(res, v.errorPage(404, "Tienda no encontrada"), 404);
  const f = req.body;
  if (f.website) return res.redirect(303, "/"); // honeypot anti-bots
  if (!getPackage(store, f.packageId) || !f.clientName || !f.clientEmail || !f.businessName || !f.description) {
    return send(res, v.storePage(store, "Completa los campos obligatorios.", f), 400);
  }
  const order = db.createOrder({ ...f, price: undefined, feePercent: undefined, deadline: undefined, storeId: store.id, channel: "web" });
  background(flows.orderPlaced(order, baseUrl(req)));
  res.redirect(303, `/o/${order.token}?ok=pedido`);
});

const PORTAL_FLASH = {
  pedido: "¡Pedido recibido! Te enviamos un email con este enlace. Ya puedes subir tu logo y fotos aquí abajo.",
  mensaje: "Mensaje enviado.",
  archivos: "Archivos recibidos. ¡Gracias!",
  aprobado: "¡Gracias! Registramos tu aprobación y preparamos la entrega final.",
  cambios: "Recibimos tus cambios. Te avisaremos cuando la nueva versión esté lista.",
};

// Resuelve el pedido por su enlace privado; si no existe responde 404.
function withPortal(handler) {
  return async (req, res) => {
    const order = db.getOrderByToken(req.params.token);
    if (!order) return send(res, v.errorPage(404, "Pedido no encontrado"), 404);
    try {
      await handler(req, res, order);
    } catch (e) {
      res.redirect(303, `/o/${order.token}?e=${encodeURIComponent(e.message)}`);
    }
  };
}

app.get("/o/:token", withPortal((req, res, order) => {
  send(res, v.clientPortal(order, Object.hasOwn(PORTAL_FLASH, String(req.query.ok)) ? PORTAL_FLASH[req.query.ok] : "", req.query.e ? String(req.query.e).slice(0, 300) : ""));
}));

app.post("/o/:token/mensaje", rateLimit, withPortal(async (req, res, order) => {
  await flows.clientMessage(order.id, req.body.text, baseUrl(req));
  res.redirect(303, `/o/${order.token}?ok=mensaje`);
}));

app.post("/o/:token/archivos", rateLimit, withPortal(async (req, res, order) => {
  if (isMarketplace(order.channel) || order.status === "cancelado") throw new Error("No se pueden subir archivos a este pedido.");
  const files = await receiveFiles(req, res);
  const { saved, errors } = saveUploads(order.id, files, "cliente", req.body.label);
  if (saved.length) await flows.clientMessage(order.id, `📎 Subí ${saved.length} archivo(s): ${saved.join(", ")}`, baseUrl(req));
  if (errors.length) throw new Error(errors.join(" "));
  res.redirect(303, `/o/${order.token}?ok=archivos`);
}));

app.post("/o/:token/aprobar", rateLimit, withPortal(async (req, res, order) => {
  if (order.status !== "revision") throw new Error("No hay una vista previa pendiente de aprobación.");
  await flows.approve(order.id, baseUrl(req));
  res.redirect(303, `/o/${order.token}?ok=aprobado`);
}));

app.post("/o/:token/cambios", rateLimit, withPortal(async (req, res, order) => {
  if (order.status !== "revision") throw new Error("Ahora mismo no hay una vista previa para revisar.");
  await flows.requestChanges(order.id, String(req.body.text || "").slice(0, 8000), baseUrl(req));
  res.redirect(303, `/o/${order.token}?ok=cambios`);
}));

// El cliente ve la versión que le enviaste (o la entregada), nunca tu trabajo en curso.
const portalVersion = (order) => (["entregado", "completado"].includes(order.status) && order.delivery.version) || order.review.sharedVersion;

app.get("/o/:token/preview", (req, res) => res.redirect(301, `/o/${req.params.token}/preview/`));
app.get("/o/:token/preview/", withPortal((req, res, order) => {
  const doc = portalVersion(order) && readVersion(order.id, portalVersion(order));
  if (!doc) return send(res, v.errorPage(404, "La vista previa todavía no está disponible."), 404);
  sendSite(res, doc);
}));
app.get("/o/:token/preview/assets/:name", withPortal((req, res, order) => sendAsset(res, order.id, req.params.name)));

app.get("/o/:token/descargar", withPortal((req, res, order) => {
  if (!flows.downloadAllowed(order)) throw new Error("La descarga se habilita cuando el sitio está entregado y el pago completo.");
  sendZip(res, order, order.delivery.version);
}));

// ------------------------------------------------------------------ Admin

const admin = express.Router({ strict: true });

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
    background(flows.orderPlaced(order, baseUrl(req)));
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
const back = (res, order, msg) => res.redirect(303, `/admin/pedidos/${order.id}${msg ? `?ok=${encodeURIComponent(msg)}` : ""}`);

admin.get("/pedidos/:id", withOrder((req, res, order) => {
  send(res, v.orderDetail(order, { baseUrl: baseUrl(req), flash: req.query.ok, error: req.query.err, netlifyOn: netlifyEnabled() }));
  db.markMessagesRead(order.id);
}));

admin.post("/pedidos/:id/estado", withOrder((req, res, order) => {
  db.setStatus(order.id, req.body.status);
  back(res, order, "Estado actualizado");
}));

admin.post("/pedidos/:id/mensaje", withOrder(async (req, res, order) => {
  if (req.body.from === "cliente") db.addMessage(order.id, "cliente", req.body.text);
  else await flows.ownerMessage(order.id, req.body.text, baseUrl(req));
  back(res, order, "Mensaje guardado");
}));

admin.post("/pedidos/:id/pago", withOrder((req, res, order) => {
  db.addPayment(order.id, req.body.amount, req.body.method, req.body.note);
  back(res, order, "Pago registrado");
}));

// Prepara el mensaje de cobro (anticipo o saldo) con los enlaces de PayPal / otros medios configurados.
admin.post("/pedidos/:id/cobro", withOrder((req, res, order) => {
  const text = paymentRequestText(order);
  db.updateOrder(order.id, (o) => { o.ai.draftReply = text; }, "Mensaje de cobro preparado");
  back(res, order, "Mensaje de cobro listo: revísalo y envíalo");
}));

admin.post("/pedidos/:id/notas", withOrder((req, res, order) => {
  db.updateOrder(order.id, (o) => { o.notes = String(req.body.notes || "").slice(0, 8000); });
  back(res, order, "Notas guardadas");
}));

admin.post("/pedidos/:id/archivos", withOrder(async (req, res, order) => {
  const files = await receiveFiles(req, res);
  const { saved, errors } = saveUploads(order.id, files, "yo", req.body.label);
  if (errors.length) throw new Error(errors.join(" "));
  back(res, order, `${saved.length} archivo(s) subido(s)`);
}));

admin.post("/pedidos/:id/archivos/:name/eliminar", withOrder((req, res, order) => {
  deleteAsset(order.id, req.params.name);
  back(res, order, "Archivo eliminado");
}));

admin.post("/pedidos/:id/plantilla", withOrder((req, res, order) => {
  const n = flows.templateSite(order.id);
  back(res, order, `Versión v${n} creada con la plantilla rápida`);
}));

admin.post("/pedidos/:id/enviar-revision", withOrder(async (req, res, order) => {
  const n = await flows.sharePreview(order.id, baseUrl(req));
  back(res, order, isMarketplace(order.channel) ? `v${n} marcada como enviada a revisión` : `Vista previa v${n} enviada al cliente`);
}));

admin.post("/pedidos/:id/entregar", withOrder(async (req, res, order) => {
  const n = await flows.deliver(order.id, baseUrl(req));
  back(res, order, `Pedido entregado (v${n})`);
}));

admin.post("/pedidos/:id/publicar", withOrder(async (req, res, order) => {
  const url = await publishToNetlify(order.id);
  back(res, order, `Publicado en ${url}`);
}));

admin.post("/pedidos/:id/ia/resumen", withOrder((req, res, order) => {
  ai.runJob(order.id, "análisis del pedido", () => ai.summarize(order.id));
  back(res, order);
}));

admin.post("/pedidos/:id/ia/respuesta", withOrder((req, res, order) => {
  ai.runJob(order.id, "borrador de respuesta", () => ai.draftReply(order.id, String(req.body.intent || "").slice(0, 500)));
  back(res, order);
}));

admin.post("/pedidos/:id/ia/sitio", withOrder((req, res, order) => {
  ai.runJob(order.id, "generación del sitio", () => ai.generateSite(order.id), () => {
    db.updateOrder(order.id, (o) => { if (["nuevo", "contactado"].includes(o.status)) o.status = "en_progreso"; });
  });
  back(res, order);
}));

admin.post("/pedidos/:id/ia/cambios", withOrder((req, res, order) => {
  const instruction = String(req.body.instruction || "").trim().slice(0, 8000);
  if (!instruction) throw new Error("Escribe los cambios a aplicar.");
  ai.runJob(order.id, "aplicar cambios al sitio", () => ai.applyChanges(order.id, instruction), () => flows.changesApplied(order.id));
  back(res, order);
}));

admin.get("/pedidos/:id/zip", withOrder((req, res, order) => sendZip(res, order)));

admin.get("/pedidos/:id/sitio", (req, res) => res.redirect(301, `/admin/pedidos/${req.params.id}/sitio/${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`));
admin.get("/pedidos/:id/sitio/", withOrder((req, res, order) => {
  const doc = readVersion(order.id, req.query.v);
  if (!doc) return send(res, v.errorPage(404, "Versión no encontrada", true), 404);
  sendSite(res, doc);
}));
admin.get("/pedidos/:id/sitio/assets/:name", withOrder((req, res, order) => sendAsset(res, order.id, req.params.name)));

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

export function start(port = Number(process.env.PORT || 3000)) {
  db.resetInterruptedJobs();
  const server = app.listen(port, () => {
    const p = server.address().port;
    console.log(`Tiendas públicas: http://localhost:${p}/`);
    console.log(`Panel de administración: http://localhost:${p}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.warn("⚠ Define ADMIN_PASSWORD en .env para activar el panel.");
    if (!process.env.ANTHROPIC_API_KEY) console.warn("⚠ Sin ANTHROPIC_API_KEY: la IA no estará disponible (la plantilla rápida sí).");
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, "src", "server.js")) start();

export default app;
