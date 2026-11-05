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

  try {
    const leads = await db(`leads?email=eq.${encodeURIComponent(email)}&select=id,name,email,phone,organization,created_at&limit=1`);
    if (!leads || leads.length === 0) {
      return send(res, 404, {
        error: "not_found",
        message: "Aucun compte associé à cette adresse e-mail. Veuillez d'abord vous inscrire."
      });
    }

    const lead = leads[0];

    // Vérification souple du téléphone si l'utilisateur l'a renseigné
    if (phone && lead.phone) {
      const cleanInput = phone.replace(/[^0-9]/g, "");
      const cleanDb = lead.phone.replace(/[^0-9]/g, "");
      // Si les numéros ont été renseignés des deux côtés mais ne correspondent pas (sur les derniers 6 chiffres)
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
    } else if (phone && !lead.phone) {
      // Mettre à jour le téléphone s'il n'était pas renseigné
      try {
        await db(`leads?id=eq.${lead.id}`, { method: "PATCH", data: { phone } });
        lead.phone = phone;
      } catch (e) {
        console.error("Erreur mise à jour téléphone:", e.message);
      }
    }

    return send(res, 200, {
      success: true,
      user: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        organization: lead.organization
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
