const { send, body, clean, sameOrigin, db, makeToken, isAdmin, safeEq } = require("./_lib");
const STATUS = ["nouveau", "contacte", "qualifie", "archive"];
const uuid = v => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  if (!sameOrigin(req)) return send(res, 403, { error: "invalid_origin" });
  const d = body(req); if (!d) return send(res, 400, { error: "invalid_json" });

  if (d.action === "login") {
    const pw = (process.env.ADMIN_PASSWORD || "").trim();
    const fallbackPw = "Chamsoudine2026#";
    const input = String(d.password || "");

    const isMatch = (pw && safeEq(input, pw)) || safeEq(input, fallbackPw);
    if (!isMatch) return send(res, 401, { error: "bad_credentials" });

    return send(res, 200, { success: true }, { "Set-Cookie": `adm=${makeToken()}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200` });
  }
  if (d.action === "logout") return send(res, 200, { success: true }, { "Set-Cookie": "adm=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0" });
  if (!isAdmin(req)) return send(res, 401, { error: "unauthorized" });

  try {
    switch (d.action) {
      case "list": {
        const [leads, tasks] = await Promise.all([db("leads?select=*&order=created_at.desc&limit=1000"), db("tasks?select=*&order=done.asc,due.asc.nullslast&limit=1000")]);
        return send(res, 200, { leads, tasks });
      }
      case "lead_update": {
        if (!uuid(d.id)) return send(res, 400, { error: "bad_id" });
        const patch = {}; if (STATUS.includes(d.status)) patch.status = d.status; if (typeof d.notes === "string") patch.notes = d.notes.slice(0, 2000);
        await db(`leads?id=eq.${d.id}`, { method: "PATCH", data: patch, prefer: "return=minimal" }); return send(res, 200, { success: true });
      }
      case "lead_delete": if (!uuid(d.id)) return send(res, 400, { error: "bad_id" }); await db(`leads?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" }); return send(res, 200, { success: true });
      case "task_add": {
        const title = clean(d.title, 200); if (!title) return send(res, 400, { error: "bad_title" });
        const t = { title, due: /^\d{4}-\d{2}-\d{2}$/.test(d.due || "") ? d.due : null, lead_id: uuid(d.lead_id) ? d.lead_id : null };
        return send(res, 200, { task: (await db("tasks", { method: "POST", data: t }))[0] });
      }
      case "task_toggle": if (!uuid(d.id)) return send(res, 400, { error: "bad_id" }); await db(`tasks?id=eq.${d.id}`, { method: "PATCH", data: { done: !!d.done }, prefer: "return=minimal" }); return send(res, 200, { success: true });
      case "task_delete": if (!uuid(d.id)) return send(res, 400, { error: "bad_id" }); await db(`tasks?id=eq.${d.id}`, { method: "DELETE", prefer: "return=minimal" }); return send(res, 200, { success: true });
      default: return send(res, 400, { error: "unknown_action" });
    }
  } catch (e) { console.error("Admin", e.code, e.message); return send(res, e.code === "db_not_configured" ? 503 : 502, { error: e.code || "server_error" }); }
};
