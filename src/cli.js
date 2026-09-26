#!/usr/bin/env node
// CLI para administrar el negocio desde la terminal (pensada también para que Claude Code la use).
// Uso: npm run cli -- <comando> [argumentos]    (o: node src/cli.js <comando> ...)
import fs from "node:fs";
import path from "node:path";
import { loadEnv, getStores, getStore, getPackage, STATUSES, CHANNELS, statusLabel, isMarketplace, DATA_DIR, SITES_DIR } from "./config.js";
import { paymentStatus, paymentRequestText } from "./payments.js";
import * as db from "./db.js";
import * as ai from "./ai.js";
import { saveVersion, sitePath, addAsset, buildZip, LABELS } from "./sites.js";
import * as flows from "./flows.js";
import { publishToNetlify } from "./deploy.js";
import { createZip } from "./zip.js";
import { mailEnabled } from "./mailer.js";

loadEnv();
if (mailEnabled() && !process.env.PUBLIC_URL) console.warn("⚠ Define PUBLIC_URL en .env: los emails al cliente llevan enlaces a su portal.");

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
  pago <ID> <monto> [medio] [nota]  Registra un pago directo recibido (PayPal, Mercado Pago, transferencia...)
  cobro <ID>                     Prepara el mensaje de cobro (anticipo o saldo) con tus enlaces de pago
  leido <ID>                     Marca los mensajes del pedido como leídos
  registrar-sitio <ID> "nota"    Registra como nueva versión el archivo sites/<ID>/index.html editado a mano
  ia-resumen <ID>                IA: análisis del pedido
  ia-respuesta <ID> [objetivo]   IA: borrador del próximo mensaje al cliente
  ia-sitio <ID>                  IA: genera el sitio web completo
  ia-cambios <ID> "cambios"      IA: aplica cambios al sitio actual
  ia-gig <tiendaId> [indicaciones]  IA: textos para publicar la tienda/gig
  plantilla <ID>                 Crea una versión del sitio con la plantilla rápida (sin IA, gratis)
  subir <ID> <archivo> [logo|foto|otro]  Agrega un logo/foto al pedido (queda en sites/<ID>/assets/)
  enviar-revision <ID>           Envía la vista previa actual al cliente (email + portal)
  cambios-cliente <ID> "texto"   Registra cambios pedidos por el cliente (cuenta como revisión)
  aprobar <ID>                   Registra que el cliente aprobó el diseño
  entregar <ID>                  Marca como entregado y avisa al cliente (descarga habilitada si pagó)
  publicar <ID>                  Publica el sitio en Netlify (requiere NETLIFY_TOKEN)
  zip <ID> [destino.zip]         Genera el ZIP del sitio (index.html + assets/) para entregarlo
  respaldo [destino.zip]         Copia de seguridad de data/ y sites/ en un ZIP`;

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
    ...(o.extras?.length ? [`Extras: ${o.extras.map((e) => `${e.name} ${e.recurring ? `${money(e.price)}/${e.recurring}` : `+${money(e.price)}`}`).join(", ")}`] : []),
    `Canal: ${CHANNELS[o.channel] ?? o.channel}${o.externalRef ? ` #${o.externalRef}` : ""} · creado ${o.createdAt} · portal: /o/${o.token}`,
    `Cliente: ${JSON.stringify(o.client)}`,
    `Brief:`, ...Object.entries(o.brief).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`),
    `Notas: ${o.notes || "-"}`,
    isMarketplace(o.channel) ? `Cobro: dentro de ${CHANNELS[o.channel] ?? o.channel}` : `Cobro directo: pagado ${money(paymentStatus(o).paid)} de ${money(o.price)}${(o.payments ?? []).map((p) => `\n  ${p.at.slice(0, 10)} ${money(p.amount)} ${p.method} ${p.note}`).join("")}`,
    `Sitio: ${o.site.versions.length ? `${o.site.versions.length} versiones → ${sitePath(o.id)}` : "sin generar"}`,
    `Archivos: ${o.files.map((f) => `assets/${f.name} (${LABELS[f.label]}, ${f.from})`).join(", ") || "ninguno"}`,
    `Revisión: vista previa enviada ${o.review.sharedVersion ? `v${o.review.sharedVersion}` : "no"} · revisiones ${flows.revisionInfo(o).used}/${flows.revisionInfo(o).included}${o.review.approvedAt ? ` · aprobado ${o.review.approvedAt.slice(0, 10)}` : ""}${o.review.pendingChanges ? `\n  Cambios pendientes: ${o.review.pendingChanges}` : ""}`,
    `Entrega: ${o.delivery.deliveredAt ? `v${o.delivery.version} el ${o.delivery.deliveredAt.slice(0, 10)}` : "pendiente"}${o.delivery.publishedUrl ? ` · publicado en ${o.delivery.publishedUrl}` : ""}`,
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
      ["Cambios pedidos por el cliente sin aplicar", active.filter((o) => o.review.pendingChanges)],
      ["Aprobados por el cliente, listos para entregar", active.filter((o) => o.status === "aprobado")],
      ["Clientes directos con saldo por cobrar", active.filter((o) => !isMarketplace(o.channel) && o.status !== "nuevo" && paymentStatus(o).due > 0)],
    ];
    for (const [title, list] of groups) console.log(`\n## ${title} (${list.length})\n${list.map(line).join("\n") || "  —"}`);
  },
  pedidos(status, storeId) { console.log(db.listOrders({ status, storeId }).map(line).join("\n") || "Sin pedidos."); },
  ver(id) { console.log(show(orderOrFail(id))); },
  resumen() {
    const s = db.stats();
    console.log(`Pedidos: ${s.total} · sin leer: ${s.unread}`);
    console.log(`Ganado bruto ${money(s.earnedGross)} · neto ${money(s.earnedNet)} · por cobrar ${money(s.pipelineGross)}`);
    console.log(`Cobros directos (sin comisión de plataforma): cobrado ${money(s.collected)} · saldo pendiente ${money(s.outstanding)}`);
    console.log("Por estado:", Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join(" "));
    for (const st of getStores()) console.log(`  ${st.name}: ${s.byStore[st.id]?.count ?? 0} pedidos, neto ${money(s.byStore[st.id]?.earnedNet)}`);
  },
  tiendas() {
    for (const s of getStores()) console.log(`${s.id} (${s.channel}, /s/${s.slug}): ${s.packages.map((p) => `${p.id}=${money(p.price)}`).join(", ")}`);
  },
  nuevo(json) { const o = db.createOrder(JSON.parse(need(json, "Falta el JSON del pedido"))); console.log(`Creado ${o.id}`); },
  estado(id, status) { db.setStatus(orderOrFail(id).id, status); console.log(`${id} → ${status}`); },
  async mensaje(id, text) { await flows.ownerMessage(orderOrFail(id).id, need(text, "Falta el texto"), process.env.PUBLIC_URL); console.log("Mensaje enviado (portal + email si está configurado)."); },
  "mensaje-cliente"(id, text) { db.addMessage(orderOrFail(id).id, "cliente", need(text, "Falta el texto")); console.log("Mensaje del cliente registrado."); },
  nota(id, text) {
    db.updateOrder(orderOrFail(id).id, (o) => { o.notes = `${o.notes ? `${o.notes}\n` : ""}[${new Date().toISOString().slice(0, 10)}] ${need(text, "Falta el texto")}`; });
    console.log("Nota añadida.");
  },
  pago(id, amount, method, ...note) {
    const o = orderOrFail(id);
    if (isMarketplace(o.channel)) throw new Error("Pedido de marketplace: el pago lo gestiona la plataforma.");
    db.addPayment(o.id, amount, method, note.join(" "));
    const st = paymentStatus(db.getOrder(o.id));
    console.log(`Pago registrado. Cobrado ${money(st.paid)} · saldo ${money(st.due)}`);
  },
  cobro(id) {
    const o = orderOrFail(id);
    const text = paymentRequestText(o);
    db.updateOrder(o.id, (x) => { x.ai.draftReply = text; }, "Mensaje de cobro preparado");
    console.log(`${text}\n\n(Guardado como borrador en el pedido. Envíalo con: npm run cli -- mensaje ${o.id} "...")`);
  },
  leido(id) { db.markMessagesRead(orderOrFail(id).id); console.log("Marcados como leídos."); },
  "registrar-sitio"(id, note) {
    const o = orderOrFail(id);
    const file = sitePath(o.id);
    if (!fs.existsSync(file)) throw new Error(`No existe ${file}`);
    console.log(`Versión v${saveVersion(o.id, fs.readFileSync(file, "utf8"), note || "Edición manual")} registrada.`);
    if (o.review.pendingChanges) {
      flows.changesApplied(o.id);
      console.log("Cambios pendientes del cliente marcados como resueltos.");
    }
  },
  async "ia-resumen"(id) { console.log(await ai.summarize(orderOrFail(id).id)); },
  async "ia-respuesta"(id, ...intent) { console.log(await ai.draftReply(orderOrFail(id).id, intent.join(" "))); },
  async "ia-sitio"(id) { const o = orderOrFail(id); console.log(`Generando sitio (puede tardar unos minutos)…`); console.log(`Versión v${await ai.generateSite(o.id)} → ${sitePath(o.id)}`); },
  async "ia-cambios"(id, ...text) {
    const o = orderOrFail(id);
    const instruction = text.join(" ") || o.review.pendingChanges;
    console.log(`Aplicando cambios…`);
    console.log(`Versión v${await ai.applyChanges(o.id, need(instruction, "Faltan los cambios"))} → ${sitePath(o.id)}`);
    flows.changesApplied(o.id);
  },
  plantilla(id) { const o = orderOrFail(id); console.log(`Versión v${flows.templateSite(o.id)} → ${sitePath(o.id)}`); },
  subir(id, file, label = "foto") {
    const o = orderOrFail(id);
    if (!LABELS[label]) throw new Error("Tipo inválido: usa logo, foto u otro");
    console.log(`Guardado como assets/${addAsset(o.id, path.basename(need(file, "Falta la ruta del archivo")), fs.readFileSync(file), "yo", label)}`);
  },
  async "enviar-revision"(id) { const o = orderOrFail(id); console.log(`Vista previa v${await flows.sharePreview(o.id, process.env.PUBLIC_URL)} enviada.`); },
  async "cambios-cliente"(id, ...text) { const o = await flows.requestChanges(orderOrFail(id).id, text.join(" "), process.env.PUBLIC_URL); console.log(`Registrado (revisión ${o.review.revisionsUsed}).`); },
  async aprobar(id) { await flows.approve(orderOrFail(id).id, process.env.PUBLIC_URL); console.log("Aprobación registrada."); },
  async entregar(id) { const o = orderOrFail(id); console.log(`Entregado v${await flows.deliver(o.id, process.env.PUBLIC_URL)}. Descarga habilitada: ${flows.downloadAllowed(db.getOrder(o.id)) ? "sí" : "no (falta pago)"}`); },
  async publicar(id) { console.log(`Publicado: ${await publishToNetlify(orderOrFail(id).id)}`); },
  zip(id, dest) {
    const o = orderOrFail(id);
    const out = dest || `${o.id}.zip`;
    fs.writeFileSync(out, buildZip(o.id));
    console.log(`ZIP guardado en ${out}`);
  },
  respaldo(dest) {
    const entries = [];
    const walk = (dir, prefix) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, `${prefix}${e.name}/`);
        else if (!e.name.endsWith(".tmp")) entries.push({ name: `${prefix}${e.name}`, data: fs.readFileSync(full) });
      }
    };
    walk(DATA_DIR, "data/");
    walk(SITES_DIR, "sites/");
    const out = dest || `respaldo-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`;
    fs.writeFileSync(out, createZip(entries));
    console.log(`Respaldo con ${entries.length} archivos guardado en ${out}`);
  },
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
