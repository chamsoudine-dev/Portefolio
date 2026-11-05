const {
  send, body, clean, sameOrigin, db, makeToken, isAdmin, safeEq,
  getClientIp, hashPassword, verifyPassword,
  checkRateLimit, recordFailedAttempt, resetAttempts
} = require("./_lib");

const STATUS = ["nouveau", "contacte", "qualifie", "archive"];
const uuid = v => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const OWNER_EMAIL = (process.env.NOTIFY_EMAIL || "anarouachamsoudine010@gmail.com").toLowerCase();
const SARKIN_WANKA_URL = "https://sarkin-wanka.vercel.app";

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });

  const d = body(req);
  if (!d) return send(res, 400, { error: "invalid_json" });

  const ip = getClientIp(req);

  // 1. Réinitialisation sécurisée du mot de passe admin
  if (d.action === "reset_password") {
    const email = clean(d.email, 120).toLowerCase();
    const phone = clean(d.phone, 30).replace(/[^0-9]/g, "");
    const newPassword = String(d.new_password || "").trim();

    if (email !== OWNER_EMAIL) {
      return send(res, 403, { error: "unauthorized_reset", message: "Adresse e-mail non autorisée à réinitialiser l'accès." });
    }

    if (!phone.includes("91038061")) {
      return send(res, 403, { error: "unauthorized_reset", message: "Numéro de téléphone de vérification incorrect." });
    }

    if (newPassword.length < 8) {
      return send(res, 400, { error: "weak_password", message: "Le nouveau mot de passe doit comporter au moins 8 caractères." });
    }

    try {
      const storedHash = hashPassword(newPassword);
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
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return send(res, 429, {
        error: "rate_limited",
        message: `Trop de tentatives infructueuses. Accès suspendu temporairement. Réessayez dans ${rate.remainingMin} minute(s).`
      });
    }

    const input = String(d.password || "");
    let isMatch = false;

    // A) Vérifier d'abord le mot de passe personnalisé dans Supabase
    try {
      const records = await db("leads?email=eq.system-admin-hash@internal&select=notes&limit=1");
      if (records && records.length > 0 && records[0].notes) {
        isMatch = verifyPassword(input, records[0].notes);
      }
    } catch (e) {
      console.error("Vérification hash Supabase:", e.message);
    }

    // B) Si non vérifié, vérifier avec ADMIN_PASSWORD ou le mot de passe initial
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
      /* ====================================================================
         SECTION 1 : PORTFOLIO CHAMSOUDINE ANAROUA
         ==================================================================== */
      case "list": {
        const [leadsRaw, tasks] = await Promise.all([
          db("leads?select=*&order=created_at.desc&limit=1000"),
          db("tasks?select=*&order=done.asc,due.asc.nullslast&limit=1000")
        ]);
        // Isoler les leads du portfolio (exclure les données Sarkin Wanka et le système)
        const leads = (leadsRaw || []).filter(l =>
          l.email !== "system-admin-hash@internal" &&
          !l.email.endsWith("@sarkin-wanka.internal")
        );
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

      /* ====================================================================
         SECTION 2 : SUPERVISION & GESTION SARKIN WANKA FASHION DESIGN
         ==================================================================== */
      // A) Sonde de disponibilité et santé du site Sarkin Wanka en direct
      case "sw_ping": {
        const t0 = Date.now();
        try {
          const rPing = await fetch(SARKIN_WANKA_URL, {
            method: "GET",
            signal: AbortSignal.timeout(7000),
            headers: { "User-Agent": "Chamsoudine-Monitor/1.0" }
          });
          const latency = Date.now() - t0;
          return send(res, 200, {
            online: rPing.ok,
            status: rPing.status,
            latencyMs: latency,
            url: SARKIN_WANKA_URL,
            ssl: true,
            checkedAt: new Date().toISOString()
          });
        } catch (errPing) {
          return send(res, 200, {
            online: false,
            status: 0,
            latencyMs: Date.now() - t0,
            url: SARKIN_WANKA_URL,
            error: errPing.message,
            checkedAt: new Date().toISOString()
          });
        }
      }

      // B) Liste complète des Médias & Commandes Sarkin Wanka
      case "sw_data": {
        const allRecords = await db("leads?select=*&order=created_at.desc&limit=1000");

        const mediaList = [];
        const orderList = [];

        for (const item of allRecords) {
          if (!item.email || !item.email.endsWith("@sarkin-wanka.internal")) continue;

          let extra = {};
          try { extra = JSON.parse(item.notes || "{}"); } catch {}

          if (item.email.startsWith("sw-media-")) {
            mediaList.push({
              id: item.id,
              created_at: item.created_at,
              title: item.name,
              category: item.organization || "Couture Hommes",
              price: item.phone || "Sur devis",
              type: extra.type || "photo",
              media_url: extra.url || "",
              desc: extra.desc || "",
              badge: extra.badge || "Nouveau"
            });
          } else if (item.email.startsWith("sw-order-")) {
            orderList.push({
              id: item.id,
              created_at: item.created_at,
              client_name: item.name,
              phone: item.phone || "",
              model: item.organization || "Tenue sur mesure",
              measurements: extra.measurements || "",
              total: extra.total || 0,
              deposit: extra.deposit || 0,
              step: extra.step || "mesures",
              due_date: extra.due_date || ""
            });
          }
        }

        return send(res, 200, {
          media: mediaList,
          orders: orderList,
          stats: {
            totalMedia: mediaList.length,
            photos: mediaList.filter(m => m.type === "photo").length,
            videos: mediaList.filter(m => m.type === "video").length,
            activeOrders: orderList.filter(o => o.step !== "livre").length,
            completedOrders: orderList.filter(o => o.step === "livre").length
          }
        });
      }

      // C) Ajouter une Création (Photo ou Vidéo de couture)
      case "sw_media_add": {
        const title = clean(d.title, 120);
        const category = clean(d.category, 60) || "Hommes";
        const price = clean(d.price, 40) || "Sur devis";
        const type = d.type === "video" ? "video" : "photo";
        const url = clean(d.url, 500);
        const desc = clean(d.desc, 500);
        const badge = clean(d.badge, 30) || "Nouveau";

        if (!title || !url) {
          return send(res, 400, { error: "missing_fields", message: "Le titre et le lien de l'image/vidéo sont obligatoires." });
        }

        const uniqueEmail = `sw-media-${Date.now()}-${Math.floor(Math.random() * 1000)}@sarkin-wanka.internal`;
        const extraJson = JSON.stringify({ type, url, desc, badge });

        const inserted = await db("leads", {
          method: "POST",
          data: {
            name: title,
            email: uniqueEmail,
            organization: category,
            phone: price,
            notes: extraJson,
            status: "nouveau"
          }
        });

        return send(res, 200, { success: true, item: inserted[0] });
      }

      // D) Supprimer un Média
      case "sw_media_delete": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        await db(`leads?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" });
        return send(res, 200, { success: true });
      }

      // E) Ajouter une Commande / Devis client pour l'Atelier
      case "sw_order_add": {
        const client_name = clean(d.client_name, 100);
        const phone = clean(d.phone, 30);
        const model = clean(d.model, 120) || "Modèle personnalisé";
        const measurements = clean(d.measurements, 1000);
        const total = parseInt(d.total, 10) || 0;
        const deposit = parseInt(d.deposit, 10) || 0;
        const due_date = clean(d.due_date, 20);
        const step = clean(d.step, 30) || "mesures";

        if (!client_name || !phone) {
          return send(res, 400, { error: "missing_fields", message: "Le nom du client et son téléphone WhatsApp sont requis." });
        }

        const uniqueEmail = `sw-order-${Date.now()}-${Math.floor(Math.random() * 1000)}@sarkin-wanka.internal`;
        const extraJson = JSON.stringify({ measurements, total, deposit, due_date, step });

        const inserted = await db("leads", {
          method: "POST",
          data: {
            name: client_name,
            email: uniqueEmail,
            organization: model,
            phone: phone,
            notes: extraJson,
            status: "contacte"
          }
        });

        return send(res, 200, { success: true, item: inserted[0] });
      }

      // F) Mettre à jour l'étape ou le paiement d'une commande
      case "sw_order_update": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });

        const records = await db(`leads?id=eq.${d.id}&select=*&limit=1`);
        if (!records || records.length === 0) return send(res, 404, { error: "not_found" });

        const current = records[0];
        let extra = {};
        try { extra = JSON.parse(current.notes || "{}"); } catch {}

        if (d.step) extra.step = clean(d.step, 30);
        if (d.deposit !== undefined) extra.deposit = parseInt(d.deposit, 10) || 0;
        if (d.measurements !== undefined) extra.measurements = clean(d.measurements, 1000);

        await db(`leads?id=eq.${d.id}`, {
          method: "PATCH",
          data: { notes: JSON.stringify(extra) },
          prefer: "return=minimal"
        });

        return send(res, 200, { success: true });
      }

      // G) Supprimer une commande
      case "sw_order_delete": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        await db(`leads?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" });
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
