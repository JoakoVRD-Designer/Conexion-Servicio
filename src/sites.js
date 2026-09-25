// Archivos de los sitios generados: sites/<PEDIDO>/v1.html, v2.html, ... e index.html (versión actual).
// Claude Code (o tú) puede editar sites/<PEDIDO>/index.html directamente y luego registrar la versión con la CLI.
import fs from "node:fs";
import path from "node:path";
import { SITES_DIR } from "./config.js";
import { updateOrder, getOrder } from "./db.js";

const dirFor = (orderId) => {
  if (!/^WEB-\d+$/.test(orderId)) throw new Error(`Id de pedido inválido: ${orderId}`);
  return path.join(SITES_DIR, orderId);
};

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
