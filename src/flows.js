// Acciones del negocio compartidas por el panel web y la CLI (así ambos se comportan igual):
// pedido nuevo, mensajes, vista previa, aprobación, cambios, entrega. Cada acción deja historial,
// avisa al dueño (Telegram/webhook/email) y, en clientes directos, envía email al cliente.
import { getStore, getPackage, isMarketplace } from "./config.js";
import * as db from "./db.js";
import { saveVersion, currentVersion } from "./sites.js";
import { generateTemplateSite } from "./templates.js";
import { paymentStatus } from "./payments.js";
import { notify } from "./notify.js";
import { emailClient, emailOwner } from "./mailer.js";

export const portalUrl = (order, base) => `${String(base || process.env.PUBLIC_URL || "").replace(/\/$/, "")}/o/${order.token}`;
const adminUrl = (order, base) => `${String(base || process.env.PUBLIC_URL || "").replace(/\/$/, "")}/admin/pedidos/${order.id}`;

function tellOwner(text) {
  notify(text);
  emailOwner(text.split("\n")[0].slice(0, 120), text);
}

export function revisionInfo(order) {
  const included = getPackage(getStore(order.storeId), order.packageId)?.revisions ?? 0;
  return { used: order.review.revisionsUsed, included, exceeded: order.review.revisionsUsed > included };
}

// ---- Pedido y mensajes ------------------------------------------------------

export async function orderPlaced(order, base) {
  const store = getStore(order.storeId);
  const pkg = getPackage(store, order.packageId);
  tellOwner(`🛒 Nuevo pedido ${order.id} en "${store?.name}": ${order.client.name || order.client.username} — ${order.brief.businessName} (${pkg?.name ?? order.packageId}, ${order.price})\n${adminUrl(order, base)}`);
  await emailClient(order, `Recibimos tu pedido ${order.id}`, [
    `¡Gracias por tu pedido! Ya estamos revisando los detalles de "${order.brief.businessName}".`,
    "",
    `Paquete: ${pkg?.name ?? order.packageId} · Entrega estimada: ${order.brief.deadline}`,
    "",
    "En este enlace puedes seguir el avance, enviarnos tu logo y fotos, y escribirnos:",
    portalUrl(order, base),
    "",
    "Guarda este email: el enlace es personal.",
  ]);
}

export async function clientMessage(orderId, text, base) {
  const order = db.addMessage(orderId, "cliente", text);
  tellOwner(`💬 Mensaje nuevo en ${order.id} (${order.client.name || order.client.username}): ${String(text).slice(0, 300)}\n${adminUrl(order, base)}`);
  return order;
}

// Deja un mensaje tuyo en el portal del cliente (sin email).
function postOwnerMessage(orderId, text) {
  db.addMessage(orderId, "yo", text);
  return db.updateOrder(orderId, (o) => { o.ai.draftReply = ""; if (o.status === "nuevo") o.status = "contactado"; });
}

export async function ownerMessage(orderId, text, base) {
  const order = postOwnerMessage(orderId, text);
  await emailClient(order, `Nuevo mensaje sobre tu pedido ${order.id}`, [
    "Te dejamos un mensaje:",
    "",
    ...String(text).split("\n").map((l) => `> ${l}`),
    "",
    `Responde aquí: ${portalUrl(order, base)}`,
  ]);
  return db.getOrder(orderId);
}

// ---- Sitio: plantilla, vista previa, cambios, aprobación ---------------------

export function templateSite(orderId, note = "Plantilla rápida (sin IA)") {
  const order = db.getOrder(orderId);
  const n = saveVersion(orderId, generateTemplateSite(order), note);
  db.updateOrder(orderId, (o) => { if (["nuevo", "contactado"].includes(o.status)) o.status = "en_progreso"; });
  return n;
}

