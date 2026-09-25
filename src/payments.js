// Cobros directos (PayPal, Mercado Pago, transferencia...) para clientes de tiendas propias y contacto directo.
// Los pedidos de marketplaces (Fiverr, Workana, Upwork) se cobran SIEMPRE dentro de la plataforma:
// aquí nunca se generan enlaces de pago externos para ellos.
import { getCatalog, getStore, getPackage, isMarketplace } from "./config.js";

const round2 = (n) => Math.round(n * 100) / 100;

export function paymentStatus(order) {
  const paid = round2((order.payments ?? []).reduce((sum, p) => sum + p.amount, 0));
  const due = round2(Math.max(0, order.price - paid));
  const depositPercent = Number(getCatalog().payments.depositPercent) || 0;
  const isDeposit = paid === 0 && depositPercent > 0 && depositPercent < 100 && due > 0;
  const next = isDeposit ? round2((order.price * depositPercent) / 100) : due;
  return { paid, due, next, isDeposit, depositPercent };
}

// Opciones de pago para mostrar al cliente o incluir en un mensaje. Vacío para marketplaces.
export function paymentOptions(order, amount) {
  if (isMarketplace(order.channel) || amount <= 0) return [];
  const { currency, payments: cfg } = getCatalog();
  const options = [];
  if (cfg.paypalMe) {
    const user = String(cfg.paypalMe).replace(/^https?:\/\/(www\.)?paypal\.(me|com\/paypalme)\//i, "").replace(/\/.*$/, "");
    options.push({ label: "PayPal", url: `https://www.paypal.com/paypalme/${encodeURIComponent(user)}/${amount}${currency}` });
  }
  for (const link of cfg.links ?? []) {
    if (link?.url && /^https:\/\//i.test(link.url)) options.push({ label: link.label || "Pagar", url: link.url });
  }
  // Enlace fijo del paquete (sirve solo si se paga el total de una vez).
  const pkg = getPackage(getStore(order.storeId), order.packageId);
  if (pkg?.paymentLink && /^https:\/\//i.test(pkg.paymentLink) && amount === order.price) {
    options.push({ label: `Pagar ${pkg.name}`, url: pkg.paymentLink });
  }
  return options;
}

export const paymentInstructions = (order) => (isMarketplace(order.channel) ? "" : String(getCatalog().payments.instructions || ""));

export function paymentRequestText(order) {
  if (isMarketplace(order.channel)) throw new Error("Este pedido es de un marketplace: el cobro se hace dentro de la plataforma.");
  const { currency } = getCatalog();
  const st = paymentStatus(order);
  if (st.next <= 0) throw new Error("Este pedido ya está pagado por completo.");
  const options = paymentOptions(order, st.next);
  const instructions = paymentInstructions(order);
  if (!options.length && !instructions) throw new Error("Configura al menos un medio de pago en config/stores.json → payments.");
  const concept = st.isDeposit ? `el anticipo del ${st.depositPercent}% para comenzar` : st.paid > 0 ? "el saldo pendiente" : "el pago";
  return [
    `Hola ${order.client.name || ""}! Para continuar con tu pedido ${order.id}, te comparto los datos para ${concept}: ${st.next} ${currency}.`,
    "",
    ...options.map((o) => `• ${o.label}: ${o.url}`),
    ...(instructions ? ["", instructions] : []),
    "",
    "Cuando lo realices, avísame por aquí y te confirmo. ¡Gracias!",
  ].join("\n");
}
