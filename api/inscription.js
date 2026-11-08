const { send, body, clean, sameOrigin, db, getSupabaseKey, getSupabaseUrl, getKeyRole, getKeyDetails } = require("./_lib");
const RECIPIENT = process.env.NOTIFY_EMAIL || "anarouachamsoudine010@gmail.com";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function notify(l, meta = {}) {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";
  if (!key) return { ok: false, error: "no_resend_key" };

  const locStr = [meta.city, meta.country].filter(Boolean).join(", ") || "Non précisée";
  const coordsStr = (meta.lat && meta.lon) ? `${meta.lat.toFixed(4)}, ${meta.lon.toFixed(4)}` : "Non disponibles";
  const skillsStr = Array.isArray(meta.skills) && meta.skills.length ? meta.skills.join(", ") : (meta.skills || "Apprentissage général");

  const rows = [
    ["Nom", l.name],
    ["E-mail", l.email],
    ["Téléphone / WhatsApp", l.phone],
    ["Organisation / Profil", l.organization],
    ["Localisation (Temps Réel)", locStr],
    ["Coordonnées GPS / IP", coordsStr],
    ["Compétences déclarées", skillsStr],
    ["Disponible pour travaux", meta.available_for_work ? "OUI (Prêt pour missions)" : "Non spécifié"],
    ["IP & Fuseau", `${meta.ip || "-"} (${l.timezone || "-"})`]
  ].filter(r => r[1]);

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from,
        to: [RECIPIENT],
        reply_to: l.email,
        subject: `🎓 Nouvel apprenant / Membre travaux Anatec : ${l.name} (${locStr})`,
        html: `
          <div style="font-family:sans-serif;max-width:620px;margin:auto;padding:20px;border:1px solid #e2e8f0;border-radius:10px">
            <h2 style="color:#0f172a;margin-top:0">🎓 Nouvelle Inscription Plateforme Anatec</h2>
            <p style="color:#475569">Un nouvel utilisateur vient de s'inscrire sur le site Anatec. Ses coordonnées et sa géolocalisation ont été enregistrées pour vos futures délégations de travaux :</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              ${rows.map(([a, b]) => `<tr><th align="left" style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">${esc(a)}</th><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;font-weight:600">${esc(b)}</td></tr>`).join("")}
            </table>
            <div style="margin-top:20px;padding:12px;background:#f8fafc;border-radius:8px">
              <a href="mailto:${esc(l.email)}?subject=Opportunité de mission Anatec" style="display:inline-block;background:#dcb96e;color:#06090d;font-weight:bold;padding:8px 16px;border-radius:6px;text-decoration:none">📧 Proposer un travail par E-mail</a>
              ${l.phone ? `<a href="https://wa.me/${esc(String(l.phone).replace(/[^0-9]/g, ''))}" style="display:inline-block;margin-left:10px;background:#25D366;color:#ffffff;font-weight:bold;padding:8px 16px;border-radius:6px;text-decoration:none">💬 WhatsApp</a>` : ''}
            </div>
          </div>
        `
      })
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
    const keyDetails = getKeyDetails(key);
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
        role: keyDetails.role,
        keyRef: keyDetails.ref,
        targetUrl: url,
        urlConfigured: !!process.env.SUPABASE_URL || !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        status: dbStatus,
        error: dbError
      },
      email: {
        resendConfigured: !!process.env.RESEND_API_KEY,
        recipientConfigured: !!process.env.NOTIFY_EMAIL
      }
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST, GET" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });
  const d = body(req); if (!d) return send(res, 400, { error: "invalid_submission" });
  if (clean(d.website, 200)) return send(res, 200, { success: true });

  // 1. Détection IP et géolocalisation Vercel Edge en temps réel
  const clientIp = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "127.0.0.1";
  const vercelCity = req.headers["x-vercel-ip-city"] ? decodeURIComponent(req.headers["x-vercel-ip-city"]) : "";
  const vercelCountry = req.headers["x-vercel-ip-country"] || "";
  const vercelRegion = req.headers["x-vercel-ip-country-region"] || "";
  const vercelLat = req.headers["x-vercel-ip-latitude"] ? parseFloat(req.headers["x-vercel-ip-latitude"]) : null;
  const vercelLon = req.headers["x-vercel-ip-longitude"] ? parseFloat(req.headers["x-vercel-ip-longitude"]) : null;
  const vercelTz = req.headers["x-vercel-ip-timezone"] || "";

  // 2. Coordonnées envoyées par le navigateur (GPS / HTML5 Geolocation API)
  const clientCoords = (d.coords && typeof d.coords === "object") ? d.coords : null;
  const lat = clientCoords && typeof clientCoords.latitude === "number" ? clientCoords.latitude : vercelLat;
  const lon = clientCoords && typeof clientCoords.longitude === "number" ? clientCoords.longitude : vercelLon;
  const accuracy = clientCoords && typeof clientCoords.accuracy === "number" ? clientCoords.accuracy : null;

  const cityDeclared = clean(d.city, 80) || vercelCity || "Niamey";
  const countryDeclared = clean(d.country, 80) || vercelCountry || "Niger";
  const skillsDeclared = Array.isArray(d.skills) ? d.skills.map(s => clean(s, 50)).filter(Boolean) : (clean(d.skills, 200) ? [clean(d.skills, 200)] : []);
  const levelDeclared = clean(d.level, 60) || "Débutant";
  const availableForWork = d.available_for_work !== false; // Actif par défaut

  // Construction d'une organisation représentative
  const orgField = clean(d.organization, 100) || `${cityDeclared}, ${countryDeclared} (${levelDeclared})`;

  // Métadonnées JSON complètes et structurées dans le champ `notes`
  const metaObject = {
    realtime_geo: {
      city: cityDeclared,
      country: countryDeclared,
      region: vercelRegion || null,
      lat: lat,
      lon: lon,
      accuracy_m: accuracy,
      source: clientCoords ? "GPS Navigateur Temps Réel" : (vercelCountry ? "Vercel Geo IP" : "Déclaration utilisateur"),
      updated_at: new Date().toISOString()
    },
    work_profile: {
      available_for_work: availableForWork,
      level: levelDeclared,
      skills: skillsDeclared,
      declared_organization: clean(d.organization, 100) || null
    },
    login_info: {
      ip: clientIp,
      timezone: clean(d.timezone, 100) || vercelTz,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      login_count: 1
    }
  };

  const lead = {
    name: clean(d.name, 80),
    email: clean(d.email, 120).toLowerCase(),
    phone: clean(d.phone, 30) || null,
    organization: orgField.slice(0, 100),
    lang: d.lang === "en" ? "en" : "fr",
    timezone: clean(d.timezone, 100) || vercelTz,
    referrer: clean(d.referrer, 200) || null,
    user_agent: clean(d.user_agent, 300),
    notes: JSON.stringify(metaObject)
  };

  if (lead.name.length < 2 || !EMAIL.test(lead.email) || d.consent !== true) {
    return send(res, 400, { error: "invalid_submission" });
  }

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
    mailRes = await notify(lead, {
      city: cityDeclared,
      country: countryDeclared,
      lat,
      lon,
      skills: skillsDeclared,
      available_for_work: availableForWork,
      ip: clientIp
    });
    mailed = mailRes && mailRes.ok === true;
  } catch (e) {
    console.error("Mail Error:", e.message);
    mailRes = { ok: false, error: e.message };
  }

  if (!saved && !mailed) {
    return send(res, 502, {
      error: "registration_failed",
      debug: { db: dbErr, mail: mailRes }
    });
  }

  return send(res, 200, {
    success: true,
    user: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      organization: lead.organization,
      city: cityDeclared,
      country: countryDeclared,
      skills: skillsDeclared,
      available_for_work: availableForWork
    }
  });
};
