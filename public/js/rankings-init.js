import {escapeHtml, formatDateTime, wrestlerSubline} from "./util.js";

const {
  auth, db, collection, doc, onSnapshot,
  query, where, orderBy, onAuthStateChanged, httpsCallable, functions,
} = window.rankingApp;

const castVoteFn = httpsCallable(functions, "castVote");
const postCommentFn = httpsCallable(functions, "postComment");
const submitUserRankingFn = httpsCallable(functions, "submitUserRanking");

const weekSelect = document.getElementById("week-select");
const weightTabsEl = document.getElementById("weight-tabs");
const rankingListEl = document.getElementById("ranking-list");
const voteWidgetEl = document.getElementById("vote-widget");
const viewToggleEl = document.getElementById("view-toggle");
const viewCaptionEl = document.getElementById("view-caption");

const fanSection = document.getElementById("fan-rank-section");
const fanSignInPrompt = document.getElementById("fan-signin-prompt");
const fanBuilder = document.getElementById("fan-rank-builder");
const fanOrderList = document.getElementById("fan-order-list");
const saveRankingBtn = document.getElementById("save-ranking-btn");
const resetRankingBtn = document.getElementById("reset-ranking-btn");
const fanSaveIndicator = document.getElementById("fan-save-indicator");
const fanRankError = document.getElementById("fan-rank-error");

const commentsListEl = document.getElementById("comments-list");
const commentForm = document.getElementById("comment-form");
const commentText = document.getElementById("comment-text");
const commentError = document.getElementById("comment-error");
const commentSignInPrompt = document.getElementById("comment-signin-prompt");
const commentClosedNote = document.getElementById("comment-closed-note");
const addCommentBtn = document.getElementById("add-comment-btn");
const cancelCommentBtn = document.getElementById("cancel-comment-btn");
let commentFormOpen = false;

const SIGN_IN_NEXT = "sign-in?next=rankings";

let wrestlers = new Map();
let weekLists = [];
let currentWeekId = null;
let latestWeekId = null;
let currentListId = null;
let userHasPickedWeek = false;
let userHasPickedTab = false;
let weekParamApplied = false;
let currentView = "ranker"; // "ranker" | "people"
let fanRefView = "ranker"; // reference list shown beside the fan builder

let officialOrder = []; // the ranker's published order for the current list
let userRankings = []; // every fan's submitted order for the current list
let fanOrder = []; // this signed-in user's working order (drag state)
let fanDirty = false; // unsaved local changes
let fanDraggedId = null;
let fanDragging = false; // an HTML5 drag is currently in progress

let unsubLists = null;
let unsubList = null;
let unsubVotes = null;
let unsubComments = null;
let unsubUserRankings = null;

function weekParam() {
  return new URLSearchParams(window.location.search).get("week");
}

// --- Roster (kept live so a wrestler the ranker just added shows up right away) ---
onSnapshot(collection(db, "wrestlers"), (snap) => {
  wrestlers = new Map(snap.docs.map((d) => [d.id, d.data()]));
  renderRankingList();
  renderFanBuilder();
});

// --- Weeks ---
// The "current" week is the newest week (by startDate) that has ALL 14 weight
// classes published — a week only goes live once it's fully submitted. This
// keeps the previous live week open for votes/comments while the ranker builds
// an as-yet-unsubmitted next week. Two live sources feed the decision, so each
// just refreshes state and re-runs applyWeeks():
//   allWeeks          — every week, newest first
//   publishedByWeek   — weekId -> Set of published weight classes, right now
let allWeeks = [];
let publishedByWeek = new Map();
let subscribedWeekId = null;

onSnapshot(query(collection(db, "weeks"), orderBy("startDate", "desc")), (snap) => {
  allWeeks = snap.docs.map((d) => ({id: d.id, ...d.data()}));
  applyWeeks();
});

// A global listener over every published list, used only to derive which weeks
// are "live". Single equality filter — no composite index required.
onSnapshot(
    query(collection(db, "rankingLists"), where("published", "==", true)),
    (snap) => {
      publishedByWeek = new Map();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (!data.weekId) return;
        if (!publishedByWeek.has(data.weekId)) {
          publishedByWeek.set(data.weekId, new Set());
        }
        publishedByWeek.get(data.weekId).add(data.weightClass);
      });
      applyWeeks();
    },
);

// The current (votable) week is the NEWEST week that has any published
// rankings. Publishing is all-or-nothing from the dashboard ("Submit all 14"),
// so in normal use this is a fully-submitted week; keying off "has any published
// list" (rather than requiring all 14) guarantees the most recent published week
// is always the current one you can weigh in on. Kept in sync with the server's
// getLatestWeekId() in functions/index.js — both must agree or a vote the UI
// allows would be rejected server-side.
function computeLatestWeekId() {
  const w = allWeeks.find((week) => {
    const classes = publishedByWeek.get(week.id);
    return classes && classes.size > 0;
  });
  return w ? w.id : null;
}

