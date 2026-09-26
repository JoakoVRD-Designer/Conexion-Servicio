import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conexion-unit-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.SITES_DIR = path.join(tmp, "sites");
let db, sites, zip, templates, flows;
before(async () => {
  db = await import("../src/db.js");
  sites = await import("../src/sites.js");
  zip = await import("../src/zip.js");
  templates = await import("../src/templates.js");
  flows = await import("../src/flows.js");
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108020000009077053e0000000c4944415408d763f8ffff3f0005fe02fea7d5d1a70000000049454e44ae426082", "hex");

test("ZIP: formato válido que abre la herramienta unzip del sistema", () => {
  const buf = zip.createZip([{ name: "index.html", data: "<h1>Hola ñandú</h1>".repeat(50) }, { name: "assets/a.png", data: PNG }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  const file = path.join(tmp, "t.zip");
  fs.writeFileSync(file, buf);
  let list;
  try {
    list = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
  } catch (e) {
    if (e.code === "ENOENT") return; // unzip no instalado: la simulación verifica el ZIP con su propio lector
    throw e;
  }
  assert.match(list, /index\.html/);
  assert.match(list, /assets\/a\.png/);
  execFileSync("unzip", ["-t", file]); // falla si algún CRC es incorrecto
});

test("archivos: valida contenido real, normaliza nombres y bloquea rutas externas", () => {
  const o = db.createOrder({ storeId: "web-restaurantes", packageId: "basico", businessName: "Test" });
  assert.throws(() => sites.addAsset(o.id, "foto.png", Buffer.from("no soy png"), "cliente"), /no es un \.png válido/);
  assert.throws(() => sites.addAsset(o.id, "virus.exe", Buffer.from("MZ"), "cliente"), /no permitido/);
  assert.equal(sites.addAsset(o.id, "Mi Foto Ñandú.PNG", PNG, "cliente"), "mi-foto-nandu.png");
  assert.equal(sites.addAsset(o.id, "Mi Foto Ñandú.png", PNG, "cliente"), "mi-foto-nandu-2.png");
  assert.equal(sites.assetPath(o.id, "../../data/db.json"), null);
  assert.equal(sites.assetPath(o.id, "otro.png"), null);
});

test("plantilla: HTML completo con logo, fotos y color pedido", () => {
  const o = db.createOrder({ storeId: "web-restaurantes", packageId: "basico", businessName: "Café <Luna>", colors: "verde", clientPhone: "+54 11 2222 3333" });
  sites.addAsset(o.id, "logo.png", PNG, "cliente", "logo");
  sites.addAsset(o.id, "local.png", PNG, "cliente", "foto");
  const htmlDoc = templates.generateTemplateSite(db.getOrder(o.id));
  assert.match(htmlDoc, /^<!DOCTYPE html>/);
  assert.match(htmlDoc, /assets\/logo\.png/);
  assert.match(htmlDoc, /assets\/local\.png/);
  assert.match(htmlDoc, /#2e7d4f/);
  assert.match(htmlDoc, /wa\.me\/541122223333/);
  assert.ok(htmlDoc.includes("Café &lt;Luna&gt;") && !htmlDoc.includes("<Luna>"), "el nombre se escapa");
});

test("flujo: descarga solo tras entrega y pago completo (clientes directos)", async () => {
  const o = db.createOrder({ storeId: "web-restaurantes", packageId: "basico", businessName: "Pago" });
  flows.templateSite(o.id);
  await flows.deliver(o.id);
  assert.equal(flows.downloadAllowed(db.getOrder(o.id)), false);
  db.addPayment(o.id, 80, "PayPal");
  assert.equal(flows.downloadAllowed(db.getOrder(o.id)), true);
  const f = db.createOrder({ storeId: "fiverr-landing", packageId: "basico", businessName: "Fiverr" });
  flows.templateSite(f.id);
  await flows.deliver(f.id);
  assert.equal(flows.downloadAllowed(db.getOrder(f.id)), true, "en Fiverr el pago lo gestiona la plataforma");
});

test("revisiones: cuenta los cambios del cliente contra las incluidas en el paquete", async () => {
  const o = db.createOrder({ storeId: "web-restaurantes", packageId: "basico", businessName: "Rev" }); // 2 revisiones
  for (let i = 0; i < 3; i++) await flows.requestChanges(o.id, `cambio ${i}`);
  const info = flows.revisionInfo(db.getOrder(o.id));
  assert.deepEqual([info.used, info.included, info.exceeded], [3, 2, true]);
  assert.match(db.getOrder(o.id).review.pendingChanges, /cambio 0\ncambio 1\ncambio 2/);
});

test("zlib.crc32 disponible (Node >= 22.2)", () => assert.equal(typeof zlib.crc32, "function"));
