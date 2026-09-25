#!/usr/bin/env node
// CLI para administrar el negocio desde la terminal (pensada también para que Claude Code la use).
// Uso: npm run cli -- <comando> [argumentos]    (o: node src/cli.js <comando> ...)
import fs from "node:fs";
import { loadEnv, getStores, getStore, getPackage, STATUSES, CHANNELS, statusLabel } from "./config.js";
import * as db from "./db.js";
import * as ai from "./ai.js";
import { saveVersion, sitePath } from "./sites.js";

loadEnv();

const HELP = `Comandos:
  pendientes                     Qué requiere atención ahora (nuevos, mensajes sin leer, entregas próximas)
  pedidos [estado] [tienda]      Lista pedidos (filtros opcionales)
  ver <ID>                       Detalle completo de un pedido
  resumen                        Métricas e ingresos
  tiendas                        Lista tiendas y paquetes
  nuevo '<json>'                 Crea un pedido. Ej: '{"storeId":"fiverr-landing","packageId":"basico","channel":"fiverr","externalRef":"FO123","clientUsername":"juan","businessName":"Pizzería Juan","description":"..."}'
  estado <ID> <estado>           Cambia el estado (${STATUSES.map((s) => s.id).join(", ")})
  mensaje <ID> "texto"           Registra/envía un mensaje tuyo al cliente (lo ve en su portal)
  mensaje-cliente <ID> "texto"   Registra un mensaje recibido del cliente (p. ej. copiado de Fiverr)
  nota <ID> "texto"              Añade una nota interna
  leido <ID>                     Marca los mensajes del pedido como leídos
  registrar-sitio <ID> "nota"    Registra como nueva versión el archivo sites/<ID>/index.html editado a mano
  ia-resumen <ID>                IA: análisis del pedido
  ia-respuesta <ID> [objetivo]   IA: borrador del próximo mensaje al cliente
  ia-sitio <ID>                  IA: genera el sitio web completo
  ia-cambios <ID> "cambios"      IA: aplica cambios al sitio actual
  ia-gig <tiendaId> [indicaciones]  IA: textos para publicar la tienda/gig`;

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const need = (v, msg) => { if (!v) throw new Error(msg); return v; };
const orderOrFail = (id) => db.getOrder(need(id, "Falta el ID del pedido (ej. WEB-0001)")) ?? (() => { throw new Error(`Pedido no encontrado: ${id}`); })();

function line(o) {
  const unread = o.messages.filter((m) => !m.read).length;
  return `${o.id}  ${statusLabel(o.status).padEnd(24)} ${money(o.price).padStart(9)}  ${(getStore(o.storeId)?.name ?? o.storeId).padEnd(28)} ${o.client.name || o.client.username} — ${o.brief.businessName}${unread ? `  ✉ ${unread} sin leer` : ""}`;
}