function applyWeeks() {
  const weeks = allWeeks;
  if (weeks.length === 0) {
    weekSelect.innerHTML = "<option>No weeks published yet</option>";
    weightTabsEl.innerHTML = "";
    rankingListEl.innerHTML = '<li class="empty">Check back once the ranker publishes the first week.</li>';
    return;
  }
  latestWeekId = computeLatestWeekId();
  weekSelect.innerHTML = weeks.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.label)}</option>`).join("");

  // Honor a ?week= deep link once (from the Archive page), else default to the
  // current (newest published) week — falling back to the newest week overall
  // when nothing is published yet, so the dropdown still shows something.
  const wanted = weekParam();
  if (!weekParamApplied && wanted && weeks.some((w) => w.id === wanted)) {
    currentWeekId = wanted;
    userHasPickedWeek = true;
    weekParamApplied = true;
  } else if (!userHasPickedWeek || !weeks.some((w) => w.id === currentWeekId)) {
    currentWeekId = latestWeekId || weeks[0].id;
  }
  weekSelect.value = currentWeekId;
  updateCommentAccess();
  // Only (re)subscribe when the selected week actually changed; the published
  // listener above fires whenever any list is published, and loadListsForWeek's
  // own snapshot already tracks published lists for the selected week.
  if (currentWeekId !== subscribedWeekId) {
    subscribedWeekId = currentWeekId;
    loadListsForWeek(currentWeekId);
  }
}

weekSelect.addEventListener("change", () => {
  userHasPickedWeek = true;
  userHasPickedTab = false;
  currentWeekId = weekSelect.value;
  subscribedWeekId = currentWeekId;
  updateCommentAccess();
  loadListsForWeek(currentWeekId);
});

function loadListsForWeek(weekId) {
  if (unsubLists) unsubLists();
  const q = query(
      collection(db, "rankingLists"),
      where("weekId", "==", weekId),
      where("published", "==", true),
  );
  unsubLists = onSnapshot(q, (snap) => {
    weekLists = snap.docs.map((d) => ({id: d.id, ...d.data()}));
    weekLists.sort((a, b) => {
      const na = parseFloat(a.weightClass);
      const nb = parseFloat(b.weightClass);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.weightClass.localeCompare(b.weightClass);
    });
    renderWeightTabs();
  });
}

// Tear down the four list-scoped listeners so a stale list can't keep repainting
// over the current view. Nulls the handles so a later unsub is a no-op.
function teardownListListeners() {
  if (unsubList) unsubList();
  if (unsubVotes) unsubVotes();
  if (unsubComments) unsubComments();
  if (unsubUserRankings) unsubUserRankings();
  unsubList = unsubVotes = unsubComments = unsubUserRankings = null;
}

function renderWeightTabs() {
  if (weekLists.length === 0) {
    // No published list for this week: kill the previous list's listeners (they
    // would otherwise repaint stale data over this empty state) and forget the
    // last list snapshot so renderRankingList can't resurrect it.
    teardownListListeners();
    lastListData = null;
    closeReply();
    weightTabsEl.innerHTML = "";
    rankingListEl.innerHTML = '<li class="empty">No weight classes published for this week yet.</li>';
    voteWidgetEl.innerHTML = "";
    commentsListEl.innerHTML = "";
    viewCaptionEl.textContent = "";
    officialOrder = [];
    userRankings = [];
    renderFanBuilder();
    return;
  }
  if (!userHasPickedTab || !weekLists.some((l) => l.id === currentListId)) {
    currentListId = weekLists[0].id;
  }
  weightTabsEl.innerHTML = weekLists.map((l) => `
    <button class="weight-tab${l.id === currentListId ? " active" : ""}" data-id="${escapeHtml(l.id)}">${escapeHtml(l.weightClass)}</button>
  `).join("");
  weightTabsEl.querySelectorAll(".weight-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      userHasPickedTab = true;
      currentListId = btn.dataset.id;
      weightTabsEl.querySelectorAll(".weight-tab").forEach((b) => b.classList.toggle("active", b === btn));
      subscribeToList();
    });
  });
  subscribeToList();
}

function subscribeToList() {
  teardownListListeners();

  // Switching lists resets any unsaved fan drag state.
  fanDirty = false;

  // A reply/comment must never cross lists. Close any open reply form — its
  // replyTargetId points at a comment from the PREVIOUS list, so submitting it
  // now would post a reply to a nonexistent parent — and drop any half-typed
  // top-level comment draft so it can't leak into the newly selected list.
  closeReply();
  commentFormOpen = false;
  commentText.value = "";
  commentError.textContent = "";
  updateCommentAccess();

  unsubList = onSnapshot(doc(db, "rankingLists", currentListId), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    officialOrder = data && Array.isArray(data.order) ? data.order : [];
    renderRankingList(data);
    renderFanBuilder();
  });

  unsubVotes = onSnapshot(
      query(collection(db, "votes"), where("listId", "==", currentListId)),
      renderVoteWidget,
  );

  unsubUserRankings = onSnapshot(
      query(collection(db, "userRankings"), where("listId", "==", currentListId)),
      (snap) => {
        userRankings = snap.docs.map((d) => d.data());
        renderRankingList();
        renderViewToggle();
        renderFanBuilder();
      },
  );

  unsubComments = onSnapshot(
      query(collection(db, "comments"), where("listId", "==", currentListId), orderBy("createdAt")),
      renderComments,
  );
}

// --- View toggle (Ranker's vs People's) ---
viewToggleEl.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    renderViewToggle();
    renderRankingList();
    renderFanBuilder();
  });
});

function renderViewToggle() {
  viewToggleEl.querySelectorAll(".view-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
  });
  const peopleTab = viewToggleEl.querySelector('.view-tab[data-view="people"]');
  if (peopleTab) {
    peopleTab.textContent = userRankings.length > 0 ?
      `The People's Ranking (${userRankings.length})` : "The People's Ranking";
  }
}

