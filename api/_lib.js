const crypto = require("crypto");
const send = (res, s, b, h = {}) => { Object.entries(h).forEach(([k, v]) => res.setHeader(k, v)); res.status(s).setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(b)); };
const body = req => { let d = req.body; if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } } return d && typeof d === "object" && !Array.isArray(d) ? d : null; };
const clean = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
const sameOrigin = req => { try { return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host; } catch { return false; } };

// Base de données : Supabase via REST (aucune dépendance npm)
function getSupabaseKey() {
  const k = process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_KEY
    || process.env.SUPABASE_API_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_KEY
    || "";
  return k.trim();
}

function getKeyDetails(rawKey) {
  if (!rawKey) return { role: "none", ref: null };
  if (rawKey.startsWith("sb_secret_")) return { role: "service_role (new format)", ref: null };
  if (rawKey.startsWith("sb_publishable_")) return { role: "anon (new format)", ref: null };
  try {
    const parts = rawKey.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      return { role: payload.role || "unknown_jwt", ref: payload.ref || null, iss: payload.iss || null };
    }
  } catch {}
  return { role: "custom", ref: null };
}

function getKeyRole(rawKey) {
  return getKeyDetails(rawKey).role;
}

function getSupabaseUrl() {
  const key = getSupabaseKey();
  const details = getKeyDetails(key);
  // Si le token JWT contient le project ref (ex: xeztwmpmnxmmuxzfqmph),
  // l'URL doit correspondre à ce projet pour éviter le 401 "Invalid API key"
  if (details.ref) {
    return `https://${details.ref}.supabase.co`;
  }
  const u = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || "https://xeztwmpmnxmmuxzfqmph.supabase.co";
  return (u || "").trim().replace(/\/$/, "");
}

async function db(path, { method = "GET", data, prefer } = {}) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!url || !key) throw Object.assign(new Error("db_not_configured"), { code: "db_not_configured" });
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation"
    },
    body: data ? JSON.stringify(data) : undefined
  });
  const txt = await r.text();
  if (!r.ok) {
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch {}
    const err = new Error(txt);
    err.code = parsed && (parsed.code || parsed.error) ? (parsed.code || parsed.error) : "db_error";
    err.status = r.status;
    err.details = parsed || txt;
    throw err;
  }
  return txt ? JSON.parse(txt) : [];
}

// Session admin : cookie signé HMAC (12 h), sans stockage serveur
const secret = () => process.env.SESSION_SECRET || "chamsoudine_portfolio_secret_key_2026_fallback";
const sign = v => crypto.createHmac("sha256", secret()).update(v).digest("hex");
const makeToken = () => { const exp = Date.now() + 12 * 3600e3; return `${exp}.${sign(String(exp))}`; };
function isAdmin(req) {
  if (!secret()) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || ""); if (!m) return false;
  const [exp, sig] = m[1].split("."); if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp)); return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const safeEq = (a, b) => { const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest(); return crypto.timingSafeEqual(x, y); };
const getClientIp = req => {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "127.0.0.1";
};

// Sécurité : Hachage PBKDF2 standard NIST (100,000 itérations SHA-256 + sel 16 octets)
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, originalHash] = stored.split(":");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(originalHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Sécurité : Protection contre les attaques par force brute (Rate Limiter)
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.blockedUntil && record.blockedUntil > now) {
    const remainingMin = Math.ceil((record.blockedUntil - now) / 60000);
    return { allowed: false, remainingMin };
  }
  if (now - record.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true, count: record.count };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  record.count++;
  if (record.count >= 5) {
    record.blockedUntil = now + 15 * 60 * 1000; // Blocage temporaire 15 minutes
  }
  loginAttempts.set(ip, record);
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

module.exports = {
  send, body, clean, sameOrigin, db, makeToken, isAdmin, safeEq,
  getSupabaseUrl, getSupabaseKey, getKeyRole, getKeyDetails,
  getClientIp, hashPassword, verifyPassword,
  checkRateLimit, recordFailedAttempt, resetAttempts
};
