const crypto = require("crypto");
const send = (res, s, b, h = {}) => { Object.entries(h).forEach(([k, v]) => res.setHeader(k, v)); res.status(s).setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(b)); };
const body = req => { let d = req.body; if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } } return d && typeof d === "object" && !Array.isArray(d) ? d : null; };
const clean = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
const sameOrigin = req => { try { return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host; } catch { return false; } };

// Base de données : Supabase via REST (aucune dépendance npm)
async function db(path, { method = "GET", data, prefer } = {}) {
  const url = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || "https://xeztwmpmnxmmuxzfqmph.supabase.co";
  const key = process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw Object.assign(new Error("db_not_configured"), { code: "db_not_configured" });
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: prefer || "return=representation" },
    body: data ? JSON.stringify(data) : undefined
  });
  const txt = await r.text();
  if (!r.ok) throw Object.assign(new Error(txt), { code: "db_error", status: r.status });
  return txt ? JSON.parse(txt) : [];
}

// Session admin : cookie signé HMAC (12 h), sans stockage serveur
const secret = () => process.env.SESSION_SECRET || "";
const sign = v => crypto.createHmac("sha256", secret()).update(v).digest("hex");
const makeToken = () => { const exp = Date.now() + 12 * 3600e3; return `${exp}.${sign(String(exp))}`; };
function isAdmin(req) {
  if (!secret()) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return false;
  const [exp, sig] = m[1].split("."); if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp)); return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const safeEq = (a, b) => { const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest(); return crypto.timingSafeEqual(x, y); };
module.exports = { send, body, clean, sameOrigin, db, makeToken, isAdmin, safeEq };