/**
 * Aggregate every fan's submitted order into a consensus ranking: each wrestler
 * scored by their average position across all submissions, lowest (best) first.
 */
function computePeoplesRanking() {
  const totals = new Map(); // id -> {sum, count}
  userRankings.forEach((r) => {
    if (!Array.isArray(r.order)) return;
    r.order.forEach((id, i) => {
      if (!officialOrder.includes(id)) return; // ignore stale entries
      const t = totals.get(id) || {sum: 0, count: 0};
      t.sum += i + 1;
      t.count += 1;
      totals.set(id, t);
    });
  });
  return officialOrder
      .map((id) => {
        const t = totals.get(id);
        return {
          id,
          avg: t ? t.sum / t.count : Infinity,
          count: t ? t.count : 0,
        };
      })
      .sort((a, b) => {
        if (a.avg !== b.avg) return a.avg - b.avg;
        const wa = wrestlers.get(a.id);
        const wb = wrestlers.get(b.id);
        return (wa ? wa.name : "").localeCompare(wb ? wb.name : "");
      });
}

let lastListData = null;

function renderRankingList(listData) {
  if (listData !== undefined) lastListData = listData;
  const data = lastListData;
  if (!data) {
    rankingListEl.innerHTML = '<li class="empty">Loading...</li>';
    viewCaptionEl.textContent = "";
    return;
  }
  if (!data.order || data.order.length === 0) {
    rankingListEl.innerHTML = '<li class="empty">The ranker hasn\'t ordered any wrestlers here yet.</li>';
    viewCaptionEl.textContent = "";
    return;
  }

  if (currentView === "people") {
    renderPeoplesRankingList();
    return;
  }

  viewCaptionEl.textContent = "The official ranking, set by the head of Montana's rankings.";
  // Number by the wrestlers actually displayed: filter out any id no longer in
  // the roster FIRST, so ranks stay contiguous 1..N with no gaps and no skew
  // (a missing middle entry must not push everyone below it down a number).
  rankingListEl.innerHTML = data.order
      .filter((wrestlerId) => wrestlers.has(wrestlerId))
      .map((wrestlerId, i) => {
        const w = wrestlers.get(wrestlerId);
        return `
      <li class="player-row">
        <span class="rank">#${i + 1}</span>
        <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
      </li>`;
      }).join("");
}

function renderPeoplesRankingList() {
  if (userRankings.length === 0) {
    viewCaptionEl.textContent = "No fan rankings yet — be the first to build one below.";
    rankingListEl.innerHTML = '<li class="empty">Once fans save their own rankings, the consensus shows up here.</li>';
    return;
  }
  const fans = userRankings.length;
  viewCaptionEl.textContent =
    `Consensus of ${fans} fan ranking${fans === 1 ? "" : "s"}. Arrows show the move vs the official ranking.`;

  const consensus = computePeoplesRanking();
  const officialRank = new Map(officialOrder.map((id, i) => [id, i + 1]));

  // Number by the wrestlers actually displayed (drop any id no longer in the
  // roster first) so the People's ranks are contiguous 1..N. The official-rank
  // delta below is still measured against the full official order.
  rankingListEl.innerHTML = consensus
      .filter((entry) => wrestlers.has(entry.id))
      .map((entry, i) => {
    const w = wrestlers.get(entry.id);
    const peopleRank = i + 1;
    const rankerRank = officialRank.get(entry.id);
    const delta = rankerRank ? rankerRank - peopleRank : 0; // + = moved up
    const move = delta > 0 ?
      `<span class="delta up">&#9650; ${delta}</span>` :
      delta < 0 ?
      `<span class="delta down">&#9660; ${Math.abs(delta)}</span>` :
      `<span class="delta even">&ndash;</span>`;
    return `
      <li class="player-row people-row">
        <span class="rank">#${peopleRank}</span>
        <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
        ${move}
      </li>`;
  }).join("");
}

