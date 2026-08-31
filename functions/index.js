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

// Firestore caps a single batched write at 500 operations.
const BATCH_LIMIT = 500;

// App Check enforcement is turned on at the App Check console once the site is
// deployed (see README); flip this to true there and here together.
const CALLABLE_OPTS = {enforceAppCheck: false};

const VOTE_RATE_LIMIT = 60; // votes per user per hour
const VOTE_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_RATE_LIMIT = 20; // comments per user per hour
const COMMENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_MIN_INTERVAL_MS = 10 * 1000; // no faster than one comment per 10s
const COMMENT_MAX_LENGTH = 1000;
const COMMENT_MAX_PER_WEEK = 10; // hard cap per user per week's ranking
const COMMENT_MAX_DEPTH = 6; // max reply nesting (0 = top-level comment)
const RANKING_RATE_LIMIT = 120; // fan-ranking saves per user per hour
const RANKING_RATE_WINDOW_MS = 60 * 60 * 1000;
const RANKING_MIN_INTERVAL_MS = 2 * 1000; // no faster than one save per 2s
const RANKING_MAX_ITEMS = 200; // sanity cap on wrestlers a list can hold
// The canonical 14 weight classes. A week only counts as "current" (open for
// votes/comments) once ALL of these are published. Keep in sync with the same
// list in public/js/util.js.
const WEIGHT_CLASSES = [
  "106", "113", "120", "126", "132", "138", "144",
  "150", "157", "165", "175", "190", "215", "285",
];

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
 * Returns the id of the current (latest) week — the newest week by startDate
 * that has ANY published rankings. Publishing is all-or-nothing from the
 * dashboard ("Submit all 14"), so in normal use this is a fully-submitted week;
 * keying off "has any published list" keeps the most recent published week
 * current and votable. Comments/votes are only allowed on this week; older weeks
 * stay readable but locked. Kept in sync with computeLatestWeekId() in
 * public/js/rankings-init.js — both must agree.
 * @return {Promise<string|null>} Current week's doc id, or null if no week has
 *     any published class yet.
 */
async function getLatestWeekId() {
  // Single equality filter; no composite index needed.
  const publishedSnap = await db.collection("rankingLists")
      .where("published", "==", true).get();
  const classesByWeek = new Map(); // weekId -> Set of published weightClasses
  publishedSnap.forEach((docSnap) => {
    const {weekId, weightClass} = docSnap.data();
    if (!weekId) return;
    if (!classesByWeek.has(weekId)) classesByWeek.set(weekId, new Set());
    classesByWeek.get(weekId).add(weightClass);
  });
  if (classesByWeek.size === 0) return null;

  const weeksSnap = await db.collection("weeks")
      .orderBy("startDate", "desc").get();
  for (const weekDoc of weeksSnap.docs) {
    const classes = classesByWeek.get(weekDoc.id);
    if (classes && classes.size > 0) {
      return weekDoc.id;
    }
  }
  return null;
}

/**
 * Enforces a hard cap on how many comments a user may post on a single week's
 * ranking (tracked in an Admin-only commentCounts/{weekId}_{uid} counter that
 * resets naturally each week — a new week means a new counter doc) AND writes
 * the comment itself in the SAME transaction. Consuming the weekly slot and
 * creating the comment atomically means a failed comment write can't leave the
 * counter decremented with no comment posted. The cap is re-checked inside the
 * transaction so two concurrent posts still can't both slip past it. All reads
 * happen before any writes; the comment lives at a caller-supplied,
 * pre-generated ref so nothing extra needs to be read here.
 * @param {string} uid Firebase Auth uid of the commenter.
 * @param {string} weekId Week the comment belongs to.
 * @param {number} limit Max comments allowed for that user that week.
 * @param {FirebaseFirestore.DocumentReference} commentRef Pre-generated ref the
 *     comment will be created at.
 * @param {Object} commentData The comment document body to create.
 */
async function consumeWeeklyQuotaAndAddComment(
    uid, weekId, limit, commentRef, commentData) {
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
    transaction.set(commentRef, commentData);
  });
}

