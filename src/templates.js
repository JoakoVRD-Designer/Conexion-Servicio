// "Plantilla rápida": genera un sitio completo sin IA (gratis y al instante) a partir del brief
// y de los archivos del cliente. Sirve como primera versión, como respaldo si no hay clave de IA,
// o como base para que Claude Code o tú lo personalicen.
import { getStore, getPackage } from "./config.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const COLOR_WORDS = [
  [/verde|green/i, "#2e7d4f"], [/azul|blue|marino/i, "#1f4e8c"], [/celeste|cian|turquesa|aqua/i, "#138a9e"],
  [/rojo|red|carmes/i, "#c0392b"], [/naranja|orange|mandarina/i, "#e8710a"], [/amarill|yellow|mostaza/i, "#c99a06"],
  [/morado|violeta|lila|purple/i, "#6c3fb5"], [/rosa|pink|fucsia/i, "#c2185b"], [/dorad|gold/i, "#b8860b"],
  [/marr[oó]n|caf[eé]|chocolate|terracota/i, "#8d5a3b"], [/negro|black|oscuro|dark/i, "#1f2328"], [/gris|gray|grey/i, "#5b6470"],
  [/c[aá]lid|warm/i, "#c8642d"], [/fr[ií]o|cool/i, "#2f6f9f"], [/pastel/i, "#d78aa5"], [/elegant|lujo|luxury/i, "#1f2328"],
];

export function pickColor(text, fallback = "#4f46e5") {
  for (const [re, hex] of COLOR_WORDS) if (re.test(text || "")) return hex;
  return fallback;
}

// Textos por tipo de negocio (se elige por palabras clave del rubro / nicho).
const NICHES = [
  { re: /restaur|comida|caf[eé]|bar\b|pizz|panad|pasteler|cocina|food|burger|parrill|sushi/i,
    hero: "Sabores que se recuerdan", cta: "Reservar / Pedir por WhatsApp",
    services: [["Nuestra carta", "Platos preparados al momento con ingredientes frescos de temporada."], ["Reservas", "Asegura tu mesa en segundos y vive una experiencia sin esperas."], ["Pedidos para llevar", "Haz tu pedido por WhatsApp y retíralo listo o recíbelo en casa."]] },
  { re: /abogad|legal|jur[ií]d|notar|contador|contab|consult|asesor/i,
    hero: "Asesoría profesional en la que puedes confiar", cta: "Agendar una consulta",
    services: [["Consulta inicial", "Analizamos tu caso y te explicamos tus opciones con claridad."], ["Acompañamiento", "Te representamos y gestionamos cada paso del proceso."], ["Atención cercana", "Respuestas rápidas y seguimiento personalizado."]] },
  { re: /m[eé]dic|dent|odont|cl[ií]nic|salud|psic|nutri|fisio|terap|veterin/i,
    hero: "Cuidamos de tu salud con cercanía", cta: "Pedir turno",
    services: [["Consultas", "Atención profesional y personalizada para cada paciente."], ["Tratamientos", "Soluciones basadas en evidencia y tecnología actual."], ["Turnos online", "Reserva tu turno de forma rápida y sencilla."]] },
  { re: /gym|gimnas|fitness|entren|yoga|pilates|deport|crossfit/i,
    hero: "Entrena, progresa y siéntete mejor", cta: "Reservar clase de prueba",
    services: [["Clases grupales", "Rutinas motivadoras para todos los niveles."], ["Entrenamiento personal", "Planes a tu medida para lograr tus objetivos."], ["Horarios flexibles", "Entrena cuando mejor te quede."]] },
  { re: /belleza|est[eé]tic|peluquer|barber|spa|u[ñn]as|makeup|maquill/i,
    hero: "Tu mejor versión empieza aquí", cta: "Reservar turno",
    services: [["Servicios de belleza", "Profesionales con experiencia y productos de calidad."], ["Tratamientos", "Cuidado personalizado para ti."], ["Reservas online", "Elige día y hora en segundos."]] },
  { re: /tienda|shop|ropa|moda|product|venta|store|boutique/i,
    hero: "Productos que te van a encantar", cta: "Ver productos",
    services: [["Catálogo", "Descubre nuestros productos destacados."], ["Envíos", "Recibe tu compra donde estés."], ["Atención personalizada", "Te ayudamos a elegir lo mejor para ti."]] },
];
const DEFAULT_NICHE = {
  hero: "Soluciones de calidad para ti", cta: "Contáctanos",
  services: [["Calidad", "Trabajamos con dedicación y atención a cada detalle."], ["Experiencia", "Años ayudando a clientes como tú."], ["Atención cercana", "Te acompañamos antes, durante y después."]],
};

