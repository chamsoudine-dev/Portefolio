const RECIPIENT = "anarouachamsoudine010@gmail.com";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function sendJson(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export default async (req) => {
  if (req.method !== "POST") {
    return sendJson(405, { error: "method_not_allowed" }, { Allow: "POST" });
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || new URL(req.url).host;
  if (!origin || !host) {
    return sendJson(403, { error: "invalid_origin" });
  }

  try {
    if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
      return sendJson(403, { error: "invalid_origin" });
    }
  } catch {
    return sendJson(403, { error: "invalid_origin" });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return sendJson(400, { error: "invalid_json" });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return sendJson(400, { error: "invalid_submission" });
  }

  if (clean(data.website, 200)) {
    return sendJson(200, { success: true });
  }

  const name = clean(data.name, 80);
  const email = clean(data.email, 120).toLowerCase();
  if (name.length < 2 || !EMAIL_PATTERN.test(email) || data.consent !== true) {
    return sendJson(400, { error: "invalid_submission" });
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

  try {
    const upstream = await fetch(`https://formsubmit.co/ajax/${RECIPIENT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // FormSubmit rejects AJAX requests that don't come from a web page.
        Origin: origin,
        Referer: `${origin}/`
      },
      body: JSON.stringify({
        _subject: `Nouvelle inscription portfolio : ${submission.name}`,
        _captcha: "false",
        _template: "table",
        ...submission
      }),
      signal: AbortSignal.timeout(12000)
    });

    if (!upstream.ok) {
      console.error("FormSubmit returned HTTP", upstream.status);
      return sendJson(502, {
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
      return sendJson(502, { error: "invalid_email_service_response" });
    }

    if (responseData.success !== true && responseData.success !== "true") {
      console.error("FormSubmit reported that it did not accept the submission:", responseData.message);
      return sendJson(502, { error: "email_service_rejected_submission" });
    }

    return sendJson(200, { success: true });
  } catch (error) {
    const timedOut = error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(timedOut ? "FormSubmit request timed out" : "FormSubmit request failed");
    return sendJson(502, {
      error: timedOut ? "email_service_timeout" : "email_service_unavailable"
    });
  }
};

export const config = {
  path: "/api/inscription"
};
