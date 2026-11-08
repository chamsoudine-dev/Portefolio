const { send, body, clean, sameOrigin, db } = require("./_lib");
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });

  const d = body(req);
  if (!d) return send(res, 400, { error: "invalid_json" });

  const email = clean(d.email, 120).toLowerCase();
  const phone = clean(d.phone, 30);

  if (!EMAIL.test(email)) {
    return send(res, 400, { error: "invalid_email", message: "Adresse e-mail invalide." });
  }

  // 1. Détection IP et géolocalisation Vercel Edge en temps réel lors de la connexion
  const clientIp = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "127.0.0.1";
  const vercelCity = req.headers["x-vercel-ip-city"] ? decodeURIComponent(req.headers["x-vercel-ip-city"]) : "";
  const vercelCountry = req.headers["x-vercel-ip-country"] || "";
  const vercelRegion = req.headers["x-vercel-ip-country-region"] || "";
  const vercelLat = req.headers["x-vercel-ip-latitude"] ? parseFloat(req.headers["x-vercel-ip-latitude"]) : null;
  const vercelLon = req.headers["x-vercel-ip-longitude"] ? parseFloat(req.headers["x-vercel-ip-longitude"]) : null;

  // 2. Coordonnées envoyées par le navigateur (GPS temps réel)
  const clientCoords = (d.coords && typeof d.coords === "object") ? d.coords : null;
  const lat = clientCoords && typeof clientCoords.latitude === "number" ? clientCoords.latitude : vercelLat;
  const lon = clientCoords && typeof clientCoords.longitude === "number" ? clientCoords.longitude : vercelLon;
  const accuracy = clientCoords && typeof clientCoords.accuracy === "number" ? clientCoords.accuracy : null;

  try {
    const leads = await db(`leads?email=eq.${encodeURIComponent(email)}&select=id,name,email,phone,organization,notes,created_at&limit=1`);
    if (!leads || leads.length === 0) {
      return send(res, 404, {
        error: "not_found",
        message: "Aucun compte associé à cette adresse e-mail. Veuillez d'abord vous inscrire gratuitement."
      });
    }

    const lead = leads[0];

    // Vérification souple du téléphone si l'utilisateur l'a renseigné
    if (phone && lead.phone) {
      const cleanInput = phone.replace(/[^0-9]/g, "");
      const cleanDb = lead.phone.replace(/[^0-9]/g, "");
      if (cleanInput.length >= 6 && cleanDb.length >= 6) {
        const tailInput = cleanInput.slice(-6);
        const tailDb = cleanDb.slice(-6);
        if (tailInput !== tailDb) {
          return send(res, 401, {
            error: "phone_mismatch",
            message: "Le numéro de téléphone ne correspond pas à celui enregistré lors de votre inscription."
          });
        }
      }
    }

    // Mise à jour de la localisation en temps réel dans la base de données
    let currentNotes = {};
    try {
      currentNotes = JSON.parse(lead.notes || "{}");
    } catch {
      currentNotes = { raw_notes: lead.notes || "" };
    }

    const previousLogins = (currentNotes.login_info && Array.isArray(currentNotes.login_info.history))
      ? currentNotes.login_info.history
      : [];

    const nowIso = new Date().toISOString();
    const cityNow = vercelCity || (currentNotes.realtime_geo && currentNotes.realtime_geo.city) || "Niamey";
    const countryNow = vercelCountry || (currentNotes.realtime_geo && currentNotes.realtime_geo.country) || "Niger";

    currentNotes.realtime_geo = {
      city: cityNow,
      country: countryNow,
      region: vercelRegion || (currentNotes.realtime_geo && currentNotes.realtime_geo.region) || null,
      lat: lat !== null ? lat : (currentNotes.realtime_geo ? currentNotes.realtime_geo.lat : null),
      lon: lon !== null ? lon : (currentNotes.realtime_geo ? currentNotes.realtime_geo.lon : null),
      accuracy_m: accuracy || (currentNotes.realtime_geo ? currentNotes.realtime_geo.accuracy_m : null),
      source: clientCoords ? "GPS Navigateur Temps Réel" : (vercelCountry ? "Vercel Geo IP" : "Dernière connexion"),
      updated_at: nowIso
    };

    const loginCount = ((currentNotes.login_info && currentNotes.login_info.login_count) || 1) + 1;
    currentNotes.login_info = {
      ip: clientIp,
      last_seen: nowIso,
      first_seen: (currentNotes.login_info && currentNotes.login_info.first_seen) || lead.created_at || nowIso,
      login_count: loginCount,
      history: [
        { at: nowIso, ip: clientIp, city: cityNow, country: countryNow },
        ...previousLogins.slice(0, 9)
      ]
    };

    // Préparer le patch en base de données
    const patchData = {
      notes: JSON.stringify(currentNotes)
    };
    if (phone && !lead.phone) {
      patchData.phone = phone;
      lead.phone = phone;
    }

    try {
      await db(`leads?id=eq.${lead.id}`, { method: "PATCH", data: patchData, prefer: "return=minimal" });
    } catch (patchErr) {
      console.error("Erreur mise à jour realtime_geo connexion:", patchErr.message);
    }

    return send(res, 200, {
      success: true,
      user: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        organization: lead.organization,
        city: cityNow,
        country: countryNow,
        skills: (currentNotes.work_profile && currentNotes.work_profile.skills) || [],
        available_for_work: currentNotes.work_profile ? currentNotes.work_profile.available_for_work : true
      }
    });
  } catch (err) {
    console.error("Connexion error:", err.code, err.status, err.message);
    return send(res, 500, {
      error: "db_error",
      message: "Erreur lors de la vérification. Réessayez dans un instant."
    });
  }
};