const UNSPLASH = [
  "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=70",
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=900&q=70",
  "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=900&q=70",
];

// options.colorOverride permite forzar el color principal (p. ej. al aplicar un cambio simple).
export function generateTemplateSite(order, options = {}) {
  const store = getStore(order.storeId);
  const pkg = getPackage(store, order.packageId);
  const b = order.brief, c = order.client;
  const name = b.businessName || c.name || "Mi negocio";
  const niche = NICHES.find((n) => n.re.test(`${b.businessType} ${b.description} ${store?.niche}`)) ?? DEFAULT_NICHE;
  const color = options.colorOverride || pickColor(b.colors, store?.accent);
  const images = order.files.filter((f) => f.type?.startsWith("image/"));
  const logo = images.find((f) => f.label === "logo");
  const photos = images.filter((f) => f !== logo).map((f) => `assets/${f.name}`);
  const heroImg = photos[0] || UNSPLASH[0];
  const gallery = photos.length > 1 ? photos.slice(1, 7) : photos.length === 1 ? [] : UNSPLASH.slice(1);
  const description = (b.description || "").trim();
  const intro = description.length > 30 ? description.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") : `En ${name} te ofrecemos un servicio pensado para ti.`;
  const digits = (c.phone || "").replace(/\D/g, "");
  const wa = digits ? `https://wa.me/${digits}` : "https://wa.me/[TELÉFONO]";
  const email = c.email || "[EMAIL]";
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}${b.businessType ? ` — ${esc(b.businessType)}` : ""}</title>
<meta name="description" content="${esc(intro.slice(0, 155))}">
<meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(intro.slice(0, 155))}">
<meta property="og:type" content="website">
${logo ? `<link rel="icon" href="assets/${esc(logo.name)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--c:${color};--dark:#1d2126;--light:#f7f5f2;--muted:#5f6670}
*{box-sizing:border-box;margin:0}
html,body{overflow-x:clip}
body{font-family:Poppins,system-ui,sans-serif;color:var(--dark);line-height:1.6;background:#fff}
img{max-width:100%;display:block}
a{color:inherit}
.wrap{max-width:1100px;margin:auto;padding:0 20px}
header{position:sticky;top:0;background:#fffffff2;backdrop-filter:blur(6px);box-shadow:0 1px 0 #0000000f;z-index:10}
.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.2rem;text-decoration:none}
.brand img{height:44px;width:auto}
.nav nav{display:flex;gap:20px;flex-wrap:wrap}
.nav nav a{text-decoration:none;font-weight:600;font-size:.95rem}
.nav nav a:hover{color:var(--c)}
.btn{display:inline-block;background:var(--c);color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:600;box-shadow:0 8px 20px -8px var(--c)}
.btn.ghost{background:#fff;color:var(--c);box-shadow:none;border:2px solid #fff}
.hero{position:relative;color:#fff;min-height:min(78vh,720px);display:grid;place-items:center;text-align:center;background:#222 url("${esc(heroImg)}") center/cover}
.hero::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0008,#000a)}
.hero .wrap{position:relative;padding:80px 20px;width:100%}
.hero h1{font-size:clamp(2.2rem,6vw,3.8rem);line-height:1.1;margin-bottom:14px;overflow-wrap:anywhere}
.hero p{font-size:1.15rem;max-width:680px;margin:0 auto 28px;opacity:.95}
.hero .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
section{padding:80px 0}
h2{font-size:clamp(1.7rem,4vw,2.4rem);margin-bottom:12px}
.lead{color:var(--muted);max-width:640px;margin-bottom:40px}
.cards{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--light);padding:28px;border-radius:18px;border-top:4px solid var(--c)}
.card h3{margin-bottom:8px}
.alt{background:var(--light)}
.about{display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:center}
.about img{border-radius:20px;aspect-ratio:4/3;object-fit:cover;width:100%}
.gallery{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.gallery img{border-radius:14px;aspect-ratio:1;object-fit:cover;width:100%}
.contact{background:var(--c);color:#fff;text-align:center}
.contact .lead{color:#ffffffd9;margin:0 auto 30px}
.contact-list{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
footer{background:var(--dark);color:#ffffffb3;text-align:center;padding:28px 20px;font-size:.9rem}
.wa-float{position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;background:#25d366;display:grid;place-items:center;box-shadow:0 8px 24px #0004;z-index:20}
.wa-float svg{width:30px;height:30px;fill:#fff}
@media(max-width:700px){.nav nav{display:none}section{padding:60px 0}}
</style>
</head>
<body>
<header><div class="wrap nav">
  <a class="brand" href="#inicio">${logo ? `<img src="assets/${esc(logo.name)}" alt="Logo de ${esc(name)}">` : ""}<span>${esc(name)}</span></a>
  <nav aria-label="Principal"><a href="#servicios">Servicios</a><a href="#nosotros">Nosotros</a>${gallery.length ? '<a href="#galeria">Galería</a>' : ""}<a href="#contacto">Contacto</a></nav>
</div></header>

<main>
<section class="hero" id="inicio" aria-label="Portada"><div class="wrap">
  <h1>${esc(name)}</h1>
  <p>${esc(niche.hero)}. ${esc(intro)}</p>
  <div class="actions"><a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">${esc(niche.cta)}</a><a class="btn ghost" href="#servicios">Conocer más</a></div>
</div></section>

<section id="servicios"><div class="wrap">
  <h2>¿Qué ofrecemos?</h2>
  <p class="lead">${esc(b.businessType ? `${b.businessType} con atención profesional y cercana.` : "Todo lo que necesitas en un solo lugar.")}</p>
  <div class="cards">${niche.services.map(([t, d]) => `<article class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join("")}</div>
