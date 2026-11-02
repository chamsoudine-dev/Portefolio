const { send, body, clean, sameOrigin, db } = require("./_lib");
const RECIPIENT = process.env.NOTIFY_EMAIL || "anarouachamsoudine010@gmail.com";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function notify(l) {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";
  if (!key) return false;
  const rows = [["Nom", l.name], ["E-mail", l.email], ["Téléphone", l.phone], ["Organisation", l.organization]].filter(r => r[1]);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ from, to: [RECIPIENT], reply_to: l.email, subject: `Nouvelle inscription : ${l.name}`,
      html: `<h2>Nouvelle inscription</h2><table>${rows.map(([a, b]) => `<tr><th align="left">${esc(a)}</th><td>${esc(b)}</td></tr>`).join("")}</table>` })
  });
  if (!r.ok) console.error("Resend", r.status, await r.text().catch(() => ""));
  return r.ok;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });
  const d = body(req); if (!d) return send(res, 400, { error: "invalid_submission" });
  if (clean(d.website, 200)) return send(res, 200, { success: true });
  const lead = { name: clean(d.name, 80), email: clean(d.email, 120).toLowerCase(), phone: clean(d.phone, 30) || null,
    organization: clean(d.organization, 100) || null, lang: d.lang === "en" ? "en" : "fr", timezone: clean(d.timezone, 100),
    referrer: clean(d.referrer, 200) || null, user_agent: clean(d.user_agent, 300) };
  if (lead.name.length < 2 || !EMAIL.test(lead.email) || d.consent !== true) return send(res, 400, { error: "invalid_submission" });

  let saved = false;
  try { await db("leads?on_conflict=email", { method: "POST", data: lead, prefer: "resolution=merge-duplicates,return=minimal" }); saved = true; }
  catch (e) { console.error("DB", e.code, e.message); if (e.code === "db_not_configured" && !process.env.RESEND_API_KEY) return send(res, 503, { error: "service_not_configured" }); }
  let mailed = false;
  try { mailed = await notify(lead); } catch (e) { console.error("Mail", e.message); }
  // Succès si au moins un canal a enregistré la demande : l'inscription n'est plus perdue
  if (!saved && !mailed) return send(res, 502, { error: "registration_failed" });
  return send(res, 200, { success: true });
};
