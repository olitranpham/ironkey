// Transactional email via Resend's REST API (no SDK). Needs RESEND_API_KEY and
// EMAIL_FROM ("no-reply@ironkeyentry.com" or "Ironkey <no-reply@…>"); until
// both are set, emailEnabled() is false and callers hide / refuse email.
// Every email is sent as "ironkey <address>", whatever name EMAIL_FROM has.

const RESEND_URL = 'https://api.resend.com/emails'

export function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

const SENDER_NAME = 'ironkey'

/** Bare address from EMAIL_FROM, with or without a display name. */
function fromAddress() {
  const from = process.env.EMAIL_FROM ?? ''
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim()
}

/** "ironkey <no-reply@ironkeyentry.com>" — any display name in EMAIL_FROM is replaced. */
export function fromHeader() {
  return `${SENDER_NAME} <${fromAddress()}>`
}

/**
 * Send one email. Throws on failure (callers decide what to tell the user);
 * never logs the body, which may hold a code or a payment link.
 *
 * @param {{ to: string, subject: string, html: string, text: string }} message
 * @returns {Promise<{ id: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!emailEnabled()) throw Object.assign(new Error('email is not configured'), { status: 503 })
  const res = await fetch(RESEND_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from: fromHeader(),
      to:   [to],
      subject,
      html,
      text,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`resend ${res.status}: ${json.message ?? json.name ?? 'send failed'}`)
  return { id: json.id }
}

// ── Templates ─────────────────────────────────────────────────────────────────
// Same look as the public pages: #292929 page, #1c1c1c card, lowercase copy,
// the gym's logo when it has one (made absolute — email clients need a URL).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function gymDisplayName(gym) {
  return String(gym?.name ?? gym?.slug ?? '').replace(/-/g, ' ')
}

function logoUrl(gym) {
  const logo = gym?.logoUrl
  if (!logo || logo.startsWith('data:')) return null
  if (/^https?:\/\//.test(logo)) return logo
  const base = process.env.NEXT_PUBLIC_APP_URL
  return base ? `${base.replace(/\/$/, '')}${logo.startsWith('/') ? '' : '/'}${logo}` : null
}

const FOOTER_URL = 'https://ironkeyentry.com/'

/** "© {year} · powered by ironkey llc" — year taken at send time. */
function footerHtml() {
  return `© ${new Date().getFullYear()} · powered by <a href="${FOOTER_URL}" style="color:#525252;text-decoration:underline;">ironkey llc</a>`
}

function footerText() {
  return `© ${new Date().getFullYear()} · powered by ironkey llc (${FOOTER_URL})`
}

/** The gym's customer-facing name (Gym.displayName), else its stored name. */
export function gymBrandName(gym) {
  return gym?.displayName || gymDisplayName(gym)
}

// header 'logo' — just the logo, or the brand name when the gym has none;
// header 'logo+name' — logo (if any) with the gym's name under it
function layout(gym, bodyHtml, { header = 'logo+name' } = {}) {
  const name = esc(gymDisplayName(gym))
  const logo = logoUrl(gym)
  const top  = header === 'logo'
    ? (logo
        ? `<img src="${esc(logo)}" alt="${esc(gymBrandName(gym))}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;margin:0 auto;">`
        : `<p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;">${esc(gymBrandName(gym))}</p>`)
    : `${logo ? `<img src="${esc(logo)}" alt="${name}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:contain;margin-bottom:10px;">` : ''}
<p style="margin:0;color:#ffffff;font-size:15px;font-weight:700;">${name}</p>`
  return `<!doctype html><html><body style="margin:0;padding:0;background:#292929;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#292929;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;">
<tr><td align="center" style="padding-bottom:20px;">
${top}
</td></tr>
<tr><td style="background:#1c1c1c;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
${bodyHtml}
</td></tr>
<tr><td align="center" style="padding-top:20px;color:#525252;font-size:11px;">${footerHtml()}</td></tr>
</table></td></tr></table></body></html>`
}

/** "{GYM} - Your One-Time Verification Code" — the member portal's one-time code. */
export function verificationCodeEmail(gym, code, minutes) {
  const name = gymDisplayName(gym)
  return {
    subject: `${gymBrandName(gym).toUpperCase()} - Your One-Time Verification Code`,
    text:    `your ${name} verification code is ${code}. it expires in ${minutes} minutes. if you didn't request it, you can ignore this email.\n\n${footerText()}`,
    html:    layout(gym, `
<p style="margin:0 0 6px;color:#ffffff;font-size:17px;font-weight:700;">your verification code</p>
<p style="margin:0 0 20px;color:#a3a3a3;font-size:13px;">enter this code to manage your membership.</p>
<p style="margin:0 0 20px;color:#ffffff;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,monospace;">${esc(code)}</p>
<p style="margin:0;color:#737373;font-size:12px;">it expires in ${minutes} minutes. if you didn't request it, you can ignore this email.</p>`, { header: 'logo' }),
  }
}

/** Staff-sent link to Stripe's page for saving a new card. */
export function paymentLinkEmail(gym, member, url, expiresAt) {
  const name    = gymDisplayName(gym)
  const expires = new Date(expiresAt).toLocaleString('en-US', {
    timeZone: gym?.timezone || 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).toLowerCase()
  const first    = String(member.firstName ?? '').trim()
  const greeting = first ? `Hi ${first},` : 'Hi there,'
  const sentence = `${greeting} please click on the button below to update your payment method on file for your membership.`
  return {
    subject: `update your ${name} payment method`,
    text:    `${sentence}\n\n${url}\n\nthe link expires ${expires}.\n\n${footerText()}`,
    html:    layout(gym, `
<p style="margin:0 0 6px;color:#ffffff;font-size:17px;font-weight:700;">update your payment method</p>
<p style="margin:0 0 20px;color:#a3a3a3;font-size:13px;">${esc(sentence)}</p>
<a href="${esc(url)}" style="display:block;text-align:center;background:#ffffff;color:#000000;text-decoration:none;font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;">update payment method →</a>
<p style="margin:20px 0 0;color:#737373;font-size:12px;">the link expires ${esc(expires)}. any overdue balance is retried with the new card once it's saved.</p>`, { header: 'logo' }),
  }
}