</div></section>

<section class="alt" id="nosotros"><div class="wrap about">
  <div><h2>Sobre ${esc(name)}</h2><p class="lead" style="margin-bottom:0">${esc(description || `Somos ${name}, un equipo comprometido con la calidad y con cada cliente.`)}</p></div>
  <img src="${esc(photos[1] || photos[0] || UNSPLASH[1])}" alt="${esc(name)}" loading="lazy">
</div></section>

${gallery.length ? `<section id="galeria"><div class="wrap">
  <h2>Galería</h2><p class="lead">Un vistazo a lo que hacemos.</p>
  <div class="gallery">${gallery.map((src, i) => `<img src="${esc(src)}" alt="${esc(name)} — imagen ${i + 1}" loading="lazy">`).join("")}</div>
</div></section>` : ""}

<section class="contact" id="contacto"><div class="wrap">
  <h2>Hablemos</h2>
  <p class="lead">Escríbenos y te respondemos a la brevedad.</p>
  <div class="contact-list">
    <a class="btn ghost" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn ghost" href="mailto:${esc(email)}">${esc(email)}</a>
  </div>
</div></section>
</main>

<footer>© ${year} ${esc(name)}. Todos los derechos reservados.</footer>
<a class="wa-float" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Escribir por WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.2-.7-2.7-1.1-4.4-3.8-4.5-4-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9.9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg></a>
</body>
</html>
`;
}