// Vote tallies for the current list, kept in module state so an optimistic
// click can repaint instantly without waiting on the server round-trip. The
// votes are written by the castVote Cloud Function (Admin SDK), so there's no
// Firestore latency compensation — without this, the buttons wouldn't react
// until the function returned and the snapshot pushed back.
let voteAgree = 0;
let voteDisagree = 0;
let voteMine = null;
let voteInFlight = false;

function renderVoteWidget(snap) {
  voteAgree = 0;
  voteDisagree = 0;
  voteMine = null;
  snap.docs.forEach((d) => {
    const v = d.data();
    if (v.value === "agree") voteAgree += 1;
    else if (v.value === "disagree") voteDisagree += 1;
    if (auth.currentUser && v.userId === auth.currentUser.uid) voteMine = v.value;
  });
  // Authoritative data has arrived, so any pending optimistic click is settled.
  voteInFlight = false;
  paintVoteWidget();
}

function paintVoteWidget() {
  // Past weeks are view-only: show the final tallies but disable the buttons.
  const current = isCurrentWeek();
  const dis = current ? "" : " disabled";
  const closedNote = current ? "" :
    '<span class="vote-closed-note">Voting is closed for past weeks.</span>';
  voteWidgetEl.innerHTML = `
    <span class="vote-q">Agree with the official ranking?</span>
    <div class="vote-chips">
      <button class="vote-chip${voteMine === "agree" ? " active-agree" : ""}" data-value="agree"${dis}>Agree · ${voteAgree}</button>
      <button class="vote-chip${voteMine === "disagree" ? " active-disagree" : ""}" data-value="disagree"${dis}>Disagree · ${voteDisagree}</button>
    </div>
    ${closedNote}
    <span class="form-error vote-error" id="vote-error"></span>
  `;
  if (current) {
    voteWidgetEl.querySelectorAll(".vote-chip").forEach((btn) => {
      btn.addEventListener("click", () => castVote(btn.dataset.value));
    });
  }
}

async function castVote(value) {
  if (!isCurrentWeek()) return; // view-only on past weeks
  if (!auth.currentUser) {
    window.location.href = SIGN_IN_NEXT;
    return;
  }
  if (voteInFlight) return; // ignore rapid re-clicks while a vote is settling
  if (voteMine === value) return; // already your vote — nothing to do

  // Optimistic update: reflect the new vote immediately, remembering the prior
  // state so we can roll back if the server rejects it. The votes snapshot will
  // repaint with authoritative tallies moments later (or castVote throws and we
  // revert here).
  const prev = {agree: voteAgree, disagree: voteDisagree, mine: voteMine};
  if (voteMine === "agree") voteAgree = Math.max(0, voteAgree - 1);
  else if (voteMine === "disagree") voteDisagree = Math.max(0, voteDisagree - 1);
  if (value === "agree") voteAgree += 1;
  else voteDisagree += 1;
  voteMine = value;
  voteInFlight = true;
  paintVoteWidget();

  try {
    await castVoteFn({listId: currentListId, value});
  } catch (err) {
    voteAgree = prev.agree;
    voteDisagree = prev.disagree;
    voteMine = prev.mine;
    voteInFlight = false;
    paintVoteWidget();
    const el = document.getElementById("vote-error");
    if (el) el.textContent = err.message || "Vote failed. Try again.";
  }
}

// --- Fan ranking builder (reorder-only, drag & drop) ---
function myExistingRanking() {
  if (!auth.currentUser) return null;
  const mine = userRankings.find((r) => r.userId === auth.currentUser.uid);
  return mine && Array.isArray(mine.order) ? mine.order : null;
}

function reconcileFanOrder(baseOrder) {
  const inList = baseOrder.filter((id) => officialOrder.includes(id));
  const missing = officialOrder.filter((id) => !inList.includes(id));
  return [...inList, ...missing];
}

