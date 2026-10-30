const RECIPIENT = "anarouachamsoudine010@gmail.com";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) {
    return sendJson(res, 403, { error: "invalid_origin" });
  }

  try {
    if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
      return sendJson(res, 403, { error: "invalid_origin" });
    }
  } catch {
    return sendJson(res, 403, { error: "invalid_origin" });
  }

  let data = req.body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return sendJson(res, 400, { error: "invalid_submission" });
  }

  if (clean(data.website, 200)) {
    return sendJson(res, 200, { success: true });
  }

  const name = clean(data.name, 80);
  const email = clean(data.email, 120).toLowerCase();
  if (name.length < 2 || !EMAIL_PATTERN.test(email) || data.consent !== true) {
    return sendJson(res, 400, { error: "invalid_submission" });
  }

  const submission = {
    name,
    email,
    phone: clean(data.phone, 30) || null,
    organization: clean(data.organization, 100) || null,
    consent: true,
    lang: data.lang === "en" ? "en" : "fr",
    timezone: clean(data.timezone, 100),
    user_agent: clean(data.user_agent, 300),
    referrer: clean(data.referrer, 200) || null
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(`https://formsubmit.co/ajax/${RECIPIENT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        _subject: `Nouvelle inscription portfolio : ${submission.name}`,
        _captcha: "false",
        _template: "table",
        ...submission
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      console.error("FormSubmit returned HTTP", upstream.status);
      return sendJson(res, 502, {
        error: "email_service_unavailable",
        upstreamStatus: upstream.status
      });
    }

    const responseText = await upstream.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error("FormSubmit returned a non-JSON success response");
      return sendJson(res, 502, { error: "invalid_email_service_response" });
    }

    if (responseData.success !== true && responseData.success !== "true") {
      console.error("FormSubmit reported that it did not accept the submission");
      return sendJson(res, 502, { error: "email_service_rejected_submission" });
    }

    return sendJson(res, 200, { success: true });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    console.error(timedOut ? "FormSubmit request timed out" : "FormSubmit request failed");
    return sendJson(res, 502, {
      error: timedOut ? "email_service_timeout" : "email_service_unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
