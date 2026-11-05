const {
  send, body, clean, sameOrigin, db, makeToken, isAdmin, safeEq,
  getClientIp, hashPassword, verifyPassword,
  checkRateLimit, recordFailedAttempt, resetAttempts
} = require("./_lib");

const STATUS = ["nouveau", "contacte", "qualifie", "archive"];
const uuid = v => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const OWNER_EMAIL = (process.env.NOTIFY_EMAIL || "anarouachamsoudine010@gmail.com").toLowerCase();

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });

  const d = body(req);
  if (!d) return send(res, 400, { error: "invalid_json" });

  const ip = getClientIp(req);

  // 1. Réinitialisation sécurisée du mot de passe
  if (d.action === "reset_password") {
    const email = clean(d.email, 120).toLowerCase();
    const phone = clean(d.phone, 30).replace(/[^0-9]/g, "");
    const newPassword = String(d.new_password || "").trim();

    if (email !== OWNER_EMAIL) {
      return send(res, 403, { error: "unauthorized_reset", message: "Adresse e-mail non autorisée à réinitialiser l'accès." });
    }

    // Vérification du numéro de téléphone propriétaire (doit correspondre à 91038061)
    if (!phone.includes("91038061")) {
      return send(res, 403, { error: "unauthorized_reset", message: "Numéro de téléphone de vérification incorrect." });
    }

    if (newPassword.length < 8) {
      return send(res, 400, { error: "weak_password", message: "Le nouveau mot de passe doit comporter au moins 8 caractères." });
    }

    try {
      const storedHash = hashPassword(newPassword);
      // Enregistrement persistant du hash dans Supabase
      await db("leads?on_conflict=email", {
        method: "POST",
        data: {
          email: "system-admin-hash@internal",
          name: "ADMIN_CONFIG",
          notes: storedHash,
          status: "archive"
        },
        prefer: "resolution=merge-duplicates,return=minimal"
      });

      resetAttempts(ip);
      return send(res, 200, { success: true, message: "Mot de passe administrateur réinitialisé avec succès !" });
    } catch (e) {
      console.error("Erreur reset_password:", e.message);
      return send(res, 500, { error: "db_error", message: "Erreur lors de l'enregistrement du nouveau mot de passe." });
    }
  }

  // 2. Connexion Administrateur
  if (d.action === "login") {
    // Vérification du Rate Limiting
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return send(res, 429, {
        error: "rate_limited",
        message: `Trop de tentatives infructueuses. Accès temporairement suspendu. Réessayez dans ${rate.remainingMin} minute(s).`
      });
    }

    const input = String(d.password || "");
    let isMatch = false;

    // A) Vérifier d'abord si un mot de passe mis à jour existe dans Supabase
    try {
      const records = await db("leads?email=eq.system-admin-hash@internal&select=notes&limit=1");
      if (records && records.length > 0 && records[0].notes) {
        isMatch = verifyPassword(input, records[0].notes);
      }
    } catch (e) {
      console.error("Vérification hash Supabase:", e.message);
    }

    // B) Si non trouvé ou non vérifié, vérifier avec ADMIN_PASSWORD ou la clé initiale
    if (!isMatch) {
      const envPw = (process.env.ADMIN_PASSWORD || "").trim();
      const initialPw = "Chamsoudine2026#";
      isMatch = (envPw && safeEq(input, envPw)) || safeEq(input, initialPw);
    }

    if (!isMatch) {
      recordFailedAttempt(ip);
      return send(res, 401, { error: "bad_credentials", message: "Mot de passe incorrect." });
    }

    resetAttempts(ip);
    return send(res, 200, { success: true }, {
      "Set-Cookie": `adm=${makeToken()}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200`
    });
  }

  // 3. Déconnexion
  if (d.action === "logout") {
    return send(res, 200, { success: true }, {
      "Set-Cookie": `adm=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`
    });
  }

  // Toutes les actions suivantes requièrent d'être authentifié comme admin
  if (!isAdmin(req)) return send(res, 401, { error: "unauthorized" });

  try {
    switch (d.action) {
      case "list": {
        const [leadsRaw, tasks] = await Promise.all([
          db("leads?select=*&order=created_at.desc&limit=1000"),
          db("tasks?select=*&order=done.asc,due.asc.nullslast&limit=1000")
        ]);
        // Ne pas exposer l'entrée interne de configuration
        const leads = (leadsRaw || []).filter(l => l.email !== "system-admin-hash@internal");
        return send(res, 200, { leads, tasks });
      }
      case "lead_update": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        const patch = {};
        if (STATUS.includes(d.status)) patch.status = d.status;
        if (typeof d.notes === "string") patch.notes = d.notes.slice(0, 2000);
        await db(`leads?id=eq.${d.id}`, { method: "PATCH", data: patch, prefer: "return=minimal" });
        return send(res, 200, { success: true });
      }
      case "lead_delete": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        await db(`leads?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" });
        return send(res, 200, { success: true });
      }
      case "task_add": {
        const title = clean(d.title, 200);
        if (!title) return send(res, 400, { error: "bad_title" });
        const t = {
          title,
          due: /^\d{4}-\d{2}-\d{2}$/.test(d.due || "") ? d.due : null,
          lead_id: uuid(d.lead_id) ? d.lead_id : null
        };
        const resTask = await db("tasks", { method: "POST", data: t });
        return send(res, 200, { task: resTask[0] });
      }
      case "task_toggle": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        await db(`tasks?id=eq.${d.id}`, { method: "PATCH", data: { done: !!d.done }, prefer: "return=minimal" });
        return send(res, 200, { success: true });
      }
      case "task_delete": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        await db(`tasks?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" });
        return send(res, 200, { success: true });
      }
      default:
        return send(res, 400, { error: "unknown_action" });
    }
  } catch (e) {
    console.error("Admin action error:", e.code, e.message);
    return send(res, e.code === "db_not_configured" ? 503 : 502, { error: e.code || "server_error" });
  }
};