// Records an agree/disagree vote on a published ranking list. One vote per
// user per list (deterministic doc id), toggle-style.
exports.castVote = onCall(CALLABLE_OPTS, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to vote.");
  }
  if (!auth.token.email_verified) {
    throw new HttpsError(
        "permission-denied", "Please verify your email first.",
    );
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

  // Voting is only open on the current (latest) week. Past weeks are
  // view-only: their rankings, tallies, and comments stay readable, but no
  // new votes can be cast.
  const latestWeekId = await getLatestWeekId();
  if (!listSnap.data().weekId || listSnap.data().weekId !== latestWeekId) {
    throw new HttpsError(
        "failed-precondition",
        "Voting is closed on past weeks. Only the current week is open.",
    );
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
exports.postComment = onCall(CALLABLE_OPTS, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to comment.");
  }
  if (!auth.token.email_verified) {
    throw new HttpsError(
        "permission-denied", "Please verify your email before commenting.",
    );
  }

  const {listId, text, parentId} = request.data || {};
  if (typeof listId !== "string" || !listId || typeof text !== "string") {
    throw new HttpsError("invalid-argument", "Invalid comment payload.");
  }
  // parentId is optional; when present it must be a non-empty string naming the
  // comment being replied to.
  if (parentId !== undefined && parentId !== null &&
      (typeof parentId !== "string" || !parentId)) {
    throw new HttpsError("invalid-argument", "Invalid parent comment.");
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

  // Replies: the parent must be a real comment on this same ranking, and the
  // thread can't nest deeper than COMMENT_MAX_DEPTH. Reading the parent
  // server-side is what stops a modified client from stitching a reply onto
  // another list's thread or forging its depth. Its depth is derived here from
  // the parent's, so a client can't claim an arbitrary nesting level.
  let depth = 0;
  if (parentId) {
    const parentSnap = await db.collection("comments").doc(parentId).get();
    if (!parentSnap.exists || parentSnap.data().listId !== listId) {
      throw new HttpsError(
          "not-found", "The comment you're replying to is gone.",
      );
    }
    depth = (parentSnap.data().depth || 0) + 1;
    if (depth > COMMENT_MAX_DEPTH) {
      throw new HttpsError(
          "failed-precondition",
          "This thread is nested too deep. Reply higher up instead.",
      );
    }
  }

  // Weekly quota gates FIRST, with a cheap read-only check, BEFORE any
  // rate-limit slot is spent: a user already at their weekly cap is the
  // cheaper/more-final rejection, so bounce them here rather than burning an
  // hourly rate-limit slot and resetting their 10s min-interval on an attempt
  // that could never post. This read is advisory only — the authoritative,
  // concurrency-safe consume happens inside the transaction below.
  const quotaRef = db.collection("commentCounts").doc(`${weekId}_${auth.uid}`);
  const quotaSnap = await quotaRef.get();
  const usedThisWeek = quotaSnap.exists ? (quotaSnap.data().count || 0) : 0;
  if (usedThisWeek >= COMMENT_MAX_PER_WEEK) {
    throw new HttpsError(
        "resource-exhausted",
        `You've used all ${COMMENT_MAX_PER_WEEK} comments for ` +
        "this week's ranking.",
    );
  }

  await checkRateLimit(
      auth.uid, "postComment", COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_MS, COMMENT_MIN_INTERVAL_MS,
  );

  // Stored as-is; the client escapes this text at render time (index-init.js),
  // so it's never interpreted as HTML — no need to mangle it here too.
  const userName = (auth.token.name || "Fan").slice(0, 60);

  // Hard cap: each user gets COMMENT_MAX_PER_WEEK comments per week's ranking
  // (replies count against the same cap). Consuming that slot and creating the
  // comment happen in ONE transaction via a pre-generated ref, so if the write
  // can't commit the counter isn't decremented for nothing.
  const commentRef = db.collection("comments").doc();
  await consumeWeeklyQuotaAndAddComment(
      auth.uid, weekId, COMMENT_MAX_PER_WEEK, commentRef, {
        listId,
        weekId,
        userId: auth.uid,
        userName,
        text: trimmed,
        parentId: parentId || null,
        depth,
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
exports.submitUserRanking = onCall(CALLABLE_OPTS, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to save your ranking.");
  }
  if (!auth.token.email_verified) {
    throw new HttpsError(
        "permission-denied", "Please verify your email first.",
    );
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

  // Fan rankings can only be built on the current (latest) week. Past weeks
  // are view-only, so the People's Ranking of a closed week is frozen.
  const latestWeekId = await getLatestWeekId();
  if (!listSnap.data().weekId || listSnap.data().weekId !== latestWeekId) {
    throw new HttpsError(
        "failed-precondition",
        "Rankings are closed on past weeks. Only the current week is open.",
    );
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

/**
 * Deletes every document a query returns, in batches of BATCH_LIMIT so we stay
 * under Firestore's 500-writes-per-batch limit even for a heavy user.
 * @param {FirebaseFirestore.Query} query A query whose matches should be
 *     deleted.
 */
async function deleteQueryInBatches(query) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await query.limit(BATCH_LIMIT).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    // A full page likely means more remain; keep going until a short page.
    if (snap.size < BATCH_LIMIT) return;
  }
}

// Lets a signed-in user permanently delete their own account: their Firestore
// footprint (comments, votes, fan rankings, per-week counters, rate-limit
// state, and ranker access if any) plus the Firebase Auth record itself. Run
// server-side with the Admin SDK because votes/userRankings/rateLimits/
// commentCounts are all client-write-denied, and deleting the Auth user needs
// admin privileges. The user only deletes THEIR OWN account — uid comes from
// the verified auth token, never from client input.
exports.deleteMyAccount = onCall(CALLABLE_OPTS, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Sign in to delete your account.");
  }
  const uid = auth.uid;

  // Remove the user's own content and any collections keyed to their uid.
  await deleteQueryInBatches(
      db.collection("comments").where("userId", "==", uid));
  await deleteQueryInBatches(
      db.collection("votes").where("userId", "==", uid));
  await deleteQueryInBatches(
      db.collection("userRankings").where("userId", "==", uid));
  await deleteQueryInBatches(
      db.collection("commentCounts").where("userId", "==", uid));

  // Single-doc, uid-keyed records: rate-limit state and ranker access. Deleting
  // a non-existent doc is a no-op, so no existence check is needed.
  await db.collection("rateLimits").doc(uid).delete();
  await db.collection("rankers").doc(uid).delete();

  // Finally, remove the Auth account. Do this last so a failure above leaves
  // the account intact and retryable rather than orphaning a signed-in user
  // with half-deleted data.
  await admin.auth().deleteUser(uid);

  return {ok: true};
});
