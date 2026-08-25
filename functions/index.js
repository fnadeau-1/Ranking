// Montana Wrestling Rankings — Cloud Functions
//
// Votes and comments are write-gated here (not by client-direct Firestore
// writes) specifically so rate limits and content checks can't be skipped by
// a modified/rogue client: Firestore rules alone can validate a single
// document's shape, but can't reliably stop a client from just omitting a
// paired "record that I voted" write. The Admin SDK used here is the only
// writer of votes/comments — see firestore.rules, which denies client writes
// to both collections outright.
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const VOTE_RATE_LIMIT = 60; // votes per user per hour
const VOTE_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_RATE_LIMIT = 20; // comments per user per hour
const COMMENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_MIN_INTERVAL_MS = 10 * 1000; // no faster than one comment per 10s
const COMMENT_MAX_LENGTH = 1000;
const COMMENT_MAX_PER_WEEK = 10; // hard cap per user per week's ranking
const RANKING_RATE_LIMIT = 120; // fan-ranking saves per user per hour
const RANKING_RATE_WINDOW_MS = 60 * 60 * 1000;
const RANKING_MIN_INTERVAL_MS = 2 * 1000; // no faster than one save per 2s
const RANKING_MAX_ITEMS = 200; // sanity cap on wrestlers a list can hold

/**
 * Sliding-window rate limit stored in rateLimits/{uid}, written only by this
 * Admin SDK process — a client can't forge or skip it. Wrapped in a
 * transaction so two concurrent requests from the same user can't both slip
 * past the same count. Throws an HttpsError if the caller is over the limit.
 * @param {string} uid Firebase Auth uid of the caller.
 * @param {string} key Rate-limit bucket name, e.g. "castVote".
 * @param {number} limit Max calls allowed within windowMs.
 * @param {number} windowMs Rolling window length, in milliseconds.
 * @param {number} [minIntervalMs] Minimum gap between consecutive calls.
 */
async function checkRateLimit(uid, key, limit, windowMs, minIntervalMs = 0) {
  const ref = db.collection("rateLimits").doc(uid);
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : {};
    const entry = data[key] || {count: 0, windowStart: now, lastAt: 0};

    if (minIntervalMs && now - entry.lastAt < minIntervalMs) {
      throw new HttpsError(
          "resource-exhausted", "You're doing that too fast. Please slow down.",
      );
    }

    const windowExpired = now - entry.windowStart > windowMs;
    const windowStart = windowExpired ? now : entry.windowStart;
    const count = windowExpired ? 0 : entry.count;

    if (count >= limit) {
      throw new HttpsError(
          "resource-exhausted", "Rate limit exceeded. Try again later.",
      );
    }

    const nextEntry = {count: count + 1, windowStart, lastAt: now};
    transaction.set(ref, {[key]: nextEntry}, {merge: true});
  });
}

/**
 * Returns the id of the current (latest) week — the one with the newest
 * startDate. Comments are only allowed on this week's rankings; older weeks
 * stay fully readable but locked for new comments.
 * @return {Promise<string|null>} Latest week's doc id, or null if none exist.
 */
