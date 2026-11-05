const { send, body, clean, sameOrigin, db, getSupabaseKey, getSupabaseUrl, getKeyRole } = require("./_lib");
const RECIPIENT = process.env.NOTIFY_EMAIL || "anarouachamsoudine010@gmail.com";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function notify(l) {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";
  if (!key) return { ok: false, error: "no_resend_key" };
  const rows = [["Nom", l.name], ["E-mail", l.email], ["Téléphone", l.phone], ["Organisation", l.organization]].filter(r => r[1]);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ from, to: [RECIPIENT], reply_to: l.email, subject: `Nouvelle inscription : ${l.name}`,
        html: `<h2>Nouvelle inscription</h2><table>${rows.map(([a, b]) => `<tr><th align="left">${esc(a)}</th><td>${esc(b)}</td></tr>`).join("")}</table>` })
    });
    const txt = await r.text().catch(() => "");
    if (!r.ok) {
      console.error("Resend error:", r.status, txt);
      return { ok: false, status: r.status, message: txt };
    }
    return { ok: true };
  } catch (err) {
    console.error("Resend exception:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const key = getSupabaseKey();
    const url = getSupabaseUrl();
    const role = getKeyRole(key);
    let dbStatus = "unknown";
    let dbError = null;
    if (!key) {
      dbStatus = "key_missing";
    } else {
      try {
        await db("leads?select=id&limit=1", { method: "GET" });
        dbStatus = "ok";
      } catch (err) {
        dbStatus = "error";
        dbError = { code: err.code, status: err.status, details: err.details || err.message };
      }
    }
    return send(res, 200, {
      status: dbStatus === "ok" ? "ready" : "degraded",
      database: {
        configured: !!key,
        role,
        urlConfigured: !!process.env.SUPABASE_URL || !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        urlHost: url ? new URL(url).host : null,
        status: dbStatus,
        error: dbError
      },
      email: {
        resendConfigured: !!process.env.RESEND_API_KEY,
        recipientConfigured: !!process.env.NOTIFY_EMAIL
      },
      env: {
        has_SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
        has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        has_SUPABASE_SECRET_KEY: !!process.env.SUPABASE_SECRET_KEY,
        has_SUPABASE_KEY: !!process.env.SUPABASE_KEY,
        has_SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
        has_NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        has_RESEND_API_KEY: !!process.env.RESEND_API_KEY,
        has_ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
        has_SESSION_SECRET: !!process.env.SESSION_SECRET
      }
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST, GET" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });
  const d = body(req); if (!d) return send(res, 400, { error: "invalid_submission" });
  if (clean(d.website, 200)) return send(res, 200, { success: true });
  const lead = { name: clean(d.name, 80), email: clean(d.email, 120).toLowerCase(), phone: clean(d.phone, 30) || null,
    organization: clean(d.organization, 100) || null, lang: d.lang === "en" ? "en" : "fr", timezone: clean(d.timezone, 100),
    referrer: clean(d.referrer, 200) || null, user_agent: clean(d.user_agent, 300) };
  if (lead.name.length < 2 || !EMAIL.test(lead.email) || d.consent !== true) return send(res, 400, { error: "invalid_submission" });

  let saved = false;
  let dbErr = null;
  try {
    await db("leads?on_conflict=email", { method: "POST", data: lead, prefer: "resolution=merge-duplicates,return=minimal" });
    saved = true;
  } catch (e) {
    dbErr = { code: e.code, message: e.message, status: e.status, details: e.details };
    console.error("DB Error on_conflict:", e.code, e.status, e.message);
    if (e.status !== 401 && e.status !== 403) {
      try {
        await db("leads", { method: "POST", data: lead, prefer: "return=minimal" });
        saved = true;
        dbErr = null;
      } catch (e2) {
        console.error("Fallback DB Error:", e2.code, e2.status, e2.message);
      }
    }
  }

  let mailed = false;
  let mailRes = null;
  try {
    mailRes = await notify(lead);
    mailed = mailRes && mailRes.ok === true;
  } catch (e) {
    console.error("Mail Error:", e.message);
    mailRes = { ok: false, error: e.message };
  }

  if (!saved && !mailed) {
    return send(res, 502, {
      error: "registration_failed",
      debug: {
        db: dbErr,
        mail: mailRes
      }
    });
  }

  return send(res, 200, { success: true });
};
