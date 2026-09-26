// Páginas públicas de venta: portada, tiendas por nicho, términos y privacidad, robots.txt y sitemap.
// Todo el contenido sale de config/stores.json (marca, planes, extras, FAQ, testimonios, portafolio).
import { html, raw } from "./views.js";
import { getCatalog, getBrand, getFeaturedProject, extrasFor, isMarketplace } from "./config.js";

const money = (n) => `${getCatalog().currency} ${Number(n || 0).toLocaleString("es", { maximumFractionDigits: 2 })}`;
const digits = (s) => String(s || "").replace(/\D/g, "");
const safeColor = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : fallback);
const ownStores = () => getCatalog().stores.filter((s) => !isMarketplace(s.channel));

function whatsappUrl(text) {
  const n = digits(getCatalog().contact.whatsapp);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text || `Hola ${getBrand().name}, vi su página y quiero una web para mi negocio.`)}` : "";
}

// ---- Estructura común ------------------------------------------------------

function page({ title, description, path = "/", base = "", accent, body, noindex = false }) {
  const brand = getBrand();
  const color = safeColor(accent, safeColor(brand.accent, "#1d9a5b"));
  const image = getFeaturedProject()?.images?.[0]?.src;
  const wa = whatsappUrl();
  return html`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex">') : ""}