function renderFanBuilder() {
  // A remote snapshot (roster / list / another fan saving a ranking) must not
  // rebuild the drag list out from under an in-progress HTML5 drag: that would
  // destroy the dragged <li>, reset fanOrder, and orphan fanDraggedId. Skip the
  // rebuild while dragging; drop/dragend clear the flag and re-render, so any
  // snapshot we skipped is picked up the moment the drag ends.
  if (fanDragging) return;
  const signedIn = !!auth.currentUser;
  const hasList = officialOrder.length > 0;
  const onPeopleView = currentView === "people";
  const current = isCurrentWeek();

  // "Make your own ranking" lives only on the People's Ranking view, and only
  // on the current week — past weeks are view-only, so their People's Ranking
  // is frozen (you can still see the consensus, just not add to it).
  fanSection.style.display = onPeopleView && hasList && current ? "" : "none";
  if (!onPeopleView || !hasList || !current) return;

  fanSignInPrompt.style.display = signedIn ? "none" : "";
  fanBuilder.style.display = signedIn ? "" : "none";
  if (!signedIn) return;

  if (!fanDirty) {
    fanOrder = reconcileFanOrder(myExistingRanking() || officialOrder);
  } else {
    fanOrder = reconcileFanOrder(fanOrder);
  }

  fanOrderList.innerHTML = fanOrder.map((id, i) => {
    const w = wrestlers.get(id);
    if (!w) return "";
    const isFirst = i === 0;
    const isLast = i === fanOrder.length - 1;
    return `
      <li draggable="true" data-id="${escapeHtml(id)}" class="fan-drag-item">
        <span class="drag-rank">#${i + 1}</span>
        <span class="drag-name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
        <span class="move-btns">
          <button type="button" class="move-btn" data-id="${escapeHtml(id)}" data-dir="up" title="Move up"${isFirst ? " disabled" : ""}>&#9650;</button>
          <button type="button" class="move-btn" data-id="${escapeHtml(id)}" data-dir="down" title="Move down"${isLast ? " disabled" : ""}>&#9660;</button>
        </span>
      </li>`;
  }).join("");
  attachFanDragHandlers();

  // Touch-friendly reordering (drag-and-drop doesn't work on phones).
  fanOrderList.querySelectorAll(".move-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = fanOrder.indexOf(btn.dataset.id);
      if (idx === -1) return;
      const swap = btn.dataset.dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= fanOrder.length) return;
      [fanOrder[idx], fanOrder[swap]] = [fanOrder[swap], fanOrder[idx]];
      fanDirty = true;
      renderFanBuilder();
    });
  });

  const saved = myExistingRanking();
  if (fanDirty) {
    fanSaveIndicator.textContent = "Unsaved changes";
  } else if (saved) {
    fanSaveIndicator.textContent = "Saved";
  } else {
    fanSaveIndicator.textContent = "";
  }

  renderFanRef();
}

// Read-only reference list shown beside the builder so a fan can eyeball the
// official order or the current People's consensus while dragging their own.
const fanRefToggle = document.getElementById("fan-ref-toggle");
const fanRefListEl = document.getElementById("fan-ref-list");

fanRefToggle.querySelectorAll(".ref-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    fanRefView = btn.dataset.ref;
    fanRefToggle.querySelectorAll(".ref-tab")
        .forEach((b) => b.classList.toggle("active", b === btn));
    renderFanRef();
  });
});

function refRow(id, i) {
  const w = wrestlers.get(id);
  if (!w) return "";
  return `
    <li class="player-row ref-row">
      <span class="rank">#${i + 1}</span>
      <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
    </li>`;
}

function renderFanRef() {
  if (!fanRefListEl) return;
  if (officialOrder.length === 0) {
    fanRefListEl.innerHTML = "";
    return;
  }
  if (fanRefView === "people") {
    if (userRankings.length === 0) {
      fanRefListEl.innerHTML = '<li class="empty">No fan rankings yet.</li>';
      return;
    }
    fanRefListEl.innerHTML = computePeoplesRanking()
        .map((entry, i) => refRow(entry.id, i)).join("");
  } else {
    fanRefListEl.innerHTML = officialOrder
        .map((id, i) => refRow(id, i)).join("");
  }
}

function attachFanDragHandlers() {
  fanOrderList.querySelectorAll("li[draggable='true']").forEach((li) => {
    li.addEventListener("dragstart", () => {
      fanDragging = true;
      fanDraggedId = li.dataset.id;
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      fanDraggedId = null;
      fanDragging = false;
      // Re-render in case a snapshot arrived (and was skipped) mid-drag.
      renderFanBuilder();
    });
  });
}

function fanDragAfterElement(y) {
  const els = [...fanOrderList.querySelectorAll("li[draggable='true']:not(.dragging)")];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return {offset, element: child};
    return closest;
  }, {offset: -Infinity, element: null}).element;
}

fanOrderList.addEventListener("dragover", (e) => e.preventDefault());
fanOrderList.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!fanDraggedId) return;
  const afterEl = fanDragAfterElement(e.clientY);
  fanOrder = fanOrder.filter((id) => id !== fanDraggedId);
  const insertIndex = afterEl ? fanOrder.indexOf(afterEl.dataset.id) : -1;
  fanOrder.splice(insertIndex === -1 ? fanOrder.length : insertIndex, 0, fanDraggedId);
  fanDirty = true;
  // drop fires before dragend, so clear the guard here to let this rebuild run.
  fanDragging = false;
  renderFanBuilder();
});

saveRankingBtn.addEventListener("click", async () => {
  if (!auth.currentUser) {
    window.location.href = SIGN_IN_NEXT;
    return;
  }
  fanRankError.textContent = "";
  fanSaveIndicator.textContent = "Saving...";
  try {
    await submitUserRankingFn({listId: currentListId, order: fanOrder});
    fanDirty = false;
    fanSaveIndicator.textContent = "Saved";
  } catch (err) {
    fanSaveIndicator.textContent = "";
    fanRankError.textContent = err.message || "Couldn't save your ranking. Try again.";
  }
});

