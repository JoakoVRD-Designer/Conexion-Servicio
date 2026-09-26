// Emails automáticos al cliente (solo clientes directos: los de marketplaces se atienden dentro de la plataforma).
// Configuración (.env):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM   → envío real (Gmail, Zoho, Brevo, etc.)
//   MAIL_OUTBOX=1                                           → sin SMTP: guarda los emails en data/outbox/ (pruebas)
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { DATA_DIR, isMarketplace } from "./config.js";
import { updateOrder } from "./db.js";

let transport;
function getTransport() {
  if (transport) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST) {
    const port = Number(SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  } else if (process.env.MAIL_OUTBOX === "1") {
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

export const mailEnabled = () => Boolean(process.env.SMTP_HOST || process.env.MAIL_OUTBOX === "1");

export async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost";
  const info = await t.sendMail({ from, to, subject, text });
  if (process.env.MAIL_OUTBOX === "1" && !process.env.SMTP_HOST) {
    const dir = path.join(DATA_DIR, "outbox");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`), info.message);
  }
  return true;
}

// Envía un email al cliente del pedido y deja constancia en el historial. Nunca lanza errores.
export async function emailClient(order, subject, lines) {
  if (isMarketplace(order.channel) || !order.client.email || !mailEnabled()) return false;
  const text = [`Hola ${order.client.name || ""},`, "", ...lines, "", "Saludos,", process.env.BUSINESS_NAME || "El equipo"].join("\n");
  try {
    await sendMail({ to: order.client.email, subject, text });
    updateOrder(order.id, (o) => { o.emails.push({ subject, at: new Date().toISOString(), ok: true }); }, `📧 Email al cliente: ${subject}`);
    return true;
  } catch (err) {
    console.error("[email]", err.message);
    updateOrder(order.id, (o) => { o.emails.push({ subject, at: new Date().toISOString(), ok: false, error: err.message }); }, `📧 Falló el email "${subject}": ${err.message}`);
    return false;
  }
}

// Aviso al dueño por email (además de Telegram/webhook), si se define OWNER_EMAIL.
export async function emailOwner(subject, text) {
  if (!process.env.OWNER_EMAIL || !mailEnabled()) return false;
  try {
    return await sendMail({ to: process.env.OWNER_EMAIL, subject, text });
  } catch (err) {
    console.error("[email dueño]", err.message);
    return false;
  }
}
