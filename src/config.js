import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
export const SITES_DIR = process.env.SITES_DIR || path.join(ROOT, "sites");
const STORES_FILE = process.env.STORES_FILE || path.join(ROOT, "config", "stores.json");

// Carga mínima de un archivo .env (sin dependencias). Las variables ya definidas no se pisan.
export function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export const STATUSES = [
  { id: "nuevo", label: "Nuevo" },
  { id: "contactado", label: "Contactado" },
  { id: "en_progreso", label: "En progreso" },
  { id: "revision", label: "En revisión del cliente" },
  { id: "entregado", label: "Entregado" },
  { id: "completado", label: "Completado / cobrado" },
  { id: "cancelado", label: "Cancelado" },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? id;

// Estados en los que el dinero ya se considera ganado.
export const EARNED_STATUSES = ["entregado", "completado"];

export const CHANNELS = {
  fiverr: "Fiverr",
  web: "Tienda propia",
  workana: "Workana",
  upwork: "Upwork",
  freelancer: "Freelancer.com",
  peopleperhour: "PeoplePerHour",
  malt: "Malt",
  contra: "Contra",
  directo: "Contacto directo",
  otro: "Otro",
};

// Comisión que cobra cada plataforma al vendedor (aprox. 2026; ajústalo si cambia o si tu nivel te da otra tarifa).
export const CHANNEL_FEES = { fiverr: 20, workana: 15, upwork: 10, freelancer: 10, peopleperhour: 20, malt: 10, contra: 0 };

// Plataformas cuyas reglas obligan a que la comunicación y el pago se queden dentro de ellas.
// A estos pedidos NUNCA se les ofrece pagar por PayPal u otro medio externo (riesgo de suspensión de la cuenta).
export const MARKETPLACE_CHANNELS = ["fiverr", "workana", "upwork", "freelancer", "peopleperhour", "malt", "contra"];
export const isMarketplace = (channel) => MARKETPLACE_CHANNELS.includes(channel);

let cache;
export function getCatalog() {
  if (!cache) {
    const raw = JSON.parse(fs.readFileSync(STORES_FILE, "utf8"));
    const ids = new Set();
    for (const s of raw.stores) {
      if (!s.id || !s.slug || !Array.isArray(s.packages)) throw new Error(`Tienda inválida en stores.json: ${s.id}`);
      if (ids.has(s.id)) throw new Error(`Tienda duplicada en stores.json: ${s.id}`);
      ids.add(s.id);
    }
    cache = { currency: raw.currency || "USD", payments: raw.payments || {}, stores: raw.stores };
  }
  return cache;
}
export const getStores = () => getCatalog().stores;
export const getStore = (id) => getStores().find((s) => s.id === id);
export const getStoreBySlug = (slug) => getStores().find((s) => s.slug === slug);
export const getPackage = (store, pkgId) => store?.packages.find((p) => p.id === pkgId);
