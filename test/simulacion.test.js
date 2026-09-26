// Ejecuta la simulación completa del negocio (API de Claude, Netlify y email simulados) como prueba de integración.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("simulación de punta a punta: todos los pasos correctos", () => {
  const out = execFileSync(process.execPath, [path.join(root, "scripts", "simulacion.js"), "--offline"], { cwd: root, encoding: "utf8", timeout: 120_000 });
  assert.match(out, /✅ (\d+)\/\1 pasos correctos/);
});