resetRankingBtn.addEventListener("click", () => {
  fanOrder = [...officialOrder];
  fanDirty = true;
  renderFanBuilder();
});

// --- Comments (open only on the current week) ---
function isCurrentWeek() {
  return currentWeekId && currentWeekId === latestWeekId;
}

function updateCommentAccess() {
  const current = isCurrentWeek();
  const signedIn = !!auth.currentUser;
  const canComment = current && signedIn;
  if (!canComment) commentFormOpen = false;

  commentClosedNote.style.display = current ? "none" : "";
  commentSignInPrompt.style.display = current && !signedIn ? "" : "none";
  // Comments stay visible; the box only appears after "Add comment" is clicked.
  addCommentBtn.style.display = canComment && !commentFormOpen ? "" : "none";
  commentForm.style.display = canComment && commentFormOpen ? "" : "none";
}

addCommentBtn.addEventListener("click", () => {
  commentFormOpen = true;
  updateCommentAccess();
  commentText.focus();
});

cancelCommentBtn.addEventListener("click", () => {
  commentFormOpen = false;
  commentError.textContent = "";
  updateCommentAccess();
});

// --- Threaded replies ---
// A single persistent reply form node, moved under whichever comment is being
// replied to. Keeping it as one detached node (rather than markup baked into
// the comments list) means an incoming snapshot re-render never wipes a reply
// the user is midway through typing.
const REPLY_INDENT_STEP = 26; // px of indent added per reply level
const MAX_INDENT_LEVELS = 5; // stop indenting past this so deep chains stay legible

let lastCommentsSnap = null;
let replyTargetId = null;
let replyTargetName = null; // display name of the comment being replied to (for the form hint)

const replyForm = document.createElement("form");
replyForm.className = "comment-reply-form";
replyForm.style.display = "none";
replyForm.innerHTML = `
  <p class="comment-reply-hint" data-reply-hint></p>
  <textarea maxlength="1000" placeholder="Write a reply..." required></textarea>
  <div class="comment-form-actions">
    <button class="btn btn-primary" type="submit">Reply</button>
    <button class="link-btn" type="button" data-reply-cancel>Cancel</button>
  </div>
  <p class="form-error" data-reply-error></p>
`;
const replyTextEl = replyForm.querySelector("textarea");
const replyErrorEl = replyForm.querySelector("[data-reply-error]");
const replyHintEl = replyForm.querySelector("[data-reply-hint]");

replyForm.querySelector("[data-reply-cancel]").addEventListener("click", closeReply);

replyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  replyErrorEl.textContent = "";
  const text = replyTextEl.value.trim();
  if (!text || !replyTargetId) return;
  try {
    await postCommentFn({listId: currentListId, text, parentId: replyTargetId});
    replyTextEl.value = "";
    closeReply();
  } catch (err) {
    replyErrorEl.textContent = err.message || "Couldn't post reply. Please try again.";
  }
});

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

// Look up the display name of a comment by id from the latest snapshot, so the
// reply form can show "Replying to <Name>…". Returns null if it's gone.
function commentNameById(id) {
  if (!lastCommentsSnap) return null;
  const d = lastCommentsSnap.docs.find((doc) => doc.id === id);
  return d ? d.data().userName : null;
}

function openReply(id) {
  if (!isCurrentWeek() || !auth.currentUser) return;
  replyTargetId = id;
  replyTargetName = commentNameById(id);
  // textContent (not innerHTML) — safe to drop the raw name in directly.
  replyHintEl.textContent = replyTargetName ?
    `Replying to ${replyTargetName}…` : "Reply";
  replyErrorEl.textContent = "";
  replyForm.style.display = "";
  positionReplyForm();
  replyTextEl.focus();
}

function closeReply() {
  replyTargetId = null;
  replyTargetName = null;
  replyForm.style.display = "none";
  replyTextEl.value = "";
  if (replyForm.parentNode) replyForm.parentNode.removeChild(replyForm);
}

// Slot the reply form directly under the comment it targets, indented one step
// past it. Called after every render so the form re-attaches to a live node
// (or closes itself if that comment is gone).
function positionReplyForm() {
  if (!replyTargetId) return;
  const target = commentsListEl.querySelector(`.comment[data-id="${cssEscape(replyTargetId)}"]`);
  if (!target) {
    closeReply();
    return;
  }
  const pad = parseFloat(target.style.marginLeft) || 0;
  replyForm.style.marginLeft = `${Math.min(pad + REPLY_INDENT_STEP, MAX_INDENT_LEVELS * REPLY_INDENT_STEP)}px`;
  target.insertAdjacentElement("afterend", replyForm);
}

// Reply buttons are re-created on every snapshot, so delegate their clicks.
commentsListEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".comment-reply-btn");
  if (btn) openReply(btn.dataset.id);
});

