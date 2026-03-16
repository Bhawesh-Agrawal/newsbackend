import sql from '../config/database.js';
import { generateToken } from '../utils/helpers.js';
import {
  sendConfirmationEmail,
  sendUnsubscribeConfirmation,
  sendCampaignEmail,
} from '../services/email.service.js';
import { parsePagination } from '../utils/helpers.js';

// ── Subscribe ─────────────────────────────────────────────────────
export const subscribe = async (req, res, next) => {
  try {
    const { email, full_name, source } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already subscribed
    const existing = await sql`
      SELECT id, is_confirmed, is_active
      FROM newsletter_subscribers
      WHERE email = ${normalizedEmail}
    `;

    if (existing.length > 0) {
      const subscriber = existing[0];

      // Already confirmed and active — don't reveal this
      // Return same message to prevent email enumeration
      if (subscriber.is_confirmed && subscriber.is_active) {
        return res.status(200).json({
          success: true,
          message: 'Please check your email to confirm your subscription',
        });
      }

      // Was unsubscribed — re-subscribe them
      if (!subscriber.is_active) {
        const confirmToken = generateToken();

        await sql`
          UPDATE newsletter_subscribers SET
            is_active       = TRUE,
            is_confirmed    = FALSE,
            confirm_token   = ${confirmToken},
            unsubscribed_at = NULL,
            full_name       = COALESCE(${full_name || null}, full_name)
          WHERE id = ${subscriber.id}
        `;

        await sendConfirmationEmail(normalizedEmail, full_name, confirmToken);

        return res.status(200).json({
          success: true,
          message: 'Please check your email to confirm your subscription',
        });
      }

      // Pending confirmation — resend the email
      const confirmToken = generateToken();

      await sql`
        UPDATE newsletter_subscribers
        SET confirm_token = ${confirmToken}
        WHERE id = ${subscriber.id}
      `;

      await sendConfirmationEmail(normalizedEmail, full_name, confirmToken);

      return res.status(200).json({
        success: true,
        message: 'Please check your email to confirm your subscription',
      });
    }

    // Brand new subscriber
    const confirmToken     = generateToken();
    const unsubscribeToken = generateToken();

    await sql`
      INSERT INTO newsletter_subscribers
        (email, full_name, user_id, confirm_token, unsubscribe_token, source)
      VALUES (
        ${normalizedEmail},
        ${full_name || null},
        ${req.user?.id || null},
        ${confirmToken},
        ${unsubscribeToken},
        ${source || null}
      )
    `;

    await sendConfirmationEmail(normalizedEmail, full_name, confirmToken);

    return res.status(201).json({
      success: true,
      message: 'Please check your email to confirm your subscription',
    });

  } catch (err) {
    next(err);
  }
};

// ── Confirm subscription ──────────────────────────────────────────
export const confirmSubscription = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    const result = await sql`
      UPDATE newsletter_subscribers SET
        is_confirmed  = TRUE,
        confirmed_at  = NOW(),
        confirm_token = NULL
      WHERE confirm_token = ${token}
        AND is_confirmed  = FALSE
      RETURNING email, full_name
    `;

    if (result.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or already used confirmation token',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Subscription confirmed! Welcome aboard.',
      data: { email: result[0].email },
    });

  } catch (err) {
    next(err);
  }
};

// ── Unsubscribe ───────────────────────────────────────────────────
export const unsubscribe = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    const result = await sql`
      UPDATE newsletter_subscribers SET
        is_active       = FALSE,
        unsubscribed_at = NOW()
      WHERE unsubscribe_token = ${token}
        AND is_active         = TRUE
      RETURNING email
    `;

    if (result.length === 0) {
      // Could be invalid token or already unsubscribed
      // Return success either way — the outcome is what they wanted
      return res.status(200).json({
        success: true,
        message: 'You have been unsubscribed',
      });
    }

    await sendUnsubscribeConfirmation(result[0].email);

    return res.status(200).json({
      success: true,
      message: 'You have been unsubscribed',
    });

  } catch (err) {
    next(err);
  }
};