async function getLatestWeekId() {
  const snap = await db.collection("weeks")
      .orderBy("startDate", "desc").limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Enforces a hard cap on how many comments a user may post on a single week's
 * ranking, tracked in an Admin-only commentCounts/{weekId}_{uid} counter. The
 * cap resets naturally each week because a new week means a new counter doc.
 * Runs in a transaction so concurrent posts can't both slip past the cap.
 * @param {string} uid Firebase Auth uid of the commenter.
 * @param {string} weekId Week the comment belongs to.
 * @param {number} limit Max comments allowed for that user that week.
 */
async function checkWeeklyCommentQuota(uid, weekId, limit) {
  const ref = db.collection("commentCounts").doc(`${weekId}_${uid}`);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const count = snap.exists ? (snap.data().count || 0) : 0;
    if (count >= limit) {
      throw new HttpsError(
          "resource-exhausted",
          `You've used all ${limit} comments for this week's ranking.`,
      );
    }
    transaction.set(ref, {
      count: count + 1,
      weekId,
      userId: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

// Records an agree/disagree vote on a published ranking list. One vote per
// user per list (deterministic doc id), toggle-style.
exports.castVote = onCall({enforceAppCheck: true}, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to vote.");
  }

  const {listId, value} = request.data || {};
  const validVote = value === "agree" || value === "disagree";
  if (typeof listId !== "string" || !listId || !validVote) {
    throw new HttpsError("invalid-argument", "Invalid vote payload.");
  }

  const listSnap = await db.collection("rankingLists").doc(listId).get();
  if (!listSnap.exists || listSnap.data().published !== true) {
    throw new HttpsError("not-found", "That ranking isn't published.");
  }

  await checkRateLimit(
      auth.uid, "castVote", VOTE_RATE_LIMIT, VOTE_RATE_WINDOW_MS,
  );

  const voteRef = db.collection("votes").doc(`${listId}_${auth.uid}`);
  await voteRef.set({
    listId,
    userId: auth.uid,
    value,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {ok: true};
});

// Posts a comment on a published ranking list.
exports.postComment = onCall({enforceAppCheck: true}, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to comment.");
  }
  if (!auth.token.email_verified) {
    throw new HttpsError(
        "permission-denied", "Please verify your email before commenting.",
    );
  }

  const {listId, text} = request.data || {};
  if (typeof listId !== "string" || !listId || typeof text !== "string") {
    throw new HttpsError("invalid-argument", "Invalid comment payload.");
  }
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > COMMENT_MAX_LENGTH) {
    throw new HttpsError(
        "invalid-argument", "Comment must be 1-1000 characters.",
    );
  }

  const listSnap = await db.collection("rankingLists").doc(listId).get();
  if (!listSnap.exists || listSnap.data().published !== true) {
    throw new HttpsError("not-found", "That ranking isn't published.");
  }

  // Comments are only open on the current (latest) week. Past weeks stay
  // readable but locked, so old threads don't get resurrected.
  const weekId = listSnap.data().weekId;
  const latestWeekId = await getLatestWeekId();
  if (!weekId || weekId !== latestWeekId) {
    throw new HttpsError(
        "failed-precondition",
        "Comments are closed on past weeks. Only the current week is open.",
    );
  }

  await checkRateLimit(
      auth.uid, "postComment", COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_MS, COMMENT_MIN_INTERVAL_MS,
  );

  // Hard cap: each user gets COMMENT_MAX_PER_WEEK comments per week's ranking.
  await checkWeeklyCommentQuota(auth.uid, weekId, COMMENT_MAX_PER_WEEK);

  // Stored as-is; the client escapes this text at render time (index-init.js),
  // so it's never interpreted as HTML — no need to mangle it here too.
  const userName = (auth.token.name || auth.token.email || "Fan").slice(0, 60);

  await db.collection("comments").add({
    listId,
    weekId,
    userId: auth.uid,
    userName,
    text: trimmed,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {ok: true};
});

// Saves a fan's own ordering of a published ranking. Fans can only REORDER the
// wrestlers the ranker already put on the list — they can't add, remove, or
// invent wrestlers. We enforce that here (not just in the client) by requiring
// the submitted order to be an exact permutation of the published list's order:
// same members, same count, no duplicates. One saved ranking per user per list
// (deterministic doc id), overwritten each time they resubmit. These feed the
// aggregated "People's Ranking" shown on the site.
exports.submitUserRanking = onCall({enforceAppCheck: true}, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to save your ranking.");
  }

  const {listId, order} = request.data || {};
  if (typeof listId !== "string" || !listId || !Array.isArray(order)) {
    throw new HttpsError("invalid-argument", "Invalid ranking payload.");
  }
  if (order.length === 0 || order.length > RANKING_MAX_ITEMS) {
    throw new HttpsError("invalid-argument", "That ranking is the wrong size.");
  }
  if (!order.every((id) => typeof id === "string" && id.length > 0)) {
    throw new HttpsError("invalid-argument", "That ranking has bad entries.");
  }

  const listSnap = await db.collection("rankingLists").doc(listId).get();
  if (!listSnap.exists || listSnap.data().published !== true) {
    throw new HttpsError("not-found", "That ranking isn't published.");
  }

  // The submitted order must be a permutation of exactly what the ranker
  // published — no extra wrestlers, none missing, no duplicates.
  const official = listSnap.data().order || [];
  const officialSet = new Set(official);
  const submittedSet = new Set(order);
  const isPermutation =
    order.length === official.length &&
    submittedSet.size === order.length &&
    order.every((id) => officialSet.has(id));
  if (!isPermutation) {
    throw new HttpsError(
        "invalid-argument",
        "You can only reorder the wrestlers already on this ranking.",
    );
  }

  await checkRateLimit(
      auth.uid, "submitUserRanking",
      RANKING_RATE_LIMIT, RANKING_RATE_WINDOW_MS, RANKING_MIN_INTERVAL_MS,
  );

  const ref = db.collection("userRankings").doc(`${listId}_${auth.uid}`);
  await ref.set({
    listId,
    userId: auth.uid,
    order,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {ok: true};
});
