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
    businessName: "<script>alert(1)</script>Bistró Ana", description: "Quiero una web con reservas",
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

test("vista previa del sitio servida en sandbox", async () => {
  const { saveVersion } = await import("../src/sites.js");
  const { getOrder } = await import("../src/db.js");
  saveVersion("WEB-0001", "<!doctype html><html><body>Hola</body></html>", "prueba");
  const res = await fetch(`${base}/o/${getOrder("WEB-0001").token}/preview`);
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
    businessName: "Estudio Leo", description: "Web de presentación",
  });
  const portalUrl = res.headers.get("location").replace(/\?.*/, "");
  assert.match(await (await fetch(base + portalUrl)).text(), /discord\.gg\/abc123/);

  const { listOrders, getOrder } = await import("../src/db.js");
  const leo = listOrders({ q: "Estudio Leo" })[0];
  assert.match(await (await fetch(`${base}/admin/pedidos/${leo.id}`, { headers: auth })).text(), /leo#77/);

  const fiverr = getOrder("WEB-0002");
  assert.ok(!(await (await fetch(`${base}/o/${fiverr.token}`)).text()).includes("discord"));
});
