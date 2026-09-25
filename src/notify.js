// Avisos al vendedor cuando entra un pedido o un mensaje nuevo.
// Configura TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID y/o NOTIFY_WEBHOOK_URL (Slack, Discord, Make, Zapier...).
export async function notify(text) {
  console.log(`[aviso] ${text}`);
  const jobs = [];
  const { TELEGRAM_BOT_TOKEN: bot, TELEGRAM_CHAT_ID: chat, NOTIFY_WEBHOOK_URL: hook } = process.env;
  if (bot && chat) {
    jobs.push(fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    }));
  }
  if (hook) {
    jobs.push(fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.error("[aviso] fallo al notificar:", r.reason?.message);
}
