import sql from '../config/database.js';

// ── Question pool (rotated based on user behavior) ──────────────────────────
const QUESTIONS = {
  new_user: [
    { id: 'intent', question: 'What brought you here today?', type: 'single', options: ['Breaking news', 'Research a topic', 'Browsing casually', 'Recommendation'] },
    { id: 'discovery', question: 'How did you find this article?', type: 'single', options: ['Search engine', 'Social media', 'Direct visit', 'Newsletter'] },
  ],
  returning_user: [
    { id: 'satisfaction', question: 'Was this article worth your time?', type: 'rating', options: ['1', '2', '3', '4', '5'] },
    { id: 'topics', question: 'What topics interest you most?', type: 'multi', options: ['Politics', 'Tech', 'Sports', 'Culture', 'Business', 'Health'] },
  ],
  frequent_user: [
    { id: 'return_visit', question: 'Would you read more like this?', type: 'single', options: ['Yes', 'Maybe', 'No'] },
    { id: 'satisfaction', question: 'Was this article worth your time?', type: 'rating', options: ['1', '2', '3', '4', '5'] },
  ],
};

// ── Submit feedback ─────────────────────────────────────────────────────────
export const submitFeedback = async (req, res, next) => {
  try {
    const {
      article_id,
      question_id,
      answer,
      rating,
      reading_time_seconds,
      scroll_depth,
      session_id,
    } = req.body;

    if (!article_id || !question_id || !answer) {
      return res.status(400).json({ success: false, message: 'article_id, question_id, and answer are required' });
    }

    const userId = req.user?.id || null;
    const fingerprint = req.body.fingerprint || null;
    const ipAddress = req.ip || null;

    // Validate that at least one identifier is present
    if (!userId && !fingerprint) {
      return res.status(400).json({ success: false, message: 'fingerprint or login required' });
    }

    // Check if already submitted this question (by user or fingerprint)
    let existing;
    if (userId) {
      existing = await sql`
        SELECT id FROM user_feedback
        WHERE user_id = ${userId} AND question_id = ${question_id}
        LIMIT 1
      `;
    } else {
      existing = await sql`
        SELECT id FROM user_feedback
        WHERE fingerprint = ${fingerprint} AND question_id = ${question_id}
        LIMIT 1
      `;
    }

    if (existing.length > 0) {
      return res.status(200).json({ success: true, message: 'Already submitted', duplicate: true });
    }

    // Check cooldown: no more than 1 submission per 48 hours
    const cooldownCheck = userId
      ? await sql`
          SELECT created_at FROM user_feedback
          WHERE user_id = ${userId}
          ORDER BY created_at DESC LIMIT 1
        `
      : await sql`
          SELECT created_at FROM user_feedback
          WHERE fingerprint = ${fingerprint}
          ORDER BY created_at DESC LIMIT 1
        `;

    if (cooldownCheck.length > 0) {
      const lastSubmission = new Date(cooldownCheck[0].created_at);
      const hoursSince = (Date.now() - lastSubmission.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 48) {
        return res.status(200).json({
          success: true,
          message: 'Cooldown active',
          cooldown: true,
          retryAfterHours: Math.ceil(48 - hoursSince),
        });
      }
    }

    // Insert feedback
    await sql`
      INSERT INTO user_feedback
        (user_id, fingerprint, article_id, feedback_type, question_id, answer, rating, session_id, reading_time_seconds, scroll_depth)
      VALUES
        (${userId}, ${fingerprint}, ${article_id}, 'survey', ${question_id}, ${answer}, ${rating || null}, ${session_id || null}, ${reading_time_seconds || 0}, ${scroll_depth || 0})
    `;

    return res.status(201).json({ success: true, message: 'Feedback recorded' });
  } catch (err) {
    console.error('[Feedback] Submit error:', err.message);
    // Non-critical — don't break the UX
    return res.status(200).json({ success: true, message: 'Feedback recorded' });
  }
};

// ── Get feedback status (already submitted? cooldown?) ──────────────────────
export const getFeedbackStatus = async (req, res, next) => {
  try {
    const userId = req.user?.id || null;
    const fingerprint = req.query.fingerprint || null;

    if (!userId && !fingerprint) {
      return res.status(200).json({ success: true, data: { submitted: false, cooldown: false } });
    }

    // Check total submissions (ever)
    let totalSubmitted;
    if (userId) {
      totalSubmitted = await sql`
        SELECT COUNT(*)::INT AS count FROM user_feedback WHERE user_id = ${userId}
      `;
    } else {
      totalSubmitted = await sql`
        SELECT COUNT(*)::INT AS count FROM user_feedback WHERE fingerprint = ${fingerprint}
      `;
    }

    const hasSubmitted = (totalSubmitted[0]?.count ?? 0) > 0;

    // Check last submission time
    let lastSubmission;
    if (userId) {
      lastSubmission = await sql`
        SELECT created_at FROM user_feedback
        WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 1
      `;
    } else {
      lastSubmission = await sql`
        SELECT created_at FROM user_feedback
        WHERE fingerprint = ${fingerprint}
        ORDER BY created_at DESC LIMIT 1
      `;
    }

    let cooldown = false;
    let retryAfterHours = 0;
    if (lastSubmission.length > 0) {
      const lastTime = new Date(lastSubmission[0].created_at);
      const hoursSince = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 48) {
        cooldown = true;
        retryAfterHours = Math.ceil(48 - hoursSince);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        submitted: hasSubmitted,
        cooldown,
        retryAfterHours,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Get question for user (based on behavior) ───────────────────────────────
export const getFeedbackQuestion = async (req, res, next) => {
  try {
    const userId = req.user?.id || null;
    const fingerprint = req.query.fingerprint || null;

    if (!userId && !fingerprint) {
      // Default to new_user questions
      const question = QUESTIONS.new_user[Math.floor(Math.random() * QUESTIONS.new_user.length)];
      return res.status(200).json({ success: true, data: question });
    }

    // Determine user type based on feedback history
    let submissionCount;
    if (userId) {
      submissionCount = await sql`
        SELECT COUNT(*)::INT AS count FROM user_feedback WHERE user_id = ${userId}
      `;
    } else {
      submissionCount = await sql`
        SELECT COUNT(*)::INT AS count FROM user_feedback WHERE fingerprint = ${fingerprint}
      `;
    }

    const count = submissionCount[0]?.count ?? 0;

    // Select question pool based on user behavior
    let pool;
    if (count === 0) {
      pool = QUESTIONS.new_user;
    } else if (count <= 2) {
      pool = QUESTIONS.returning_user;
    } else {
      pool = QUESTIONS.frequent_user;
    }

    // Pick a random question from the pool
    const question = pool[Math.floor(Math.random() * pool.length)];

    return res.status(200).json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
};
