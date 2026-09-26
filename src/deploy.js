// Publicación con un clic en Netlify (hosting gratis con HTTPS). Requiere NETLIFY_TOKEN en .env
// (Netlify → User settings → Applications → Personal access tokens).
// La primera publicación crea un sitio nuevo; las siguientes actualizan el mismo sitio.
import { getOrder, updateOrder } from "./db.js";
import { buildZip, currentVersion } from "./sites.js";

const API = () => (process.env.NETLIFY_API_URL || "https://api.netlify.com/api/v1").replace(/\/$/, "");

async function netlify(method, url, body, contentType) {
  const res = await fetch(`${API()}${url}`, {
    method,
    headers: { authorization: `Bearer ${process.env.NETLIFY_TOKEN}`, "content-type": contentType },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Netlify respondió ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export const netlifyEnabled = () => Boolean(process.env.NETLIFY_TOKEN);

export async function publishToNetlify(orderId) {
  if (!netlifyEnabled()) throw new Error("Configura NETLIFY_TOKEN en .env para publicar en Netlify.");
  const order = getOrder(orderId);
  const version = currentVersion(order);
  const zip = buildZip(orderId);
  let siteId = order.delivery.netlifySiteId;
  let url;

  if (siteId) {
    const deploy = await netlify("POST", `/sites/${siteId}/deploys`, zip, "application/zip");
    url = deploy.ssl_url || deploy.url || order.delivery.publishedUrl;
  } else {
    const site = await netlify("POST", "/sites", zip, "application/zip");
    siteId = site.id || site.site_id;
    url = site.ssl_url || site.url;
    // Intenta darle un nombre legible (negocio.netlify.app); si ya existe, se queda el nombre automático.
    const wanted = slugify(order.brief.businessName);
    if (wanted) {
      try {
        const renamed = await netlify("PATCH", `/sites/${siteId}`, JSON.stringify({ name: `${wanted}-${order.id.toLowerCase()}` }), "application/json");
        url = renamed.ssl_url || renamed.url || url;
      } catch { /* nombre ocupado: no es un problema */ }
    }
  }
  if (!siteId || !url) throw new Error("Netlify no devolvió la dirección del sitio.");
  updateOrder(orderId, (o) => {
    o.delivery.netlifySiteId = siteId;
    o.delivery.publishedUrl = url;
    o.delivery.publishedVersion = version;
    o.delivery.publishedAt = new Date().toISOString();
  }, `Publicado en Netlify (v${version}): ${url}`);
  return url;
}
