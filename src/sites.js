// Archivos de cada pedido:
//   sites/<PEDIDO>/v1.html, v2.html, ...  versiones del sitio
//   sites/<PEDIDO>/index.html             versión actual
//   sites/<PEDIDO>/assets/                logo, fotos e imágenes (subidas por el cliente o por ti)
// Claude Code (o tú) puede editar sites/<PEDIDO>/index.html directamente y luego registrar la versión con la CLI.
// Los sitios referencian las imágenes con rutas relativas: assets/<archivo>.
import fs from "node:fs";
import path from "node:path";
import { SITES_DIR } from "./config.js";
import { updateOrder, getOrder } from "./db.js";
import { createZip } from "./zip.js";

export const MAX_FILES_PER_ORDER = 30;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const FILE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

const dirFor = (orderId) => {
  if (!/^WEB-\d+$/.test(orderId)) throw new Error(`Id de pedido inválido: ${orderId}`);
  return path.join(SITES_DIR, orderId);
};
const assetsDir = (orderId) => path.join(dirFor(orderId), "assets");

// ---- Versiones del sitio ----------------------------------------------------

export function saveVersion(orderId, html, note) {
  const dir = dirFor(orderId);
  fs.mkdirSync(dir, { recursive: true });
  const n = (getOrder(orderId)?.site.versions.length ?? 0) + 1;
  fs.writeFileSync(path.join(dir, `v${n}.html`), html);
  fs.writeFileSync(path.join(dir, "index.html"), html);
  updateOrder(orderId, (o) => {
    o.site.versions.push({ n, at: new Date().toISOString(), note: String(note || "").slice(0, 2000) });
  }, `Sitio versión ${n} guardada`);
  return n;
}

export function readVersion(orderId, n) {
  const file = n ? path.join(dirFor(orderId), `v${Number(n)}.html`) : path.join(dirFor(orderId), "index.html");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export const currentHtml = (orderId) => readVersion(orderId);
export const sitePath = (orderId) => path.join(dirFor(orderId), "index.html");
export const currentVersion = (order) => order.site.versions.at(-1)?.n ?? 0;

// ---- Archivos (logo, fotos) ------------------------------------------------

// Comprueba que el contenido corresponde realmente al tipo indicado por la extensión.
function looksValid(ext, buf) {
  const hex = buf.subarray(0, 12).toString("hex");
  switch (ext) {
    case ".jpg": case ".jpeg": return hex.startsWith("ffd8ff");
    case ".png": return hex.startsWith("89504e470d0a1a0a");
    case ".gif": return buf.subarray(0, 4).toString("latin1") === "GIF8";
    case ".webp": return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    case ".ico": return hex.startsWith("00000100");
    case ".pdf": return buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case ".svg": return /<svg[\s>]/i.test(buf.subarray(0, 4096).toString("utf8"));
    default: return false;
  }
}

function safeName(original, taken) {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, path.extname(original))
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "archivo";
  let name = `${base}${ext}`;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}${ext}`;
  return name;
}

export const LABELS = { logo: "Logo", foto: "Foto", otro: "Otro" };

// from: "cliente" | "yo". label: "logo" | "foto" | "otro"
export function addAsset(orderId, originalName, buffer, from, label = "foto") {
  const order = getOrder(orderId);
  if (!order) throw new Error(`Pedido no encontrado: ${orderId}`);
  const ext = path.extname(String(originalName)).toLowerCase();
  if (!FILE_TYPES[ext]) throw new Error(`Tipo de archivo no permitido (${ext || "sin extensión"}). Usa JPG, PNG, WEBP, GIF, SVG o PDF.`);
  if (!buffer?.length) throw new Error("El archivo está vacío.");
  if (buffer.length > MAX_FILE_BYTES) throw new Error("El archivo supera los 10 MB.");
  if (!looksValid(ext, buffer)) throw new Error(`El archivo ${originalName} no es un ${ext} válido.`);
  if (order.files.length >= MAX_FILES_PER_ORDER) throw new Error(`Máximo ${MAX_FILES_PER_ORDER} archivos por pedido.`);

  const name = safeName(originalName, new Set(order.files.map((f) => f.name)));
  fs.mkdirSync(assetsDir(orderId), { recursive: true });
  fs.writeFileSync(path.join(assetsDir(orderId), name), buffer);
  updateOrder(orderId, (o) => {
    o.files.push({ name, label: LABELS[label] ? label : "foto", from, size: buffer.length, type: FILE_TYPES[ext], at: new Date().toISOString() });
  }, `Archivo subido por ${from === "yo" ? "ti" : "el cliente"}: ${name}`);
  return name;
}

export function deleteAsset(orderId, name) {
  const file = assetPath(orderId, name);
  if (!file) throw new Error("Archivo no encontrado");
  fs.rmSync(file);
  updateOrder(orderId, (o) => { o.files = o.files.filter((f) => f.name !== name); }, `Archivo eliminado: ${name}`);
}

// Devuelve la ruta del archivo solo si pertenece al pedido (evita salir de la carpeta).
export function assetPath(orderId, name) {
  const order = getOrder(orderId);
  if (!order?.files.some((f) => f.name === name)) return null;
  const file = path.join(assetsDir(orderId), name);
  return path.dirname(file) === assetsDir(orderId) && fs.existsSync(file) ? file : null;
}

export const readAsset = (orderId, name) => {
  const file = assetPath(orderId, name);
  return file ? fs.readFileSync(file) : null;
};

export const assetType = (name) => FILE_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream";

// ZIP listo para subir a cualquier hosting: index.html + assets/ (solo los que el sitio usa, más el logo).
export function buildZip(orderId, version) {
  const order = getOrder(orderId);
  const htmlDoc = readVersion(orderId, version);
  if (!htmlDoc) throw new Error("Este pedido todavía no tiene un sitio.");
  const entries = [{ name: "index.html", data: htmlDoc }];
  for (const f of order.files) {
    if (f.type === "application/pdf" || !htmlDoc.includes(`assets/${f.name}`)) continue;
    const data = readAsset(orderId, f.name);
    if (data) entries.push({ name: `assets/${f.name}`, data });
  }
  return createZip(entries);
}
