// Plantillas HTML. Todo valor interpolado se escapa salvo que se marque con raw().
import { STATUSES, CHANNELS, statusLabel, getStore, getPackage, getCatalog } from "./config.js";

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join("") : v == null || v === false ? "" : esc(v));
export function html(strings, ...vals) {
  return raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ""), ""));
}

const money = (n) => `${getCatalog().currency} ${Number(n || 0).toLocaleString("es", { maximumFractionDigits: 2 })}`;
const date = (iso) => (iso ? new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "");
const badge = (status) => html`<span class="badge st-${status}">${statusLabel(status)}</span>`;
const digits = (s) => String(s || "").replace(/\D/g, "");

export function layout({ title, body, admin = false, accent, refresh }) {
  return html`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${refresh ? raw(`<meta http-equiv="refresh" content="${Number(refresh)}">`) : ""}
<link rel="stylesheet" href="/styles.css">
${accent ? raw(`<style>:root{--accent:${/^#[0-9a-f]{3,8}$/i.test(accent) ? accent : "#4f46e5"}}</style>`) : ""}
</head><body class="${admin ? "admin" : "public"}">
${admin ? html`<nav class="topnav"><a href="/admin" class="brand">⚡ Conexión Servicio</a>
  <a href="/admin">Pedidos</a><a href="/admin/pedidos/nuevo">+ Nuevo pedido</a><a href="/admin/tiendas">Tiendas</a><a href="/" target="_blank">Ver tiendas públicas ↗</a></nav>` : ""}
<main class="container">${body}</main>
</body></html>`;
}

// ---------------------------------------------------------------- Público

export function homePage(stores) {
  return layout({
    title: "Diseño de páginas web",
    body: html`<header class="hero"><h1>Páginas web profesionales para tu negocio</h1><p>Elige la especialidad que mejor encaje contigo.</p></header>
<div class="grid">${stores.map((s) => html`<a class="card store-card" href="/s/${s.slug}" style="--accent:${s.accent}">
  <h2>${s.name}</h2><p>${s.tagline}</p><span class="muted">Desde ${money(Math.min(...s.packages.map((p) => p.price)))}</span></a>`)}</div>`,
  });
}

export function storePage(store, error, form = {}) {
  const isFiverr = store.channel === "fiverr";
  return layout({
    title: store.name,
    accent: store.accent,
    body: html`<header class="hero"><h1>${store.name}</h1><p>${store.tagline}</p></header>
<section class="grid packages">${store.packages.map((p) => html`<div class="card pkg">
  <h3>${p.name}</h3><div class="price">${money(p.price)}</div>
  <p class="muted">Entrega en ${p.deliveryDays} días · ${p.revisions} revisiones</p>
  <ul>${p.features.map((f) => html`<li>${f}</li>`)}</ul></div>`)}</section>
${isFiverr
  ? html`<section class="card center"><p>Este servicio se contrata por Fiverr, con pago protegido.</p>
      ${store.externalUrl ? html`<a class="btn" href="${store.externalUrl}" target="_blank" rel="noopener">Ver el servicio en Fiverr</a>` : ""}</section>`
  : html`<section class="card" id="pedido"><h2>Haz tu pedido</h2>
  ${error ? html`<p class="alert error">${error}</p>` : ""}
  <form method="post" action="/s/${store.slug}/pedido" class="form">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label>Paquete<select name="packageId" required>${store.packages.map((p) => html`<option value="${p.id}" ${form.packageId === p.id ? raw("selected") : ""}>${p.name} — ${money(p.price)}</option>`)}</select></label>
    <div class="row"><label>Tu nombre<input name="clientName" required maxlength="120" value="${form.clientName || ""}"></label>
      <label>Email<input type="email" name="clientEmail" required maxlength="200" value="${form.clientEmail || ""}"></label></div>
    <div class="row"><label>WhatsApp / teléfono<input name="clientPhone" maxlength="40" value="${form.clientPhone || ""}" placeholder="+54 9 11 1234 5678"></label>
      <label>País<input name="clientCountry" maxlength="60" value="${form.clientCountry || ""}"></label></div>
    <div class="row"><label>Nombre del negocio<input name="businessName" required maxlength="200" value="${form.businessName || ""}"></label>
      <label>Rubro<input name="businessType" maxlength="200" value="${form.businessType || ""}" placeholder="${store.niche}"></label></div>
    <label>Cuéntanos qué necesitas<textarea name="description" required rows="5" maxlength="8000">${form.description || ""}</textarea></label>
    <label>Secciones que quieres<input name="sections" maxlength="2000" value="${form.sections || ""}" placeholder="Inicio, Servicios, Galería, Contacto..."></label>
    <div class="row"><label>Colores / estilo<input name="colors" maxlength="300" value="${form.colors || ""}"></label>
      <label>¿Tienes dominio?<input name="domain" maxlength="200" value="${form.domain || ""}" placeholder="minegocio.com"></label></div>
    <label>Webs que te gustan (referencias)<textarea name="references" rows="2" maxlength="2000">${form.references || ""}</textarea></label>
    <button class="btn">Enviar pedido</button>
  </form></section>`}`,
  });
}

export function clientPortal(order, flash) {
  const store = getStore(order.storeId);
  const pkg = getPackage(store, order.packageId);
  const idx = STATUSES.findIndex((s) => s.id === order.status);
  const steps = STATUSES.filter((s) => s.id !== "cancelado");
  return layout({
    title: `Pedido ${order.id}`,
    accent: store?.accent,
    body: html`<header class="hero small"><h1>Tu pedido ${order.id}</h1><p>${store?.name} · ${pkg?.name ?? order.packageId}</p></header>
${flash ? html`<p class="alert ok">${flash}</p>` : ""}
<section class="card"><p class="muted">Guarda este enlace: aquí verás el avance y podrás escribirnos.</p>
${order.status === "cancelado" ? html`<p>${badge("cancelado")}</p>` : html`<ol class="steps">${steps.map((s, i) => html`<li class="${i <= idx ? "done" : ""}">${s.label}</li>`)}</ol>`}
${pkg?.paymentLink && order.status !== "completado" ? html`<p><a class="btn" href="${pkg.paymentLink}" target="_blank" rel="noopener">Pagar ${money(order.price)}</a></p>` : ""}
${order.site.versions.length ? html`<p><a class="btn secondary" href="/o/${order.token}/preview" target="_blank">Ver la vista previa de tu web ↗</a></p>` : ""}
</section>
<section class="card"><h2>Mensajes</h2>${messageList(order.messages, "cliente")}
<form method="post" action="/o/${order.token}/mensaje" class="form"><label>Escríbenos (cambios, dudas, textos, fotos por enlace...)<textarea name="text" rows="4" required maxlength="8000"></textarea></label><button class="btn">Enviar mensaje</button></form></section>`,
  });
}

function messageList(messages, viewer) {
  if (!messages.length) return html`<p class="muted">Todavía no hay mensajes.</p>`;
  return html`<div class="messages">${messages.map((m) => html`<div class="msg ${m.from === viewer ? "mine" : ""}">
    <div class="meta">${m.from === "yo" ? (viewer === "yo" ? "Tú" : "Equipo") : viewer === "cliente" ? "Tú" : "Cliente"} · ${date(m.at)}${!m.read && viewer === "yo" ? raw(' <b class="new">nuevo</b>') : ""}</div>
    <div class="text">${m.text}</div></div>`)}</div>`;
}

export function errorPage(status, message, admin = false) {
  return layout({ title: `Error ${status}`, admin, body: html`<section class="card center"><h1>${status}</h1><p>${message}</p><a href="${admin ? "/admin" : "/"}">Volver</a></section>` });
}

// ---------------------------------------------------------------- Admin

export function dashboard({ stats, orders, stores, filters }) {
  const opt = (v, label, cur) => html`<option value="${v}" ${cur === v ? raw("selected") : ""}>${label}</option>`;
  return layout({
    title: "Panel · Pedidos",
    admin: true,
    body: html`<section class="kpis">
  <div class="kpi"><span>Pedidos</span><b>${stats.total}</b></div>
  <div class="kpi"><span>Nuevos</span><b>${stats.byStatus.nuevo}</b></div>
  <div class="kpi"><span>En curso</span><b>${stats.byStatus.contactado + stats.byStatus.en_progreso + stats.byStatus.revision}</b></div>
  <div class="kpi"><span>Mensajes sin leer</span><b>${stats.unread}</b></div>
  <div class="kpi"><span>Ganado (neto de comisiones)</span><b>${money(stats.earnedNet)}</b></div>
  <div class="kpi"><span>Por cobrar (en curso)</span><b>${money(stats.pipelineGross)}</b></div>
</section>
<section class="card"><form class="filters" method="get" action="/admin">
  <input name="q" placeholder="Buscar cliente, negocio, nº Fiverr..." value="${filters.q || ""}">
  <select name="storeId">${opt("", "Todas las tiendas", filters.storeId)}${stores.map((s) => opt(s.id, s.name, filters.storeId))}</select>
  <select name="status">${opt("", "Todos los estados", filters.status)}${STATUSES.map((s) => opt(s.id, s.label, filters.status))}</select>
  <select name="channel">${opt("", "Todos los canales", filters.channel)}${Object.entries(CHANNELS).map(([k, v]) => opt(k, v, filters.channel))}</select>
  <button class="btn small">Filtrar</button></form>
<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Negocio</th><th>Tienda / canal</th><th>Precio</th><th>Estado</th><th>Actualizado</th></tr></thead><tbody>
${orders.length ? orders.map((o) => {
  const unread = o.messages.filter((m) => !m.read).length;
  return html`<tr><td><a href="/admin/pedidos/${o.id}"><b>${o.id}</b></a>${unread ? html` <span class="new">${unread} ✉</span>` : ""}</td>
    <td>${o.client.name || o.client.username}</td><td>${o.brief.businessName}</td>
    <td>${getStore(o.storeId)?.name ?? o.storeId}<br><small class="muted">${CHANNELS[o.channel] ?? o.channel}${o.externalRef ? ` · #${o.externalRef}` : ""}</small></td>
    <td>${money(o.price)}</td><td>${badge(o.status)}</td><td><small>${date(o.updatedAt)}</small></td></tr>`;
}) : html`<tr><td colspan="7" class="muted center">No hay pedidos con esos filtros.</td></tr>`}
</tbody></table></div></section>
<section class="card"><h2>Por tienda</h2><div class="grid">${stores.map((s) => {
  const st = stats.byStore[s.id] ?? { count: 0, earnedNet: 0 };
  return html`<div class="mini" style="--accent:${s.accent}"><b>${s.name}</b><span>${st.count} pedidos · ${money(st.earnedNet)} neto</span></div>`;
})}</div></section>`,
  });
}

export function newOrderPage({ stores, prefill = {}, error, aiError }) {
  const f = prefill;
  const storeOpts = stores.flatMap((s) => s.packages.map((p) => ({ v: `${s.id}|${p.id}`, label: `${s.name} — ${p.name} (${money(p.price)})` })));
  const cur = f.storeId && f.packageId ? `${f.storeId}|${f.packageId}` : "";
  return layout({
    title: "Nuevo pedido",
    admin: true,
    body: html`<section class="card"><h1>Registrar pedido</h1>
<p class="muted">Úsalo para pedidos que llegan por Fiverr, Workana, WhatsApp, etc. Los pedidos de tus tiendas propias se registran solos.</p>
<details ${aiError || f.imported ? "" : raw("open")}><summary><b>🤖 Importar con IA</b> — pega aquí el texto del pedido de Fiverr (requisitos, notificación o mensajes)</summary>
<form method="post" action="/admin/pedidos/importar" class="form">
  ${aiError ? html`<p class="alert error">${aiError}</p>` : ""}
  <textarea name="raw" rows="7" required maxlength="30000" placeholder="Order #FO1234ABCD · buyer: juanperez · Standard package $150 ..."></textarea>
  <button class="btn">Extraer datos con IA</button></form></details>
</section>
<section class="card">
${error ? html`<p class="alert error">${error}</p>` : ""}
${f.imported ? html`<p class="alert ok">Datos extraídos por la IA. Revísalos antes de guardar.</p>` : ""}
<form method="post" action="/admin/pedidos" class="form">
  <div class="row"><label>Tienda y paquete<select name="storePkg" required>${storeOpts.map((o) => html`<option value="${o.v}" ${cur === o.v ? raw("selected") : ""}>${o.label}</option>`)}</select></label>
    <label>Canal<select name="channel">${Object.entries(CHANNELS).map(([k, v]) => html`<option value="${k}" ${(f.channel || "fiverr") === k ? raw("selected") : ""}>${v}</option>`)}</select></label></div>
  <div class="row"><label>Nº de pedido externo (Fiverr)<input name="externalRef" value="${f.externalRef || ""}"></label>
    <label>Precio real cobrado<input name="price" type="number" step="0.01" min="0" value="${f.price ?? ""}" placeholder="vacío = precio del paquete"></label></div>
  <div class="row"><label>Usuario en la plataforma<input name="clientUsername" value="${f.clientUsername || ""}"></label>
    <label>Nombre del cliente<input name="clientName" value="${f.clientName || ""}"></label></div>
  <div class="row"><label>Email (solo si NO es de Fiverr)<input name="clientEmail" type="email" value="${f.clientEmail || ""}"></label>
    <label>WhatsApp (solo si NO es de Fiverr)<input name="clientPhone" value="${f.clientPhone || ""}"></label></div>
  <div class="row"><label>País<input name="clientCountry" value="${f.clientCountry || ""}"></label><label>Fecha de entrega<input name="deadline" type="date" value="${f.deadline || ""}"></label></div>
  <div class="row"><label>Negocio<input name="businessName" value="${f.businessName || ""}"></label><label>Rubro<input name="businessType" value="${f.businessType || ""}"></label></div>
  <label>Descripción / requisitos<textarea name="description" rows="5">${f.description || ""}</textarea></label>
  <label>Secciones<input name="sections" value="${f.sections || ""}"></label>
  <div class="row"><label>Colores / estilo<input name="colors" value="${f.colors || ""}"></label><label>Dominio<input name="domain" value="${f.domain || ""}"></label></div>
  <label>Referencias<textarea name="references" rows="2">${f.references || ""}</textarea></label>
  <label>Notas internas<textarea name="notes" rows="2">${f.notes || ""}</textarea></label>
  <button class="btn">Guardar pedido</button>
</form></section>`,
  });
}

function contactLinks(order) {
  const c = order.client;
  const draft = order.ai.draftReply || `Hola ${c.name || ""}, te escribo por tu pedido ${order.id}.`;
  const links = [];
  if (order.channel === "fiverr") {
    if (c.username) links.push(html`<a class="btn small" href="https://www.fiverr.com/inbox/${encodeURIComponent(c.username)}" target="_blank" rel="noopener">Abrir chat en Fiverr</a>`);
  } else {
    if (digits(c.phone)) links.push(html`<a class="btn small wa" href="https://wa.me/${digits(c.phone)}?text=${encodeURIComponent(draft)}" target="_blank" rel="noopener">WhatsApp</a>`);
    if (c.email) links.push(html`<a class="btn small secondary" href="mailto:${c.email}?subject=${encodeURIComponent(`Tu pedido ${order.id}`)}&body=${encodeURIComponent(draft)}">Email</a>`);
  }
  return links;
}

export function orderDetail(order, { baseUrl, flash, error }) {
  const store = getStore(order.storeId);
  const pkg = getPackage(store, order.packageId);
  const c = order.client, b = order.brief, job = order.ai.job;
  const portal = `${baseUrl}/o/${order.token}`;
  const running = job?.status === "running";
  const field = (label, v) => (v ? html`<dt>${label}</dt><dd>${v}</dd>` : "");
  return layout({
    title: `${order.id} · ${b.businessName || c.name}`,
    admin: true,
    refresh: running ? 8 : undefined,
    body: html`<header class="order-head"><div><h1>${order.id} ${badge(order.status)}</h1>
  <p class="muted">${store?.name} · ${pkg?.name ?? order.packageId} · ${money(order.price)} (neto ${money(order.price * (1 - order.feePercent / 100))}) · ${CHANNELS[order.channel] ?? order.channel}${order.externalRef ? ` #${order.externalRef}` : ""} · creado ${date(order.createdAt)}</p></div>
  <form method="post" action="/admin/pedidos/${order.id}/estado" class="inline"><select name="status">${STATUSES.map((s) => html`<option value="${s.id}" ${s.id === order.status ? raw("selected") : ""}>${s.label}</option>`)}</select><button class="btn small">Cambiar estado</button></form></header>
${flash ? html`<p class="alert ok">${flash}</p>` : ""}${error ? html`<p class="alert error">${error}</p>` : ""}
${job ? html`<p class="alert ${job.status === "error" ? "error" : job.status === "running" ? "info" : "ok"}">🤖 IA · ${job.type}: ${job.status === "running" ? "trabajando… (la página se actualiza sola)" : job.status === "ok" ? "listo" : job.error}</p>` : ""}
<div class="cols">
<div>
<section class="card"><h2>Cliente</h2><dl>
  ${field("Nombre", c.name)}${field("Usuario", c.username)}${field("Email", c.email)}${field("WhatsApp / tel.", c.phone)}${field("País", c.country)}</dl>
  <div class="actions">${contactLinks(order)}</div>
  ${order.channel === "fiverr" ? html`<p class="muted small">Pedido de Fiverr: comunícate y entrega por Fiverr (sus reglas prohíben llevar al cliente fuera de la plataforma). Aquí registras la conversación y usas la IA para redactar.</p>`
    : html`<p class="muted small">Portal del cliente (envíaselo): <a href="${portal}" target="_blank">${portal}</a></p>`}
</section>
<section class="card"><h2>Brief</h2><dl>
  ${field("Negocio", b.businessName)}${field("Rubro", b.businessType)}${field("Descripción", b.description)}${field("Secciones", b.sections)}${field("Colores / estilo", b.colors)}${field("Referencias", b.references)}${field("Dominio", b.domain)}${field("Entrega", b.deadline)}</dl></section>
<section class="card"><h2>Mensajes</h2>${messageList(order.messages, "yo")}
<form method="post" action="/admin/pedidos/${order.id}/mensaje" class="form">
  <label>${order.channel === "fiverr" ? "Registrar mensaje" : "Responder (el cliente lo verá en su portal)"}<textarea name="text" rows="5" required>${order.ai.draftReply}</textarea></label>
  <div class="actions">
    <button class="btn" name="from" value="yo">${order.channel === "fiverr" ? "Registrar mensaje enviado" : "Enviar al cliente"}</button>
    <button class="btn secondary" name="from" value="cliente">Registrar como mensaje del cliente</button></div></form>
<form method="post" action="/admin/pedidos/${order.id}/ia/respuesta" class="form inline-ai"><input name="intent" placeholder="Objetivo (opcional): pedir fotos, avisar entrega, pedir reseña..."><button class="btn small ai" ${running ? raw("disabled") : ""}>🤖 Redactar respuesta con IA</button></form>
</section>
</div>
<div>
<section class="card"><h2>🤖 Asistente IA</h2>
  <div class="actions">
    <form method="post" action="/admin/pedidos/${order.id}/ia/resumen"><button class="btn small ai" ${running ? raw("disabled") : ""}>Analizar pedido</button></form>
    <form method="post" action="/admin/pedidos/${order.id}/ia/sitio"><button class="btn small ai" ${running ? raw("disabled") : ""}>${order.site.versions.length ? "Regenerar sitio desde cero" : "Generar el sitio web"}</button></form>
  </div>
  ${order.ai.summary ? html`<pre class="summary">${order.ai.summary}</pre>` : html`<p class="muted">Pulsa “Analizar pedido” para obtener resumen, preguntas para el cliente y estructura propuesta.</p>`}
</section>
<section class="card"><h2>Sitio web</h2>
${order.site.versions.length ? html`<p><a class="btn small" href="/admin/pedidos/${order.id}/sitio" target="_blank">Ver versión actual ↗</a>
  <a class="btn small secondary" href="/admin/pedidos/${order.id}/sitio?descargar=1">Descargar index.html</a></p>
  <form method="post" action="/admin/pedidos/${order.id}/ia/cambios" class="form"><label>Cambios a aplicar con IA<textarea name="instruction" rows="4" required placeholder="Cambiar el color principal a verde, agregar sección de testimonios, poner el teléfono +54..."></textarea></label>
  <button class="btn small ai" ${running ? raw("disabled") : ""}>🤖 Aplicar cambios</button></form>
  <ul class="versions">${[...order.site.versions].reverse().map((v) => html`<li><a href="/admin/pedidos/${order.id}/sitio?v=${v.n}" target="_blank">v${v.n}</a> · ${date(v.at)} — ${v.note}</li>`)}</ul>`
  : html`<p class="muted">Aún no hay sitio. Genéralo con IA o edita <code>sites/${order.id}/index.html</code> y regístralo con la CLI.</p>`}
</section>
<section class="card"><h2>Notas internas</h2><form method="post" action="/admin/pedidos/${order.id}/notas" class="form"><textarea name="notes" rows="4">${order.notes}</textarea><button class="btn small secondary">Guardar notas</button></form></section>
<section class="card"><h2>Historial</h2><ul class="history">${[...order.history].reverse().map((h) => html`<li><small>${date(h.at)}</small> ${h.event}</li>`)}</ul></section>
</div></div>`,
  });
}

export function storesPage({ stores, gigs, flash, error, running }) {
  return layout({
    title: "Tiendas",
    admin: true,
    refresh: running ? 8 : undefined,
    body: html`<h1>Tiendas</h1>
<p class="muted">Las tiendas se configuran en <code>config/stores.json</code> (precios, paquetes, enlaces de pago, enlace del gig). Aquí puedes generar con IA los textos para publicarlas.</p>
${flash ? html`<p class="alert ok">${flash}</p>` : ""}${error ? html`<p class="alert error">${error}</p>` : ""}
${stores.map((s) => {
  const g = gigs[s.id];
  return html`<section class="card" style="--accent:${s.accent}"><h2>${s.name} <small class="muted">${CHANNELS[s.channel] ?? s.channel} · comisión ${s.feePercent}%</small></h2>
  <p>${s.tagline}</p>
  <p><a href="/s/${s.slug}" target="_blank">Página pública /s/${s.slug} ↗</a>${s.externalUrl ? html` · <a href="${s.externalUrl}" target="_blank" rel="noopener">Enlace externo ↗</a>` : ""}</p>
  <form method="post" action="/admin/tiendas/${s.id}/ia/gig" class="form inline-ai"><input name="extra" placeholder="Indicaciones (opcional): en inglés, enfocado a dentistas..."><button class="btn small ai" ${running === s.id ? raw("disabled") : ""}>🤖 ${g ? "Regenerar" : "Generar"} textos del gig</button></form>
  ${running === s.id ? html`<p class="alert info">🤖 Generando… (la página se actualiza sola)</p>` : ""}
  ${g ? html`<div class="gig"><h3>${g.title}</h3><pre class="summary">${g.description}</pre>
    <p><b>Etiquetas:</b> ${g.tags.join(", ")}</p>
    <p><b>Paquetes:</b></p><ul>${g.packages.map((p) => html`<li><b>${p.name}</b>: ${p.title} — ${p.description}</li>`)}</ul>
    <p><b>Preguntas al comprador:</b></p><ul>${g.requirements.map((r) => html`<li>${r}</li>`)}</ul>
    <p><b>FAQ:</b></p><dl>${g.faq.map((f) => html`<dt>${f.q}</dt><dd>${f.a}</dd>`)}</dl>
    <p class="muted small">Generado ${date(g.generatedAt)}</p></div>` : ""}
</section>`;
})}`,
  });
}
