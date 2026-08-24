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

  await checkRateLimit(
      auth.uid, "postComment", COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_MS, COMMENT_MIN_INTERVAL_MS,
  );

  // Stored as-is; the client escapes this text at render time (index-init.js),
  // so it's never interpreted as HTML — no need to mangle it here too.
  const userName = (auth.token.name || auth.token.email || "Fan").slice(0, 60);

  await db.collection("comments").add({
    listId,
    userId: auth.uid,
    userName,
    text: trimmed,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {ok: true};
});