function show(o) {
  const store = getStore(o.storeId), pkg = getPackage(store, o.packageId);
  const out = [
    `${o.id} · ${statusLabel(o.status)} · ${store?.name} · ${pkg?.name ?? o.packageId} · ${money(o.price)} (comisión ${o.feePercent}%)`,
    `Canal: ${CHANNELS[o.channel] ?? o.channel}${o.externalRef ? ` #${o.externalRef}` : ""} · creado ${o.createdAt} · portal: /o/${o.token}`,
    `Cliente: ${JSON.stringify(o.client)}`,
    `Brief:`, ...Object.entries(o.brief).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`),
    `Notas: ${o.notes || "-"}`,
    `Sitio: ${o.site.versions.length ? `${o.site.versions.length} versiones → ${sitePath(o.id)}` : "sin generar"}`,
    `Mensajes:`, ...o.messages.map((m) => `  [${m.at.slice(0, 16)}] ${m.from === "yo" ? "YO" : "CLIENTE"}${m.read ? "" : " (nuevo)"}: ${m.text}`),
  ];
  if (o.ai.summary) out.push("Análisis IA:", o.ai.summary);
  if (o.ai.draftReply) out.push("Borrador de respuesta IA:", o.ai.draftReply);
  if (o.ai.job) out.push(`Última tarea IA: ${o.ai.job.type} → ${o.ai.job.status}${o.ai.job.error ? ` (${o.ai.job.error})` : ""}`);
  return out.join("\n");
}

const commands = {
  pendientes() {
    const active = db.listOrders().filter((o) => !["completado", "cancelado"].includes(o.status));
    const soon = Date.now() + 2 * 86400000;
    const groups = [
      ["Pedidos nuevos (sin contactar)", active.filter((o) => o.status === "nuevo")],
      ["Con mensajes sin leer", active.filter((o) => o.messages.some((m) => !m.read))],
      ["Entrega en ≤ 2 días o vencida", active.filter((o) => o.brief.deadline && Date.parse(o.brief.deadline) <= soon)],
      ["En progreso sin sitio generado", active.filter((o) => o.status === "en_progreso" && !o.site.versions.length)],
    ];
    for (const [title, list] of groups) console.log(`\n## ${title} (${list.length})\n${list.map(line).join("\n") || "  —"}`);
  },
  pedidos(status, storeId) { console.log(db.listOrders({ status, storeId }).map(line).join("\n") || "Sin pedidos."); },
  ver(id) { console.log(show(orderOrFail(id))); },
  resumen() {
    const s = db.stats();
    console.log(`Pedidos: ${s.total} · sin leer: ${s.unread}`);
    console.log(`Ganado bruto ${money(s.earnedGross)} · neto ${money(s.earnedNet)} · por cobrar ${money(s.pipelineGross)}`);
    console.log("Por estado:", Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(" "));
    for (const st of getStores()) console.log(`  ${st.name}: ${s.byStore[st.id]?.count ?? 0} pedidos, neto ${money(s.byStore[st.id]?.earnedNet)}`);
  },
  tiendas() {
    for (const s of getStores()) console.log(`${s.id} (${s.channel}, /s/${s.slug}): ${s.packages.map((p) => `${p.id}=${money(p.price)}`).join(", ")}`);
  },
  nuevo(json) { const o = db.createOrder(JSON.parse(need(json, "Falta el JSON del pedido"))); console.log(`Creado ${o.id}`); },
  estado(id, status) { db.setStatus(orderOrFail(id).id, status); console.log(`${id} → ${status}`); },
  mensaje(id, text) { db.addMessage(orderOrFail(id).id, "yo", text); console.log("Mensaje guardado."); },
  "mensaje-cliente"(id, text) { db.addMessage(orderOrFail(id).id, "cliente", text); console.log("Mensaje del cliente registrado."); },
  nota(id, text) {
    db.updateOrder(orderOrFail(id).id, (o) => { o.notes = `${o.notes ? `${o.notes}\n` : ""}[${new Date().toISOString().slice(0, 10)}] ${need(text, "Falta el texto")}`; });
    console.log("Nota añadida.");
  },
  leido(id) { db.markMessagesRead(orderOrFail(id).id); console.log("Marcados como leídos."); },
  "registrar-sitio"(id, note) {
    const o = orderOrFail(id);
    const file = sitePath(o.id);
    if (!fs.existsSync(file)) throw new Error(`No existe ${file}`);
    console.log(`Versión v${saveVersion(o.id, fs.readFileSync(file, "utf8"), note || "Edición manual")} registrada.`);
  },
  async "ia-resumen"(id) { console.log(await ai.summarize(orderOrFail(id).id)); },
  async "ia-respuesta"(id, ...intent) { console.log(await ai.draftReply(orderOrFail(id).id, intent.join(" "))); },
  async "ia-sitio"(id) { const o = orderOrFail(id); console.log(`Generando sitio (puede tardar unos minutos)…`); console.log(`Versión v${await ai.generateSite(o.id)} → ${sitePath(o.id)}`); },
  async "ia-cambios"(id, ...text) { const o = orderOrFail(id); console.log(`Aplicando cambios…`); console.log(`Versión v${await ai.applyChanges(o.id, need(text.join(" "), "Faltan los cambios"))} → ${sitePath(o.id)}`); },
  async "ia-gig"(storeId, ...extra) {
    need(getStore(storeId), `Tienda desconocida: ${storeId}`);
    const gig = await ai.generateGig(storeId, extra.join(" "));
    db.saveGig(storeId, gig);
    console.log(JSON.stringify(gig, null, 2));
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.log(HELP);
  process.exit(cmd && cmd !== "ayuda" && cmd !== "help" ? 1 : 0);
}
try {
  await commands[cmd](...args);
} catch (e) {
  console.error(`Error: ${ai.describeError(e)}`);
  process.exit(1);
}
