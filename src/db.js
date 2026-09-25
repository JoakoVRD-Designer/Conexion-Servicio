// Base de datos simple en un archivo JSON (data/db.json).
// Suficiente para cientos/miles de pedidos; las escrituras son atómicas (archivo temporal + rename).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, STATUS_IDS, EARNED_STATUSES, CHANNEL_FEES, getStore, getPackage, getCatalog, isMarketplace } from "./config.js";

const DB_FILE = path.join(DATA_DIR, "db.json");
let db;
let loadedMtime = 0;
const mtime = () => (fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).mtimeMs : 0);

// Relee el archivo si otro proceso (la CLI o el servidor) lo modificó.
function load() {
  if (db && mtime() === loadedMtime) return db;
  loadedMtime = mtime();
  db = loadedMtime ? JSON.parse(fs.readFileSync(DB_FILE, "utf8")) : {};
  db.seq ??= 0;
  db.orders ??= [];
  db.gigs ??= {};
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
  loadedMtime = mtime();
}

const now = () => new Date().toISOString();
const clean = (v, max = 5000) => (v == null ? "" : String(v).trim().slice(0, max));

export function createOrder(input) {
  load();
  const store = getStore(input.storeId);
  if (!store) throw new Error(`Tienda desconocida: ${input.storeId}`);
  const pkg = getPackage(store, input.packageId);
  const price = input.price !== undefined && input.price !== "" ? Number(input.price) : pkg?.price ?? 0;
  if (!Number.isFinite(price) || price < 0) throw new Error("Precio inválido");

  const channel = clean(input.channel || store.channel, 20);
  // Comisión: la de la plataforma si es un marketplace; si no, la del medio de pago directo (PayPal, etc.).
  const autoFee = isMarketplace(channel) ? CHANNEL_FEES[channel] ?? store.feePercent : getCatalog().payments.feePercent ?? store.feePercent;
  const feePercent = input.feePercent !== undefined && input.feePercent !== "" ? Number(input.feePercent) : Number(autoFee ?? 0);
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) throw new Error("Comisión inválida");

  db.seq += 1;
  const order = {
    id: `WEB-${String(db.seq).padStart(4, "0")}`,
    token: crypto.randomBytes(18).toString("base64url"),
    storeId: store.id,
    channel,
    externalRef: clean(input.externalRef, 100),
    packageId: pkg?.id ?? clean(input.packageId, 40),
    price,
    feePercent,
    status: "nuevo",
    client: {
      name: clean(input.clientName, 120),
      email: clean(input.clientEmail, 200),
      phone: clean(input.clientPhone, 40),
      username: clean(input.clientUsername, 100),
      country: clean(input.clientCountry, 60),
    },
    brief: {
      businessName: clean(input.businessName, 200),
      businessType: clean(input.businessType, 200),
      description: clean(input.description, 8000),
      sections: clean(input.sections, 2000),
      colors: clean(input.colors, 300),
      references: clean(input.references, 2000),
      domain: clean(input.domain, 200),
      deadline: clean(input.deadline, 40),
    },
    messages: [],
    payments: [],
    notes: clean(input.notes, 8000),
    ai: { summary: "", draftReply: "", job: null },
    site: { versions: [] },
    history: [{ at: now(), event: "Pedido creado" }],
    createdAt: now(),
    updatedAt: now(),
  };
  db.orders.push(order);
  save();
  return order;
}

export function listOrders({ storeId, status, channel, q } = {}) {
  load();
  const needle = q ? q.toLowerCase() : "";
  return db.orders
    .filter((o) => (!storeId || o.storeId === storeId) && (!status || o.status === status) && (!channel || o.channel === channel))
    .filter((o) => !needle || JSON.stringify([o.id, o.client, o.brief.businessName, o.externalRef]).toLowerCase().includes(needle))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrder(id) {
  load();
  return db.orders.find((o) => o.id === String(id).toUpperCase());
}

export function getOrderByToken(token) {
  load();
  if (!token) return undefined;
  const t = Buffer.from(String(token));
  return db.orders.find((o) => {
    const ot = Buffer.from(o.token);
    return ot.length === t.length && crypto.timingSafeEqual(ot, t);
  });
}

// Aplica una función de cambios al pedido y guarda.
export function updateOrder(id, mutate, event) {
  const order = getOrder(id);
  if (!order) throw new Error(`Pedido no encontrado: ${id}`);
  mutate(order);
  if (event) order.history.push({ at: now(), event });
  order.updatedAt = now();
  save();
  return order;
}

export function setStatus(id, status) {
  if (!STATUS_IDS.includes(status)) throw new Error(`Estado inválido: ${status}. Usa: ${STATUS_IDS.join(", ")}`);
  return updateOrder(id, (o) => { o.status = status; }, `Estado → ${status}`);
}

// from: "cliente" | "yo" (vendedor)
export function addMessage(id, from, text) {
  const body = clean(text, 8000);
  if (!body) throw new Error("Mensaje vacío");
  return updateOrder(id, (o) => {
    o.messages.push({ from, text: body, at: now(), read: from === "yo" });
  });
}

export function markMessagesRead(id) {
  const order = getOrder(id);
  if (!order || order.messages.every((m) => m.read)) return order;
  return updateOrder(id, (o) => o.messages.forEach((m) => { m.read = true; }));
}

export function addPayment(id, amount, method, note) {
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Monto inválido");
  return updateOrder(id, (o) => {
    (o.payments ??= []).push({ amount: value, method: clean(method, 60) || "otro", note: clean(note, 500), at: now() });
  }, `Pago registrado: ${value} (${clean(method, 60) || "otro"})`);
}

export function getGig(storeId) {
  load();
  return db.gigs[storeId];
}

export function saveGig(storeId, gig) {
  load();
  db.gigs[storeId] = { ...gig, generatedAt: now() };
  save();
}

export function stats() {
  const orders = listOrders();
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0]));
  const byStore = {};
  let earnedGross = 0, earnedNet = 0, pipelineGross = 0, unread = 0, collected = 0, outstanding = 0;
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const net = o.price * (1 - (o.feePercent || 0) / 100);
    const s = (byStore[o.storeId] ??= { count: 0, earnedNet: 0 });
    s.count += 1;
    if (EARNED_STATUSES.includes(o.status)) {
      earnedGross += o.price;
      earnedNet += net;
      s.earnedNet += net;
    } else if (o.status !== "cancelado") {
      pipelineGross += o.price;
    }
    unread += o.messages.filter((m) => !m.read).length;
    // Cobros directos registrados (los marketplaces pagan por su cuenta y no se registran aquí).
    if (!isMarketplace(o.channel) && o.status !== "cancelado") {
      const paid = (o.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
      collected += paid;
      outstanding += Math.max(0, o.price - paid);
    }
  }
  return { total: orders.length, byStatus, byStore, earnedGross, earnedNet, pipelineGross, unread, collected, outstanding };
}
