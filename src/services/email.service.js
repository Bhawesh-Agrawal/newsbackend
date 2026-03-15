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
    const confirmMail = `$process.env.FRONTEND_URL}/confirm-email?token=${token}`;

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

export const sentCampaignEmail = async (subscriber, campaign) => {
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