// ── Get subscribers (admin) ───────────────────────────────────────
export const getSubscribers = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { confirmed, active }   = req.query;

    const subscribers = await sql`
      SELECT
        id, email, full_name, is_confirmed,
        is_active, source, created_at, confirmed_at
      FROM newsletter_subscribers
      WHERE
        (${confirmed || null} IS NULL
          OR is_confirmed = ${confirmed === 'true'})
        AND (${active || null} IS NULL
          OR is_active = ${active === 'true'})
      ORDER BY created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT
        COUNT(*)                                      AS total,
        COUNT(*) FILTER (WHERE is_confirmed = TRUE
          AND is_active = TRUE)                       AS active_confirmed,
        COUNT(*) FILTER (WHERE is_confirmed = FALSE)  AS pending
      FROM newsletter_subscribers
    `;

    return res.status(200).json({
      success: true,
      data: subscribers,
      stats: countResult[0],
      pagination: {
        page,
        limit,
        total:      parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit),
      },
    });

  } catch (err) {
    next(err);
  }
};

// ── Create and send campaign ──────────────────────────────────────
export const sendCampaign = async (req, res, next) => {
  try {
    const { title, subject, body_html, body_text } = req.body;

    if (!title || !subject || !body_html) {
      return res.status(400).json({
        success: false,
        message: 'title, subject, and body_html are required',
      });
    }

    // 1. Save campaign as sending
    const campaignResult = await sql`
      INSERT INTO newsletter_campaigns
        (title, subject, body_html, body_text, created_by, status)
      VALUES
        (${title}, ${subject}, ${body_html}, ${body_text || null},
         ${req.user.id}, 'sending')
      RETURNING *
    `;

    const campaign = campaignResult[0];

    // 2. Get all active confirmed subscribers
    const subscribers = await sql`
      SELECT email, full_name, unsubscribe_token
      FROM newsletter_subscribers
      WHERE is_active    = TRUE
        AND is_confirmed = TRUE
    `;

    if (subscribers.length === 0) {
      await sql`
        UPDATE newsletter_campaigns
        SET status = 'sent', sent_at = NOW(), sent_count = 0
        WHERE id = ${campaign.id}
      `;

      return res.status(200).json({
        success: true,
        message: 'No active subscribers to send to',
        data: { sent: 0 },
      });
    }

    // 3. Send to each subscriber
    // In production: use a job queue, not a for loop
    let sentCount = 0;

    for (const subscriber of subscribers) {
      try {
        await sendCampaignEmail(subscriber, campaign);
        sentCount++;
      } catch (emailErr) {
        // Log but don't stop — one failed email shouldn't abort the whole campaign
        console.error(`Failed to send to ${subscriber.email}:`, emailErr.message);
      }
    }

    // 4. Mark campaign as sent
    await sql`
      UPDATE newsletter_campaigns SET
        status     = 'sent',
        sent_at    = NOW(),
        sent_count = ${sentCount}
      WHERE id = ${campaign.id}
    `;

    return res.status(200).json({
      success: true,
      message: `Campaign sent to ${sentCount} subscribers`,
      data: { sent: sentCount, total: subscribers.length },
    });

  } catch (err) {
    next(err);
  }
};

// ── Get campaigns (admin) ─────────────────────────────────────────
export const getCampaigns = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);

    const campaigns = await sql`
      SELECT
        nc.*,
        u.full_name AS created_by_name
      FROM newsletter_campaigns nc
      LEFT JOIN users u ON nc.created_by = u.id
      ORDER BY nc.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    const countResult = await sql`
      SELECT COUNT(*) AS total FROM newsletter_campaigns
    `;

    return res.status(200).json({
      success: true,
      data: campaigns,
      pagination: {
        page,
        limit,
        total:      parseInt(countResult[0].total),
        totalPages: Math.ceil(parseInt(countResult[0].total) / limit),
      },
    });

  } catch (err) {
    next(err);
  }
};