${base ? html`<link rel="canonical" href="${base}${path}">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
${base && image ? html`<meta property="og:image" content="${base}${image}">` : ""}
<meta name="theme-color" content="#0c0f0d">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/tienda.css">
${raw(`<style>:root{--brand:${color}}</style>`)}
</head><body class="sf">
<header class="sf-nav"><div class="sf-wrap sf-nav-row">
  <a class="sf-logo" href="/"><span class="sf-mark" aria-hidden="true">${brand.name.slice(0, 1)}</span>${brand.name}</a>
  <nav class="sf-links" aria-label="Principal"><a href="/#especialidades">Planes</a><a href="/#trabajo">Trabajo</a><a href="/#proceso">Cómo trabajamos</a><a href="/#preguntas">Preguntas</a></nav>
  ${wa ? html`<a class="sf-btn sf-btn-sm" href="${wa}" target="_blank" rel="noopener">Escríbenos</a>` : html`<a class="sf-btn sf-btn-sm" href="/#especialidades">Pedir mi web</a>`}
</div></header>
<main>${body}</main>
<footer class="sf-footer"><div class="sf-wrap sf-footer-grid">
  <div><p class="sf-logo sf-logo-foot"><span class="sf-mark" aria-hidden="true">${brand.name.slice(0, 1)}</span>${brand.name}</p><p class="sf-muted">${brand.tagline}</p></div>
  <div><p class="sf-foot-title">Planes</p>${ownStores().map((s) => html`<a href="/s/${s.slug}">${s.name}</a>`)}</div>
  <div><p class="sf-foot-title">Contacto</p>
    ${wa ? html`<a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
    ${brand.email ? html`<a href="mailto:${brand.email}">${brand.email}</a>` : ""}
    <a href="/terminos">Términos del servicio</a><a href="/privacidad">Privacidad</a></div>
</div><p class="sf-wrap sf-copy">© ${new Date().getFullYear()} ${brand.name}</p></footer>
${wa ? html`<a class="sf-wa" href="${wa}" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.2-.7-2.7-1.1-4.4-3.8-4.5-4-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9.9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg></a>` : ""}
<script src="/tienda.js" defer></script>
</body></html>`;
}

const check = raw('<svg class="sf-check" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.7 13.3 4.4 10l-1.2 1.2 4.5 4.5 9.1-9.1-1.2-1.2z"/></svg>');

// Hechos reales del servicio (salen de cómo funciona el sistema, no son promesas inventadas).
function trustBar() {
  const deposit = getCatalog().payments.depositPercent;
  const items = [
    ["Ves tu web antes de pagar el total", deposit ? `Pagas el ${deposit}% para empezar y el resto cuando apruebas el diseño.` : "Apruebas el diseño antes del pago final."],
    ["Revisiones incluidas", "Pides cambios desde tu portal hasta dejarla como quieres."],
    ["Sigues tu pedido en vivo", "Un portal privado con el avance, tus archivos y los mensajes."],
    ["La web es tuya", "Te entregamos todos los archivos, lista para publicar."],
  ];
  return html`<ul class="sf-trust">${items.map(([t, d]) => html`<li>${check}<div><b>${t}</b><span>${d}</span></div></li>`)}</ul>`;
}

function process() {
  const steps = [
    ["Elige tu plan", "Cuéntanos de tu negocio en 3 minutos. No pagas nada todavía."],
    ["Envía tu logo y fotos", `Te escribimos en menos de ${getBrand().responseTime} y lo subes todo desde tu portal.`],
    ["Revisa la vista previa", "Ves tu web funcionando y pides los cambios que quieras."],
    ["Recibe tu web", "La apruebas, pagas el saldo y te la entregamos publicada o en archivos."],
  ];
  return html`<section class="sf-section" id="proceso"><div class="sf-wrap">
  <p class="sf-eyebrow">Cómo trabajamos</p><h2>De la idea a tu web publicada, sin vueltas.</h2>
  <ol class="sf-steps">${steps.map(([t, d], i) => html`<li><span class="sf-step-num">0${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`)}</ol>
</div></section>`;
}

function showcase() {
  const p = getFeaturedProject();
  if (!p) return "";
  const url = /^https:\/\//i.test(p.url || "") ? p.url : "";
  return html`<section class="sf-section sf-dark" id="trabajo"><div class="sf-wrap sf-showcase">
  <div>
    <p class="sf-eyebrow">Proyecto real · ${p.category}</p>
    <h2>${p.title}</h2>
    <p class="sf-lead">${p.summary}</p>
    <ul class="sf-list">${(p.highlights || []).map((h) => html`<li>${check}${h}</li>`)}</ul>
    ${url ? html`<a class="sf-btn" href="${url}" target="_blank" rel="noopener">Ver el sitio en vivo ↗</a>` : ""}
  </div>
  <div class="sf-shots">${(p.images || []).slice(0, 3).map((img, i) => html`<img class="sf-shot sf-shot-${i}" src="${img.src}" alt="${img.alt || p.title}" loading="lazy" width="1440" height="900">`)}</div>
</div></section>`;
}

function testimonials() {
  const list = getCatalog().testimonials.filter((t) => t?.text && t?.name);
  if (!list.length) return "";
  return html`<section class="sf-section"><div class="sf-wrap">
  <p class="sf-eyebrow">Clientes</p><h2>Lo que dicen de nosotros</h2>
  <div class="sf-grid3">${list.slice(0, 6).map((t) => html`<figure class="sf-card sf-quote"><blockquote>“${t.text}”</blockquote><figcaption><b>${t.name}</b>${t.business ? html` · ${t.business}` : ""}</figcaption></figure>`)}</div>
</div></section>`;
}

function faq() {
  const list = getCatalog().faq;
  if (!list.length) return "";
  return html`<section class="sf-section" id="preguntas"><div class="sf-wrap sf-narrow">
  <p class="sf-eyebrow">Preguntas frecuentes</p><h2>Todo claro antes de empezar.</h2>
  <div class="sf-faq">${list.map((f, i) => html`<details ${i === 0 ? raw("open") : ""}><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div>
</div></section>`;
}

function finalCta(target = "/#especialidades", label = "Ver planes y precios") {
  const wa = whatsappUrl();
  return html`<section class="sf-section sf-cta"><div class="sf-wrap sf-cta-box">
  <h2>¿Listo para tener tu web?</h2>
  <p>Cuéntanos de tu negocio hoy y en pocos días estarás recibiendo clientes desde internet.</p>
  <div class="sf-actions"><a class="sf-btn" href="${target}">${label}</a>${wa ? html`<a class="sf-btn sf-btn-ghost" href="${wa}" target="_blank" rel="noopener">Hablar por WhatsApp</a>` : ""}</div>
</div></section>`;
}

// ---- Portada ----------------------------------------------------------------

export function homePage({ base } = {}) {
  const brand = getBrand();
  const stores = ownStores();
  const wa = whatsappUrl();
  return page({
    title: `${brand.name} — ${brand.tagline || "Diseño de páginas web"}`,
    description: brand.description || brand.tagline,
    base,
    body: html`<section class="sf-hero"><div class="sf-wrap">
  <p class="sf-eyebrow">Diseño y desarrollo web</p>
  <h1>${brand.tagline || "Páginas web profesionales para tu negocio"}</h1>
  <p class="sf-lead">${brand.description}</p>
  <div class="sf-actions"><a class="sf-btn" href="#especialidades">Ver planes y precios</a>${wa ? html`<a class="sf-btn sf-btn-ghost" href="${wa}" target="_blank" rel="noopener">Hablar por WhatsApp</a>` : html`<a class="sf-btn sf-btn-ghost" href="#trabajo">Ver trabajo real</a>`}</div>
  ${trustBar()}
</div></section>
<section class="sf-section" id="especialidades"><div class="sf-wrap">
  <p class="sf-eyebrow">Planes por especialidad</p><h2>Elige la web pensada para tu tipo de negocio.</h2>
  <div class="sf-grid3">${stores.map((s) => html`<a class="sf-card sf-store" href="/s/${s.slug}" style="--brand:${safeColor(s.accent, "#1d9a5b")}">
    <h3>${s.name}</h3><p>${s.tagline}</p>
    <p class="sf-from">Desde <b>${money(Math.min(...s.packages.map((p) => p.price)))}</b></p>
    <span class="sf-link">Ver planes →</span></a>`)}
    <a class="sf-card sf-store sf-custom" href="${wa || (stores[0] ? `/s/${stores[0].slug}#pedido` : "#preguntas")}" ${wa ? raw('target="_blank" rel="noopener"') : ""}>
      <h3>¿Otro tipo de negocio?</h3><p>Tiendas online, landing pages para campañas, portafolios o proyectos a medida. Cuéntanos qué necesitas y te cotizamos en menos de ${brand.responseTime}.</p>
      <p class="sf-from">Cotización <b>sin costo</b></p>
      <span class="sf-link">${wa ? "Cotizar por WhatsApp →" : "Cotizar →"}</span></a></div>
</div></section>
${showcase()}
${process()}
${testimonials()}
${faq()}
${finalCta()}`,
  });
}

// ---- Tienda por nicho (planes + formulario de pedido) -----------------------

function planCard(store, p, selectable) {
  return html`<article class="sf-card sf-plan ${p.popular ? "sf-popular" : ""}">
  ${p.popular ? html`<span class="sf-badge">Más elegido</span>` : ""}
  <h3>${p.name}</h3>
  <p class="sf-price">${money(p.price)}</p>
  <p class="sf-muted">Entrega en ${p.deliveryDays} días · ${p.revisions} ${p.revisions === 1 ? "revisión" : "revisiones"}</p>
  <ul class="sf-list">${p.features.map((f) => html`<li>${check}${f}</li>`)}</ul>
  ${selectable ? html`<a class="sf-btn ${p.popular ? "" : "sf-btn-soft"}" href="?plan=${p.id}#pedido" data-plan="${p.id}">Elegir ${p.name}</a>`
    : store.externalUrl ? html`<a class="sf-btn sf-btn-soft" href="${store.externalUrl}" target="_blank" rel="noopener">Contratar en Fiverr</a>` : ""}
</article>`;
}

function orderForm(store, error, form) {
  const deposit = getCatalog().payments.depositPercent || 0;
  const selected = store.packages.find((p) => p.id === form.packageId) ?? store.packages.find((p) => p.popular) ?? store.packages[0];
  const chosen = new Set([].concat(form.extras || []));
  const allExtras = getCatalog().extras;
  const v = (k) => form[k] || "";
  return html`<section class="sf-section sf-order" id="pedido"><div class="sf-wrap">
  <p class="sf-eyebrow">Pedido</p><h2>Haz tu pedido</h2>
  <p class="sf-lead">Toma 3 minutos. <b>No pagas nada ahora:</b> te escribimos en menos de ${getBrand().responseTime} para confirmar los detalles y enviarte el enlace del ${deposit ? `anticipo (${deposit}%)` : "pago"}.</p>
  ${error ? html`<p class="sf-alert">${error}</p>` : ""}
  <form method="post" action="/s/${store.slug}/pedido" class="sf-form" id="form-pedido" data-currency="${getCatalog().currency}" data-deposit="${deposit}">
    <input type="text" name="website" class="sf-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="sf-form-main">
      <fieldset><legend>1. Tu plan</legend>
        <label>Plan<select name="packageId" id="plan" required>${store.packages.map((p) => html`<option value="${p.id}" data-price="${p.price}" data-days="${p.deliveryDays}" data-revisions="${p.revisions}" ${p.id === selected.id ? raw("selected") : ""}>${p.name} — ${money(p.price)}</option>`)}</select></label>
        ${allExtras.length ? html`<p class="sf-label">Extras opcionales</p>
        <div class="sf-extras">${allExtras.map((e) => {
          const hidden = (e.notFor || []).includes(selected.id);
          return html`<label class="sf-extra" data-not-for="${(e.notFor || []).join(",")}" ${hidden ? raw("hidden") : ""}>
            <input type="checkbox" name="extras" value="${e.id}" data-price="${e.price}" data-recurring="${e.recurring || ""}" data-factor="${e.deliveryFactor || 1}" data-revisions="${e.extraRevisions || 0}" ${chosen.has(e.id) && !hidden ? raw("checked") : ""}>
            <span><b>${e.name}</b> <em>+${money(e.price)}${e.recurring ? ` / ${e.recurring}` : ""}</em><small>${e.description}</small></span></label>`;
        })}</div>` : ""}
      </fieldset>
      <fieldset><legend>2. Tu negocio</legend>
        <div class="sf-row"><label>Nombre del negocio *<input name="businessName" required maxlength="200" value="${v("businessName")}"></label>
          <label>Rubro<input name="businessType" maxlength="200" value="${v("businessType")}" placeholder="${store.niche}"></label></div>
        <label>¿Qué necesitas? *<textarea name="description" required rows="4" maxlength="8000" placeholder="A qué se dedica tu negocio, qué quieres lograr con la web y qué debe tener.">${v("description")}</textarea></label>
        <div class="sf-row"><label>Secciones<input name="sections" maxlength="2000" value="${v("sections")}" placeholder="Inicio, Servicios, Galería, Contacto"></label>
          <label>Colores o estilo<input name="colors" maxlength="300" value="${v("colors")}" placeholder="Ej.: verde y blanco, moderno"></label></div>
        <div class="sf-row"><label>¿Tienes dominio?<input name="domain" maxlength="200" value="${v("domain")}" placeholder="minegocio.com (opcional)"></label>
          <label>Webs que te gustan<input name="references" maxlength="2000" value="${v("references")}" placeholder="Enlaces de referencia (opcional)"></label></div>
      </fieldset>
      <fieldset><legend>3. Tus datos</legend>
        <div class="sf-row"><label>Tu nombre *<input name="clientName" required maxlength="120" autocomplete="name" value="${v("clientName")}"></label>
          <label>Email *<input type="email" name="clientEmail" required maxlength="200" autocomplete="email" value="${v("clientEmail")}"></label></div>
        <div class="sf-row"><label>WhatsApp<input name="clientPhone" maxlength="40" autocomplete="tel" value="${v("clientPhone")}" placeholder="+56 9 1234 5678"></label>
          <label>País<input name="clientCountry" maxlength="60" autocomplete="country-name" value="${v("clientCountry")}"></label></div>
        <label>Usuario de Discord (opcional)<input name="clientDiscord" maxlength="60" value="${v("clientDiscord")}"></label>
      </fieldset>
      <label class="sf-terms"><input type="checkbox" name="acepto" value="1" required ${form.acepto ? raw("checked") : ""}><span>Acepto los <a href="/terminos" target="_blank">términos del servicio</a> y la <a href="/privacidad" target="_blank">política de privacidad</a>.</span></label>
    </div>
    <aside class="sf-summary" aria-live="polite">
      <p class="sf-summary-title">Resumen</p>
      <div id="resumen-lineas"><p><span>${selected.name}</span><b>${money(selected.price)}</b></p></div>
      <p class="sf-total"><span>Total</span><b id="resumen-total">${money(selected.price)}</b></p>
      ${deposit ? html`<p class="sf-muted"><span>Anticipo para empezar (${deposit}%)</span> <b id="resumen-anticipo">${money((selected.price * deposit) / 100)}</b></p>` : ""}
      <p class="sf-muted">Entrega estimada: <b id="resumen-dias">${selected.deliveryDays} días</b></p>
      <p class="sf-muted" id="resumen-mensual"></p>
      <button class="sf-btn sf-btn-block">Enviar pedido</button>
      <p class="sf-small">Al enviarlo recibes un enlace privado para seguir tu pedido y subir tu logo y fotos.</p>
    </aside>
  </form>
</div></section>`;
}

export function storePage(store, { error, form = {}, base } = {}) {
  const brand = getBrand();
  const selectable = !isMarketplace(store.channel);
  const wa = whatsappUrl(`Hola ${brand.name}, vi sus planes de "${store.name}" y quiero más información.`);
  return page({
    title: `${store.name} — ${brand.name}`,
    description: `${store.tagline}. Planes desde ${money(Math.min(...store.packages.map((p) => p.price)))}.`,
    path: `/s/${store.slug}`,
    base,
    accent: store.accent,
    noindex: !selectable,
    body: html`<section class="sf-hero sf-hero-store"><div class="sf-wrap">
  <p class="sf-eyebrow">${store.niche}</p>
  <h1>${store.name}</h1>
  <p class="sf-lead">${store.tagline}</p>
  <div class="sf-actions"><a class="sf-btn" href="#planes">Ver planes</a>${selectable && wa ? html`<a class="sf-btn sf-btn-ghost" href="${wa}" target="_blank" rel="noopener">Consultar por WhatsApp</a>` : ""}</div>
  ${trustBar()}
</div></section>
<section class="sf-section" id="planes"><div class="sf-wrap">
  <p class="sf-eyebrow">Planes</p><h2>Precios claros, sin sorpresas.</h2>
  <div class="sf-grid3 sf-plans">${store.packages.map((p) => planCard(store, p, selectable))}</div>
  ${selectable && extrasFor(null).length ? html`<p class="sf-muted sf-center">Puedes sumar extras como entrega express, textos o mantenimiento mensual al hacer tu pedido.</p>` : ""}
</div></section>
${showcase()}
${process()}
${testimonials()}
${faq()}
${selectable ? orderForm(store, error, form) : html`<section class="sf-section"><div class="sf-wrap sf-center"><p>Este servicio se contrata por Fiverr, con pago protegido por la plataforma.</p>
  ${store.externalUrl ? html`<a class="sf-btn" href="${store.externalUrl}" target="_blank" rel="noopener">Ver el servicio en Fiverr</a>` : ""}</div></section>`}`,
  });
}

// ---- Legales ------------------------------------------------------------------

export function legalPage(kind, { base } = {}) {
  const brand = getBrand();
  const deposit = getCatalog().payments.depositPercent || 0;
  const contacto = brand.email ? html`<a href="mailto:${brand.email}">${brand.email}</a>` : html`los canales de contacto de esta página`;
  const updated = "26 de septiembre de 2026";
  const body = kind === "terminos"
    ? html`<h1>Términos del servicio</h1><p class="sf-muted">Última actualización: ${updated}</p>
<h2>1. El servicio</h2><p>${brand.name} diseña y desarrolla páginas web según el plan contratado y la información que nos entregas. Lo que incluye cada plan (páginas, revisiones y plazo) es lo que se indica en su descripción al momento del pedido.</p>
<h2>2. Pagos</h2><p>${deposit ? `Para comenzar se paga un anticipo del ${deposit}% del total. El saldo se paga cuando apruebas el diseño y antes de recibir los archivos finales.` : "El pago se realiza según lo acordado al confirmar el pedido."} Los extras mensuales (como el mantenimiento) se cobran por separado cada mes y puedes cancelarlos cuando quieras.</p>
<h2>3. Plazos</h2><p>El plazo de entrega empieza a contar cuando recibimos el anticipo y la información necesaria (logo, fotos y datos del negocio). Si faltan datos o hay demoras en las respuestas, el plazo se extiende en la misma medida.</p>
<h2>4. Revisiones</h2><p>Cada plan incluye un número de revisiones. Una revisión es un conjunto de cambios que envías de una vez desde tu portal. Los cambios adicionales o que modifiquen lo acordado (por ejemplo, nuevas secciones) pueden tener un costo extra que te informaremos antes.</p>
<h2>5. Contenido</h2><p>Eres responsable de tener los derechos sobre los textos, logos e imágenes que nos entregues. Si usamos imágenes de bancos gratuitos, son de licencia libre para uso comercial.</p>
<h2>6. Propiedad</h2><p>Una vez pagado el total, la página y sus archivos son tuyos. Podemos mostrar el trabajo en nuestro portafolio, salvo que nos pidas lo contrario.</p>
<h2>7. Cancelaciones</h2><p>Si cancelas antes de que comencemos a trabajar, te devolvemos el anticipo completo. Una vez entregada la primera vista previa, el anticipo cubre el trabajo realizado y no es reembolsable.</p>
<h2>8. Contacto</h2><p>Para cualquier consulta escríbenos a ${contacto}.</p>`
    : html`<h1>Política de privacidad</h1><p class="sf-muted">Última actualización: ${updated}</p>
<h2>Qué datos pedimos</h2><p>Tu nombre, email, teléfono o WhatsApp, país, los datos de tu negocio y los archivos que subas (logo, fotos). Solo pedimos lo necesario para hacer tu página y comunicarnos contigo.</p>
<h2>Para qué los usamos</h2><p>Para preparar, entregar y dar soporte a tu proyecto, enviarte avisos sobre tu pedido y cobrar el servicio. No vendemos ni compartimos tus datos con fines publicitarios.</p>
<h2>Servicios que nos ayudan</h2><p>Usamos proveedores para operar: alojamiento del sitio, envío de emails, pagos (PayPal, Mercado Pago u otros que elijas) y herramientas de inteligencia artificial (Anthropic) que nos ayudan a redactar y construir tu página a partir del brief y las imágenes que envías. Estos proveedores tratan los datos solo para prestar su servicio.</p>
<h2>Cuánto tiempo los guardamos</h2><p>Mientras dure el proyecto y el tiempo necesario para soporte, facturación y obligaciones legales. Puedes pedir que los borremos antes.</p>
<h2>Tus derechos</h2><p>Puedes pedir acceso, corrección o eliminación de tus datos escribiéndonos a ${contacto}.</p>`;
  return page({
    title: `${kind === "terminos" ? "Términos del servicio" : "Política de privacidad"} — ${brand.name}`,
    description: `${kind === "terminos" ? "Términos del servicio" : "Política de privacidad"} de ${brand.name}.`,
    path: `/${kind}`,
    base,
    body: html`<section class="sf-section"><div class="sf-wrap sf-narrow sf-legal">${body}</div></section>`,
  });
}

// ---- SEO ------------------------------------------------------------------------

export const robotsTxt = (base) => `User-agent: *\nDisallow: /admin\nDisallow: /o/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ""}`;

export function sitemapXml(base) {
  const urls = ["/", ...ownStores().map((s) => `/s/${s.slug}`), "/terminos", "/privacidad"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n")}\n</urlset>\n`;
}
