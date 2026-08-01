import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Brand constants ────────────────────────────────────────────────────────
const BRAND = {
  name:    'Mango People News',
  primary: '#E8A020',        // mango amber
  dark:    '#1A1209',        // deep espresso
  surface: '#FFF9F0',        // warm cream
  muted:   '#7A6652',        // warm taupe
  border:  '#F0E0C8',        // light peach border
  logoUrl: 'data:image/png;base64,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',
  siteUrl: process.env.FRONTEND_URL,
};

// ─── Shared layout wrapper ──────────────────────────────────────────────────
const layout = (bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${BRAND.name}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F5EFE6;font-family:'Georgia',serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#F5EFE6;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#ffffff;border-radius:16px;
                      overflow:hidden;border:1px solid ${BRAND.border};
                      box-shadow:0 4px 32px rgba(26,18,9,0.08);">

          <!-- Header bar -->
          <tr>
            <td style="background:${BRAND.dark};padding:28px 40px;text-align:center;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <img src="${BRAND.logoUrl}" alt="${BRAND.name}"
                         height="44" style="display:block;height:44px;max-width:220px;"/>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Decorative accent line -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${BRAND.primary} 0%,#F5C842 50%,${BRAND.primary} 100%);"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${BRAND.surface};border-top:1px solid ${BRAND.border};
                       padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};font-family:sans-serif;">
                © ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
              </p>
              <p style="margin:0;font-size:12px;color:#B0A090;font-family:sans-serif;">
                <a href="${BRAND.siteUrl}" style="color:${BRAND.primary};text-decoration:none;">Visit our site</a>
                &nbsp;·&nbsp;
                <a href="${BRAND.siteUrl}/privacy" style="color:${BRAND.primary};text-decoration:none;">Privacy Policy</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;

// ─── Reusable button component ──────────────────────────────────────────────
const ctaButton = (href, label) => `
<table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
  <tr>
    <td align="center" style="border-radius:8px;background:${BRAND.primary};">
      <a href="${href}"
         style="display:inline-block;padding:14px 36px;
                font-family:sans-serif;font-size:15px;font-weight:700;
                color:#ffffff;text-decoration:none;border-radius:8px;
                letter-spacing:0.3px;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;

// ─── Reusable small link fallback ───────────────────────────────────────────
const linkFallback = (href, label = 'Or copy this link') => `
<p style="font-family:sans-serif;font-size:12px;color:#B0A090;margin:8px 0 0;word-break:break-all;">
  ${label}: <a href="${href}" style="color:${BRAND.primary};text-decoration:none;">${href}</a>
</p>`;

// ─── Heading helper ─────────────────────────────────────────────────────────
const heading = (text) =>
  `<h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:${BRAND.dark};
              font-family:'Georgia',serif;line-height:1.3;">${text}</h1>`;

const subtext = (html) =>
  `<p style="margin:0 0 4px;font-size:15px;color:#4A3B2C;line-height:1.7;
             font-family:sans-serif;">${html}</p>`;

const note = (html) =>
  `<p style="margin:16px 0 0;font-size:12px;color:#B0A090;line-height:1.6;
             font-family:sans-serif;">${html}</p>`;

// ─── Logo badge (replaces icon badge) ───────────────────────────────────────
const logoBadge = () =>
  `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
     <tr>
       <td align="center">
         <img src="${BRAND.logoUrl}" alt="${BRAND.name}"
              width="80" height="80"
              style="display:block;width:80px;height:80px;
                     object-fit:contain;border-radius:12px;
                     background:${BRAND.surface};padding:8px;
                     border:1.5px solid ${BRAND.border};" />
       </td>
     </tr>
   </table>`;

