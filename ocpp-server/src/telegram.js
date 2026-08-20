// Minimal Telegram Bot API client. Notifications are best-effort - a
// Telegram failure (missing secret, bad chat id, API hiccup) must never
// break the actual charging/session flow that triggered it.
export async function notifyTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" })
    });
    if (!res.ok) console.error("Telegram sendMessage failed:", res.status, await res.text());
  } catch (err) {
    console.error("Telegram sendMessage error:", err.message || err);
  }
}
