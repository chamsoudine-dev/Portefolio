const RECIPIENT = "anarouachamsoudine010@gmail.com";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
  }

  const siteUrl = new URL(req.url);
  const origin = req.headers.get("origin");
  try {
    if (!origin || new URL(origin).host.toLowerCase() !== siteUrl.host.toLowerCase()) {
      return Response.json({ error: "invalid_origin" }, { status: 403 });
    }
  } catch {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }

  let data: any;
  try {
    data = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Response.json({ error: "invalid_submission" }, { status: 400 });
  }

  // Honeypot : un robot a rempli le champ caché, on fait semblant d'accepter.
  if (clean(data.website, 200)) {
    return Response.json({ success: true });
  }

  const name = clean(data.name, 80);
  const email = clean(data.email, 120).toLowerCase();
  if (name.length < 2 || !EMAIL_PATTERN.test(email) || data.consent !== true) {
    return Response.json({ error: "invalid_submission" }, { status: 400 });
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
        // FormSubmit associe l'activation au site d'origine.
        Origin: siteUrl.origin,
        Referer: `${siteUrl.origin}/`
      },
      body: JSON.stringify({
        _subject: `Nouvelle inscription portfolio : ${submission.name}`,
        _captcha: "false",
        _template: "table",
        _replyto: submission.email,
        ...submission
      }),
      signal: AbortSignal.timeout(12000)
    });

    const responseText = await upstream.text();
    let responseData: any = null;
    try {
      responseData = JSON.parse(responseText);
    } catch {}

    if (!upstream.ok || !responseData) {
      console.error("FormSubmit returned HTTP", upstream.status);
      return Response.json({ error: "email_service_unavailable", upstreamStatus: upstream.status }, { status: 502 });
    }

    if (responseData.success !== true && responseData.success !== "true") {
      // Ex. : "This form needs Activation" tant que le lien d'activation n'a pas été cliqué.
      console.error("FormSubmit rejected the submission:", clean(responseData.message, 200));
      return Response.json({ error: "email_service_rejected_submission" }, { status: 502 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error(timedOut ? "FormSubmit request timed out" : "FormSubmit request failed");
    return Response.json({ error: timedOut ? "email_service_timeout" : "email_service_unavailable" }, { status: 502 });
  }
};

export const config = {
  path: "/api/inscription"
};