export async function sharePreview(orderId, base) {
  const order = db.getOrder(orderId);
  const version = currentVersion(order);
  if (!version) throw new Error("Primero genera el sitio.");
  db.updateOrder(orderId, (o) => {
    o.review.sharedVersion = version;
    o.review.sharedAt = new Date().toISOString();
    o.review.approvedAt = null;
    o.status = "revision";
  }, `Vista previa v${version} enviada al cliente`);
  if (isMarketplace(order.channel)) return version; // En marketplaces se envía por la plataforma (capturas/ZIP).
  const rev = revisionInfo(order);
  postOwnerMessage(orderId, `¡Tu vista previa está lista! Revísala aquí arriba y dime si la apruebas o qué cambios quieres (revisiones usadas: ${rev.used} de ${rev.included}).`);
  await emailClient(db.getOrder(orderId), `Tu sitio web está listo para revisar (${order.id})`, [
    "¡Tu vista previa está lista!",
    "",
    `Míralo aquí y apruébalo o pide cambios: ${portalUrl(order, base)}`,
  ]);
  return version;
}

export async function requestChanges(orderId, text, base) {
  const body = String(text || "").trim();
  if (!body) throw new Error("Describe los cambios que quieres.");
  const order = db.updateOrder(orderId, (o) => {
    o.review.revisionsUsed += 1;
    o.review.pendingChanges = o.review.pendingChanges ? `${o.review.pendingChanges}\n${body}` : body;
    o.review.approvedAt = null;
    o.status = "en_progreso";
  }, "El cliente pidió cambios");
  db.addMessage(orderId, "cliente", `✏️ Cambios solicitados:\n${body}`);
  const rev = revisionInfo(order);
  tellOwner(`✏️ ${order.id}: el cliente pidió cambios (revisión ${rev.used} de ${rev.included}${rev.exceeded ? " — SUPERA LAS INCLUIDAS" : ""}):\n${body.slice(0, 400)}\n${adminUrl(order, base)}`);
  return order;
}

export async function approve(orderId, base) {
  const order = db.updateOrder(orderId, (o) => {
    o.review.approvedAt = new Date().toISOString();
    o.status = "aprobado";
  }, "El cliente aprobó el diseño");
  db.addMessage(orderId, "cliente", "✅ ¡Apruebo el diseño!");
  tellOwner(`✅ ${order.id}: ${order.client.name || order.client.username} aprobó el diseño. Ya puedes entregar.\n${adminUrl(order, base)}`);
  return order;
}

// Se llama cuando termina de aplicarse un cambio: los pedidos pendientes quedan resueltos.
export const changesApplied = (orderId) => db.updateOrder(orderId, (o) => { o.review.pendingChanges = ""; });

// ---- Entrega ------------------------------------------------------------------

export async function deliver(orderId, base) {
  const order = db.getOrder(orderId);
  const version = currentVersion(order);
  if (!version) throw new Error("No hay sitio para entregar.");
  db.updateOrder(orderId, (o) => {
    o.delivery.version = version;
    o.delivery.deliveredAt = new Date().toISOString();
    o.status = "entregado";
  }, `Entregado (v${version})`);
  if (isMarketplace(order.channel)) return version; // Se entrega subiendo el ZIP en la plataforma.
  const pay = paymentStatus(db.getOrder(orderId));
  const published = db.getOrder(orderId).delivery.publishedUrl;
  const lines = [
    "¡Tu sitio web está terminado! 🎉",
    ...(published ? ["", `Ya está publicado en: ${published}`] : []),
    "",
    pay.due > 0
      ? `Para descargar los archivos finales, completa el pago pendiente (${pay.due}) desde tu portal: ${portalUrl(order, base)}`
      : `Descarga los archivos finales desde tu portal: ${portalUrl(order, base)}`,
    "",
    "¡Gracias por confiar en nosotros! Si te gustó el resultado, una reseña nos ayuda muchísimo.",
  ];
  postOwnerMessage(orderId, lines.join("\n"));
  await emailClient(db.getOrder(orderId), `Tu sitio web está terminado (${order.id})`, lines);
  return version;
}

// La descarga final se habilita cuando el pedido está entregado y (en clientes directos) pagado.
export function downloadAllowed(order) {
  if (!["entregado", "completado"].includes(order.status) || !order.delivery.version) return false;
  return isMarketplace(order.channel) || paymentStatus(order).due <= 0;
}
