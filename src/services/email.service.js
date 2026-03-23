import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true',
        auth:{
            user : process.env.SMTP_USER,
            pass : process.env.SMTP_PASS
        }
    })
};

const FROM = `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`;
const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async ({ to, subject, html, text }) => {
  const { data, error } = await resend.emails.send({
    from:    `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  });

  if (error) throw new Error(error.message);
  return data;
};

export const sendConfirmationEmail = async (email, name, token) => {
    const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email?token=${token}`;

    return sendEmail({
        to : email,
        subject : 'Please confirm your subscription',
        html : `
            <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
                <h2>Almost there${name ? `, ${name}` : ''}!</h2>
                <p>Click the button below to confirm your newsletter subscription.</p>
                <a href="${confirmUrl}"
                style="display: inline-block; padding: 12px 24px;
                        background: #6366f1; color: white;
                        border-radius: 6px; text-decoration: none;
                        font-weight: 600;">
                Confirm Subscription
                </a>
                <p style="color: #888; font-size: 12px; margin-top: 24px;">
                If you didn't subscribe, ignore this email.<br/>
                This link expires in 24 hours.
                </p>
            </div>
        `,
        text : `Confirm your subscription: ${confirmUrl}`,

    })
};

export const sendUnsubscribeConfirmation = async (email) => {
    return sendEmail({
        to : email,
        subject : "You've been unsubscribed",
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
                <h2>Successfully unsubscribed</h2>
                <p>You've been removed from our newsletter list.</p>
                <p>Changed your mind?
                <a href="${process.env.FRONTEND_URL}/newsletter">Subscribe again</a>
                </p>
            </div>
        `,
        text : "You've been unsubscribed from our newsletter."
    })
};

export const sendCampaignEmail = async (subscriber, campaign) => {
    const unsubUrl = `${process.env.FRONTEND_URL}/newsletter/unsubscribe?token=${subscriber.unsubscribe_token}`;

    const html = `
        ${campaign.body_html}
        <hr style="margin: 40px 0; border-color: #e5e7eb;"/>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
        You're receiving this because you subscribed to our newsletter.<br/>
        <a href="${unsubUrl}" style="color: #9ca3af;">Unsubscribe</a>
        </p>
    `;

    const text = campaign.body_text ? `${campaign.body_text}\n\nUnsubscribe: ${unsubUrl}`:
    `Unsubscribe: ${unsubUrl}`;

    return sendEmail({
        to : subscriber.email,
        subject : campaign.subject,
        html, 
        text,
    });
};

export const sendMagicLinkEmail = async (email, name, token) => {
  const loginUrl = `${process.env.FRONTEND_URL}/auth/magic?token=${token}`;

  return sendEmail({
    to: email,
    subject: 'Your login link',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Login to News Platform</h2>
        <p>Hi${name ? ` ${name}` : ''}! Click the button below to sign in.
           No password needed.</p>
        <a href="${loginUrl}"
           style="display: inline-block; padding: 12px 28px;
                  background: #6366f1; color: white;
                  border-radius: 6px; text-decoration: none;
                  font-weight: 600; font-size: 15px;">
          Sign In
        </a>
        <p style="color: #888; font-size: 12px; margin-top: 24px;">
          This link expires in ${process.env.MAGIC_LINK_EXPIRES_MINUTES || 15} minutes
          and can only be used once.<br/>
          If you didn't request this, ignore this email — your account is safe.
        </p>
      </div>
    `,
    text: `Sign in to News Platform: ${loginUrl}\n\nExpires in ${process.env.MAGIC_LINK_EXPIRES_MINUTES || 15} minutes. Single use only.`,
  });
};

export const sendEmailVerification = async (email, fullName, token) => {
  const url = `${process.env.FRONTEND_URL}/auth/verify-email?token=${token}`;

  return send({
    to:      email,
    subject: 'Verify your Mango People News account',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px">
        <div style="margin-bottom:24px">
          <span style="font-size:28px">🌳</span>
          <strong style="font-size:18px;margin-left:8px;vertical-align:middle">
            Mango People News
          </strong>
        </div>

        <h2 style="font-size:22px;font-weight:800;margin:0 0 8px">
          Welcome, ${fullName}!
        </h2>
        <p style="color:#555;margin:0 0 24px;line-height:1.6">
          You're almost there. Click the button below to verify your email
          and activate your account. This link expires in <strong>24 hours</strong>.
        </p>

        <a href="${url}"
           style="display:inline-block;padding:14px 28px;
                  background:#E8A020;color:#fff;border-radius:8px;
                  text-decoration:none;font-weight:700;font-size:15px">
          Verify Email Address
        </a>

        <p style="color:#888;font-size:12px;margin-top:32px;line-height:1.6">
          If you didn't create this account, you can safely ignore this email.<br/>
          Or copy this link: <a href="${url}" style="color:#E8A020">${url}</a>
        </p>
      </div>
    `,
    text: `Welcome to Mango People News!\n\nVerify your email here:\n${url}\n\nThis link expires in 24 hours.`,
  });
};