// --- @-mention tagging (client-side only) ------------------------------------
// There is no global user directory in this app, so a "taggable person" is
// simply someone who has already commented on the CURRENT list. We read those
// names straight from the latest comments snapshot the module holds.
const MENTION_SUGGEST_MAX = 8; // cap suggestions shown in the dropdown
const MENTION_PART_RE = /@([\w'-]*)$/; // an "@partial" ending at the caret
const MENTION_WORD_RE = /^[\w'-]/; // a char that would extend a name token

// Distinct commenter display names for the current list (insertion order).
function commenterNames() {
  if (!lastCommentsSnap) return [];
  const seen = new Set();
  const names = [];
  lastCommentsSnap.docs.forEach((d) => {
    const n = d.data().userName;
    if (n && !seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  });
  return names;
}

/**
 * Highlight @mentions inside ALREADY-ESCAPED comment text.
 *
 * XSS safety: `escapedText` is the output of escapeHtml(rawText), so it contains
 * no live markup. We match ONLY against the known commenter names, each escaped
 * the SAME way (escapeHtml) before comparison, longest-first so a name that is a
 * prefix of another — or one containing spaces — wins. Characters from
 * `escapedText` are copied through verbatim; the only markup we ever emit is our
 * own <span> plus an already-escaped known-name token. No raw, user-controlled
 * text is ever reintroduced, so nothing an author types can become markup.
 *
 * Worked example — a commenter named `Bob <b>`:
 *   raw name      : Bob <b>
 *   escaped name  : Bob &lt;b&gt;         (the needle we match)
 *   raw text      : hi @Bob <b> there
 *   escapedText   : hi @Bob &lt;b&gt; there
 *   output        : hi <span class="mention">@Bob &lt;b&gt;</span> there
 * The span wraps the escaped token, so the browser renders the literal text
 * "@Bob <b>" highlighted — the <b> never becomes a tag.
 */
function linkifyMentions(escapedText, knownNames) {
  if (!knownNames || knownNames.length === 0) return escapedText;
  const needles = [...new Set(knownNames)]
      .map((n) => escapeHtml(n))
      .filter((n) => n.length > 0)
      .sort((a, b) => b.length - a.length); // longest name first
  if (needles.length === 0) return escapedText;

  let out = "";
  let i = 0;
  while (i < escapedText.length) {
    if (escapedText[i] === "@") {
      const rest = escapedText.slice(i + 1);
      const hit = needles.find((n) => {
        if (!rest.startsWith(n)) return false;
        // Don't let "@Bob" swallow the front of an unrelated longer token
        // ("@Bobby" when only "Bob" is known): require a non-word boundary.
        const after = rest.charAt(n.length);
        return after === "" || !MENTION_WORD_RE.test(after);
      });
      if (hit) {
        out += `<span class="mention">@${hit}</span>`;
        i += 1 + hit.length;
        continue;
      }
    }
    out += escapedText[i];
    i += 1;
  }
  return out;
}

/**
 * Wire an autocomplete dropdown onto a comment/reply textarea. Reusable across
 * both boxes; idempotent (guards against a second attach on the same node) so
 * the persistent reply-form textarea keeps a single instance across re-renders.
 */
function attachMentionAutocomplete(textareaEl) {
  if (!textareaEl || textareaEl.dataset.mentionWired) return;
  textareaEl.dataset.mentionWired = "1";

  // Wrap the textarea so the dropdown can be absolutely positioned right beneath
  // it regardless of the surrounding form's flex layout.
  const anchor = document.createElement("div");
  anchor.className = "mention-anchor";
  textareaEl.parentNode.insertBefore(anchor, textareaEl);
  anchor.appendChild(textareaEl);

  const menu = document.createElement("div");
  menu.className = "mention-suggest";
  menu.style.display = "none";
  anchor.appendChild(menu);

  let matches = [];
  let activeIndex = 0;
  let mentionStart = -1; // index of the "@" currently being completed

  const isOpen = () => menu.style.display !== "none";

  const hide = () => {
    menu.style.display = "none";
    menu.innerHTML = "";
    matches = [];
    mentionStart = -1;
  };

  const render = () => {
    menu.innerHTML = matches.map((name, i) =>
      `<div class="mention-suggest-item${i === activeIndex ? " active" : ""}" data-i="${i}">${escapeHtml(name)}</div>`,
    ).join("");
    menu.style.display = "";
  };

  const update = () => {
    const pos = textareaEl.selectionStart;
    const m = MENTION_PART_RE.exec(textareaEl.value.slice(0, pos));
    if (!m) {
      hide();
      return;
    }
    const q = m[1].toLowerCase();
    matches = commenterNames()
        .filter((n) => n.toLowerCase().startsWith(q))
        .slice(0, MENTION_SUGGEST_MAX);
    if (matches.length === 0) {
      hide();
      return;
    }
    mentionStart = pos - m[0].length;
    activeIndex = 0;
    render();
  };

  const choose = (name) => {
    if (mentionStart < 0 || !name) return;
    const pos = textareaEl.selectionStart;
    const before = textareaEl.value.slice(0, mentionStart);
    const after = textareaEl.value.slice(pos);
    const insert = `@${name} `;
    textareaEl.value = before + insert + after;
    const caret = before.length + insert.length;
    hide();
    textareaEl.focus();
    textareaEl.setSelectionRange(caret, caret);
  };

  textareaEl.addEventListener("input", update);
  textareaEl.addEventListener("keyup", (e) => {
    // Caret moves that aren't text input still change which "@partial" is active.
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update();
  });
  textareaEl.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      render();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(matches[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });
  // mousedown (not click) so selection lands before the textarea's blur hides it.
  menu.addEventListener("mousedown", (e) => {
    const item = e.target.closest(".mention-suggest-item");
    if (!item) return;
    e.preventDefault();
    choose(matches[Number(item.dataset.i)]);
  });
  textareaEl.addEventListener("blur", () => setTimeout(hide, 120));
}

// Attach once to each persistent textarea (the reply-form node is reused across
// snapshot re-renders, so this must NOT run inside renderComments).
attachMentionAutocomplete(commentText);
attachMentionAutocomplete(replyTextEl);

function renderComments(snap) {
  if (snap) lastCommentsSnap = snap;
  const source = lastCommentsSnap;
  if (!source) return;

  const docs = source.docs.map((d) => ({id: d.id, ...d.data()}));
  if (docs.length === 0) {
    commentsListEl.innerHTML = '<p class="empty">No comments yet — be the first to weigh in.</p>';
    closeReply();
    return;
  }

  // Build a parent→children map, then walk it depth-first so each reply renders
  // right under (and indented past) the comment it answers. Docs arrive ordered
  // by createdAt, so siblings stay chronological. A reply whose parent was
  // deleted is promoted to a top-level comment rather than vanishing.
  const ids = new Set(docs.map((c) => c.id));
  const byId = new Map(docs.map((c) => [c.id, c])); // for parent-name lookup
  const children = new Map();
  const roots = [];
  docs.forEach((c) => {
    const pid = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    if (pid) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(c);
    } else {
      roots.push(c);
    }
  });

  const canReply = isCurrentWeek() && !!auth.currentUser;
  const knownNames = commenterNames(); // the only names we highlight in text
  const rows = [];
  const walk = (c, depth) => {
    rows.push({c, depth});
    (children.get(c.id) || []).forEach((k) => walk(k, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));

  commentsListEl.innerHTML = rows.map(({c, depth}) => {
    const indent = Math.min(depth, MAX_INDENT_LEVELS) * REPLY_INDENT_STEP;
    const replyBtn = canReply ?
      `<button type="button" class="link-btn comment-reply-btn" data-id="${escapeHtml(c.id)}">Reply</button>` : "";
    // Attribution line on replies only: name the parent comment's author so a
    // reply reads as clearly answering someone. Parent is guaranteed present in
    // byId for depth > 0 (a promoted orphan renders at depth 0); fall back to a
    // neutral "Reply" if it somehow can't be resolved.
    let replyTo = "";
    if (depth > 0) {
      const parent = byId.get(c.parentId);
      replyTo = parent ?
        `<div class="comment-reply-to">&#8627; Reply to ${escapeHtml(parent.userName)}</div>` :
        `<div class="comment-reply-to">&#8627; Reply</div>`;
    }
    return `
      <div class="comment${depth > 0 ? " comment-reply" : ""}" data-id="${escapeHtml(c.id)}" style="margin-left:${indent}px">
        <div class="comment-meta"><strong>${escapeHtml(c.userName)}</strong> · ${formatDateTime(c.createdAt)}</div>
        ${replyTo}
        <div class="comment-text">${linkifyMentions(escapeHtml(c.text), knownNames)}</div>
        ${replyBtn ? `<div class="comment-actions">${replyBtn}</div>` : ""}
      </div>`;
  }).join("");

  // If replies just closed (past week / signed out) drop any open reply box;
  // otherwise re-attach it to its still-present target comment.
  if (!canReply) closeReply();
  else positionReplyForm();
}

commentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  commentError.textContent = "";
  const text = commentText.value.trim();
  if (!text) return;
  try {
    await postCommentFn({listId: currentListId, text});
    commentText.value = "";
    commentFormOpen = false;
    updateCommentAccess();
  } catch (err) {
    commentError.textContent = err.message || "Couldn't post comment. Please try again.";
  }
});

onAuthStateChanged(auth, () => {
  fanDirty = false;
  updateCommentAccess();
  renderFanBuilder();
  // Reply buttons hinge on being signed in; re-render so they appear/disappear
  // immediately rather than waiting for the next comment to arrive.
  renderComments();
});
