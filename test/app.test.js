import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conexion-test-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SITES_DIR = path.join(tmp, "sites");
process.env.ADMIN_PASSWORD = "secreta";
process.env.ADMIN_USER = "admin";

let server, base;
const auth = { authorization: `Basic ${Buffer.from("admin:secreta").toString("base64")}` };
const form = (obj) => new URLSearchParams(obj).toString();
const post = (url, body, headers = {}) =>
  fetch(base + url, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: form(body) });

before(async () => {
  const { default: app } = await import("../src/server.js");
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("las tiendas públicas se muestran", async () => {
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Webs para Restaurantes/);
  const store = await fetch(base + "/s/restaurantes");
  assert.match(await store.text(), /Haz tu pedido/);
  const fiverr = await fetch(base + "/s/landing-pro");
  assert.match(await fiverr.text(), /Fiverr/);
});

test("flujo completo: pedido del cliente, mensajes y gestión en el panel", async () => {
  const res = await post("/s/restaurantes/pedido", {
    packageId: "estandar", clientName: "Ana", clientEmail: "ana@example.com", clientPhone: "+54 9 11 5555 0000",
    businessName: "<script>alert(1)</script>Bistró Ana", description: "Quiero una web con reservas", acepto: "1",
  });
  assert.equal(res.status, 303);
  const portalUrl = res.headers.get("location").replace(/\?.*/, "");
  assert.match(portalUrl, /^\/o\/[\w-]+$/);

  const portal = await (await fetch(base + portalUrl)).text();
  assert.match(portal, /WEB-0001/);

  assert.equal((await post(`${portalUrl}/mensaje`, { text: "¿Pueden usar color verde?" })).status, 303);

  // Panel protegido
  assert.equal((await fetch(base + "/admin")).status, 401);
  const dash = await (await fetch(base + "/admin", { headers: auth })).text();
  assert.match(dash, /WEB-0001/);
  assert.ok(!dash.includes("<script>alert(1)</script>"), "el HTML del cliente debe escaparse");

  const detail = await (await fetch(base + "/admin/pedidos/WEB-0001", { headers: auth })).text();
  assert.match(detail, /color verde/);
  assert.match(detail, /wa\.me\/5491155550000/);

  // CSRF: POST sin origen propio se rechaza
  assert.equal((await post("/admin/pedidos/WEB-0001/estado", { status: "en_progreso" }, auth)).status, 403);
  const ok = await post("/admin/pedidos/WEB-0001/estado", { status: "en_progreso" }, { ...auth, origin: base });
  assert.equal(ok.status, 303);

  await post("/admin/pedidos/WEB-0001/mensaje", { from: "yo", text: "¡Claro que sí!" }, { ...auth, origin: base });
  assert.match(await (await fetch(base + portalUrl)).text(), /¡Claro que sí!/);
});

test("registro manual de un pedido de Fiverr e ingresos netos", async () => {
  const res = await post("/admin/pedidos", {
    storePkg: "fiverr-landing|premium", channel: "fiverr", externalRef: "FO99", clientUsername: "juanp", businessName: "Taller Juan", price: "300",
  }, { ...auth, origin: base });
  assert.equal(res.status, 303);
  await post("/admin/pedidos/WEB-0002/estado", { status: "completado" }, { ...auth, origin: base });
  const { stats } = await import("../src/db.js");
  const s = stats();
  assert.equal(s.earnedGross, 300);
  assert.equal(s.earnedNet, 240); // 20% de comisión de Fiverr
  const detail = await (await fetch(base + "/admin/pedidos/WEB-0002", { headers: auth })).text();
  assert.match(detail, /fiverr\.com\/inbox\/juanp/);
});

test("vista previa: el cliente solo la ve cuando se la envías, y se sirve en sandbox", async () => {
  const { saveVersion } = await import("../src/sites.js");
  const { getOrder } = await import("../src/db.js");
  saveVersion("WEB-0001", "<!doctype html><html><body>Hola</body></html>", "prueba");
  const url = `${base}/o/${getOrder("WEB-0001").token}/preview/`;
  assert.equal((await fetch(url)).status, 404, "todavía no se envió al cliente");
  assert.equal((await post("/admin/pedidos/WEB-0001/enviar-revision", {}, { ...auth, origin: base })).status, 303);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
  assert.equal(getOrder("WEB-0001").site.versions.length, 1);
});

test("cobro directo por PayPal en tiendas propias, nunca en marketplaces", async () => {
  const { getCatalog } = await import("../src/config.js");
  Object.assign(getCatalog().payments, { paypalMe: "miusuario", depositPercent: 50, links: [], instructions: "" });
  const { getOrder } = await import("../src/db.js");
  const direct = getOrder("WEB-0001"); // tienda propia, 180 USD

  const portal = await (await fetch(`${base}/o/${direct.token}`)).text();
  assert.match(portal, /paypal\.com\/paypalme\/miusuario\/90USD/, "anticipo del 50% por PayPal");

  const cobro = await post("/admin/pedidos/WEB-0001/cobro", {}, { ...auth, origin: base });
  assert.equal(cobro.status, 303);
  assert.match(getOrder("WEB-0001").ai.draftReply, /paypalme\/miusuario\/90USD/);

  await post("/admin/pedidos/WEB-0001/pago", { amount: "90", method: "PayPal" }, { ...auth, origin: base });
  assert.match(await (await fetch(`${base}/o/${direct.token}`)).text(), /paypalme\/miusuario\/90USD/, "saldo restante");
  await post("/admin/pedidos/WEB-0001/pago", { amount: "90", method: "PayPal" }, { ...auth, origin: base });
  assert.match(await (await fetch(`${base}/o/${direct.token}`)).text(), /Pago completo recibido/);

  // Pedido de Fiverr: sin enlaces de pago externos en ningún lado
  const fiverr = getOrder("WEB-0002");
  assert.equal(fiverr.feePercent, 20);
  assert.ok(!(await (await fetch(`${base}/o/${fiverr.token}`)).text()).includes("paypal"));
  assert.ok(!(await (await fetch(`${base}/admin/pedidos/WEB-0002`, { headers: auth })).text()).includes("paypal"));
  const denied = await post("/admin/pedidos/WEB-0002/cobro", {}, { ...auth, origin: base });
  assert.match(decodeURIComponent(denied.headers.get("location")), /dentro de la plataforma/);
});

test("Discord se ofrece solo a clientes directos, nunca en marketplaces", async () => {
  const { getCatalog } = await import("../src/config.js");
  getCatalog().contact.discordInvite = "https://discord.gg/abc123";
  const res = await post("/s/profesionales/pedido", {
    packageId: "basico", clientName: "Leo", clientEmail: "leo@example.com", clientDiscord: "leo#77",
    businessName: "Estudio Leo", description: "Web de presentación", acepto: "1",
  });
  const portalUrl = res.headers.get("location").replace(/\?.*/, "");
  assert.match(await (await fetch(base + portalUrl)).text(), /discord\.gg\/abc123/);

  const { listOrders, getOrder } = await import("../src/db.js");
  const leo = listOrders({ q: "Estudio Leo" })[0];
  assert.match(await (await fetch(`${base}/admin/pedidos/${leo.id}`, { headers: auth })).text(), /leo#77/);

  const fiverr = getOrder("WEB-0002");
  assert.ok(!(await (await fetch(`${base}/o/${fiverr.token}`)).text()).includes("discord"));
});

test("portafolio: DORN AGRO aparece como proyecto destacado en la portada y en las tiendas", async () => {
  for (const url of ["/", "/s/restaurantes", "/s/landing-pro"]) {
    const page = await (await fetch(base + url)).text();
    assert.match(page, /Proyecto real/, url);
    assert.match(page, /DORN AGRO/, url);
    assert.match(page, /\/portafolio\/dorn-agro-portada\.jpg/, url);
  }
  const img = await fetch(`${base}/portafolio/dorn-agro-panel.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
});

test("tienda: exige aceptar términos, suma extras al precio y acorta el plazo con entrega express", async () => {
  const base_ = { packageId: "estandar", clientName: "Eva", clientEmail: "eva@example.com", businessName: "Café Eva", description: "Web para mi café" };
  const sin = await post("/s/restaurantes/pedido", base_);
  assert.equal(sin.status, 400);
  assert.match(await sin.text(), /aceptar los términos/);

  const body = new URLSearchParams({ ...base_, acepto: "1" });
  for (const e of ["express", "textos", "mantenimiento", "inventado"]) body.append("extras", e);
  const res = await fetch(`${base}/s/restaurantes/pedido`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  assert.equal(res.status, 303);
  const { listOrders } = await import("../src/db.js");
  const o = listOrders({ q: "Café Eva" })[0];
  assert.equal(o.price, 180 + 40 + 35, "plan + express + textos (el mantenimiento mensual se cobra aparte)");
  assert.deepEqual(o.extras.map((e) => e.id), ["express", "textos", "mantenimiento"], "extras inventados se ignoran");
  const days = Math.round((Date.parse(o.brief.deadline) - Date.parse(o.createdAt.slice(0, 10))) / 86400000);
  assert.ok(days <= 4, `express: 7 días → ${days}`);
  assert.ok(o.acceptedTermsAt);
});

test("tienda: el plan Premium no ofrece extras que ya incluye", async () => {
  const body = new URLSearchParams({ packageId: "premium", clientName: "Leo", clientEmail: "l@example.com", businessName: "Resto Premium", description: "x", acepto: "1" });
  body.append("extras", "textos");
  await fetch(`${base}/s/restaurantes/pedido`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const { listOrders } = await import("../src/db.js");
  const o = listOrders({ q: "Resto Premium" })[0];
  assert.equal(o.price, 350);
  assert.equal(o.extras.length, 0);
});

test("sitio propio: no manda visitantes a Fiverr; legales, robots y sitemap", async () => {
  const home = await (await fetch(base + "/")).text();
  assert.ok(!home.includes('href="/s/landing-pro"'), "la tienda de Fiverr no se lista en el sitio propio");
  assert.match(home, /\/terminos/);
  for (const url of ["/terminos", "/privacidad"]) assert.equal((await fetch(base + url)).status, 200);
  const robots = await (await fetch(base + "/robots.txt")).text();
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Disallow: \/o\//);
  const sitemap = await (await fetch(base + "/sitemap.xml")).text();
  assert.match(sitemap, /\/s\/restaurantes/);
  assert.ok(!sitemap.includes("landing-pro"));
});