// ─── Core send function ─────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
  const { data, error } = await resend.emails.send({
    from:    `${BRAND.name} <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(error.message);
  return data;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. Subscription confirmation
// ═══════════════════════════════════════════════════════════════════════════
export const sendConfirmationEmail = async (email, name, token) => {
  const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email?token=${token}`;

  const body = `
    ${logoBadge()}
    ${heading(`Almost there${name ? `, ${name}` : ''}!`)}
    ${subtext('You\'re one click away from joining the <strong>Mango People News</strong> community. Confirm your email address to start receiving our latest Mango Bites.')}
    ${ctaButton(confirmUrl, 'Confirm Subscription')}
    ${note('This link expires in <strong>24 hours</strong>. If you didn\'t subscribe, you can safely ignore this email.')}
    ${linkFallback(confirmUrl)}
  `;

  return sendEmail({
    to:      email,
    subject: 'Please confirm your subscription — Mango People News',
    html:    layout(body),
    text:    `Confirm your subscription: ${confirmUrl}`,
  });
};

export const sendResetPasswordEmail = async (email, name, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const body = `
    ${logoBadge()}
    ${heading('Reset your password')}
    ${subtext(`Hi ${name || 'there'}, we received a request to reset your password. Click the button below to choose a new password.`)}
    ${ctaButton(resetUrl, 'Reset password')}
    ${note('This link expires in <strong>60 minutes</strong>. If you didn\'t request a password reset, you can safely ignore this email.')}
    ${linkFallback(resetUrl)}
  `;

  return sendEmail({
    to:      email,
    subject: 'Reset your Mango People News password',
    html:    layout(body),
    text:    `Reset your password: ${resetUrl}`,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. Unsubscribe confirmation
// ═══════════════════════════════════════════════════════════════════════════
export const sendUnsubscribeConfirmation = async (email) => {
  const resubUrl = `${process.env.FRONTEND_URL}/newsletter`;

  const body = `
    ${logoBadge()}
    ${heading('You\'ve been unsubscribed')}
    ${subtext('We\'ve removed your email from our newsletter list. We\'re sorry to see you go!')}

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:24px 0;border-top:1px solid ${BRAND.border};"></table>

    ${subtext('Changed your mind? You\'re always welcome back.')}
    ${ctaButton(resubUrl, 'Re-subscribe')}
    ${note('If this was a mistake or you have feedback, feel free to reply to this email.')}
  `;

  return sendEmail({
    to:      email,
    subject: 'You\'ve been unsubscribed — Mango People News',
    html:    layout(body),
    text:    'You\'ve been successfully unsubscribed from Mango People News.',
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. Campaign / newsletter send
// ═══════════════════════════════════════════════════════════════════════════
export const sendCampaignEmail = async (subscriber, campaign) => {
  const unsubUrl = `${process.env.FRONTEND_URL}/newsletter/unsubscribe?token=${subscriber.unsubscribe_token}`;

  // Campaign uses its own body HTML but gets wrapped in the brand shell
  const campaignBody = `
    <!-- Campaign content -->
    <div style="font-family:sans-serif;font-size:15px;color:#4A3B2C;line-height:1.8;">
      ${campaign.body_html}
    </div>

    <!-- Divider -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:32px 0;border-top:1px solid ${BRAND.border};"></table>

    <p style="font-family:sans-serif;font-size:12px;color:#B0A090;text-align:center;
              line-height:1.6;margin:0;">
      You're receiving this because you subscribed to ${BRAND.name}.<br/>
      <a href="${unsubUrl}" style="color:${BRAND.muted};text-decoration:underline;">
        Unsubscribe
      </a>
    </p>
  `;

  const text = campaign.body_text
    ? `${campaign.body_text}\n\nUnsubscribe: ${unsubUrl}`
    : `Unsubscribe: ${unsubUrl}`;

  // For campaigns, build a minimal wrapper that keeps the header/footer
  // but uses the campaign body directly (no icon badge padding)
  const campaignHtml = layout(campaignBody);

  return sendEmail({
    to:      subscriber.email,
    subject: campaign.subject,
    html:    campaignHtml,
    text,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. Magic link / passwordless login
// ═══════════════════════════════════════════════════════════════════════════
export const sendMagicLinkEmail = async (email, name, token) => {
  const loginUrl  = `${process.env.FRONTEND_URL}/auth/magic?token=${token}`;
  const expiryMin = process.env.MAGIC_LINK_EXPIRES_MINUTES || 15;

  const body = `
    ${logoBadge()}
    ${heading('Your sign-in link')}
    ${subtext(`Hi${name ? ` <strong>${name}</strong>` : ''}! Use the button below to sign in to <strong>${BRAND.name}</strong>. No password needed.`)}
    ${ctaButton(loginUrl, 'Sign In Securely')}

    <!-- Expiry badge -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
      <tr>
        <td style="background:${BRAND.surface};border:1px solid ${BRAND.border};
                   border-radius:6px;padding:8px 16px;">
          <span style="font-family:sans-serif;font-size:13px;color:${BRAND.muted};">
            ⏱ Expires in <strong>${expiryMin} minutes</strong> · Single use only
          </span>
        </td>
      </tr>
    </table>

    ${note('If you didn\'t request this link, you can safely ignore this email — your account is safe.')}
    ${linkFallback(loginUrl)}
  `;

  return sendEmail({
    to:      email,
    subject: `Your sign-in link — ${BRAND.name}`,
    html:    layout(body),
    text:    `Sign in to ${BRAND.name}: ${loginUrl}\n\nExpires in ${expiryMin} minutes. Single use only.`,
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. Email verification (account creation)
// ═══════════════════════════════════════════════════════════════════════════
export const sendEmailVerification = async (email, fullName, token) => {
  const verifyUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${token}`;

  const body = `
    ${logoBadge()}
    ${heading(`Welcome, ${fullName}!`)}
    ${subtext(`Thanks for creating your <strong>${BRAND.name}</strong> account. Verify your email address to activate it and start exploring everything we have to offer.`)}
    ${ctaButton(verifyUrl, 'Verify Email Address')}

    <!-- Expiry notice -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">
      <tr>
        <td style="background:${BRAND.surface};border:1px solid ${BRAND.border};
                   border-radius:6px;padding:8px 16px;">
          <span style="font-family:sans-serif;font-size:13px;color:${BRAND.muted};">
            ⏱ This link expires in <strong>24 hours</strong>
          </span>
        </td>
      </tr>
    </table>

    ${note('If you didn\'t create this account, you can safely ignore this email.')}
    ${linkFallback(verifyUrl)}
  `;

  return sendEmail({
    to:      email,
    subject: `Verify your ${BRAND.name} account`,
    html:    layout(body),
    text:    `Welcome to ${BRAND.name}!\n\nVerify your email here:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
};