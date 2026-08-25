import {escapeHtml, formatDateTime} from "./util.js";

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

let officialOrder = []; // the ranker's published order for the current list
let userRankings = []; // every fan's submitted order for the current list
let fanOrder = []; // this signed-in user's working order (drag state)
let fanDirty = false; // unsaved local changes
let fanDraggedId = null;

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
onSnapshot(query(collection(db, "weeks"), orderBy("startDate", "desc")), (snap) => {
  const weeks = snap.docs.map((d) => ({id: d.id, ...d.data()}));
  if (weeks.length === 0) {
    weekSelect.innerHTML = "<option>No weeks published yet</option>";
    weightTabsEl.innerHTML = "";
    rankingListEl.innerHTML = '<li class="empty">Check back once the ranker publishes the first week.</li>';
    return;
  }
  latestWeekId = weeks[0].id;
  weekSelect.innerHTML = weeks.map((w) => `<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("");

  // Honor a ?week= deep link once (from the Archive page), else default to the
  // latest week.
  const wanted = weekParam();
  if (!weekParamApplied && wanted && weeks.some((w) => w.id === wanted)) {
    currentWeekId = wanted;
    userHasPickedWeek = true;
    weekParamApplied = true;
  } else if (!userHasPickedWeek || !weeks.some((w) => w.id === currentWeekId)) {
    currentWeekId = weeks[0].id;
  }
  weekSelect.value = currentWeekId;
  updateCommentAccess();
  loadListsForWeek(currentWeekId);
});

weekSelect.addEventListener("change", () => {
  userHasPickedWeek = true;
  userHasPickedTab = false;
  currentWeekId = weekSelect.value;
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

function renderWeightTabs() {
  if (weekLists.length === 0) {
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
    <button class="weight-tab${l.id === currentListId ? " active" : ""}" data-id="${l.id}">${escapeHtml(l.weightClass)}</button>
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
  if (unsubList) unsubList();
  if (unsubVotes) unsubVotes();
  if (unsubComments) unsubComments();
  if (unsubUserRankings) unsubUserRankings();

  // Switching lists resets any unsaved fan drag state.
  fanDirty = false;

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

  viewCaptionEl.textContent = "Set by this week's ranker.";
  rankingListEl.innerHTML = data.order.map((wrestlerId, i) => {
    const w = wrestlers.get(wrestlerId);
    if (!w) return "";
    return `
      <li class="player-row">
        <span class="rank">#${i + 1}</span>
        <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)}</div></span>
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
    `Consensus of ${fans} fan ranking${fans === 1 ? "" : "s"}. Arrows show the move vs the ranker.`;

  const consensus = computePeoplesRanking();
  const officialRank = new Map(officialOrder.map((id, i) => [id, i + 1]));

  rankingListEl.innerHTML = consensus.map((entry, i) => {
    const w = wrestlers.get(entry.id);
    if (!w) return "";
    const peopleRank = i + 1;
    const rankerRank = officialRank.get(entry.id);
    const delta = rankerRank ? rankerRank - peopleRank : 0; // + = moved up
    const move = delta > 0 ?
      `<span class="delta up">&#9650; ${delta}</span>` :
      delta < 0 ?
      `<span class="delta down">&#9660; ${Math.abs(delta)}</span>` :
      `<span class="delta even">&ndash;</span>`;
    const avgLabel = entry.count > 0 ? `avg ${entry.avg.toFixed(1)}` : "unranked";
    return `
      <li class="player-row people-row">
        <span class="rank">#${peopleRank}</span>
        <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)} &middot; ${avgLabel}</div></span>
        ${move}
      </li>`;
  }).join("");
}

function renderVoteWidget(snap) {
  let agree = 0;
  let disagree = 0;
  let myVote = null;
  snap.docs.forEach((d) => {
    const v = d.data();
    if (v.value === "agree") agree += 1;
    else if (v.value === "disagree") disagree += 1;
    if (auth.currentUser && v.userId === auth.currentUser.uid) myVote = v.value;
  });
  voteWidgetEl.innerHTML = `
    <p class="vote-question">Do you agree with this week's ranking?</p>
    <div class="vote-buttons">
      <button class="vote-btn${myVote === "agree" ? " active-agree" : ""}" data-value="agree">Agree (${agree})</button>
      <button class="vote-btn${myVote === "disagree" ? " active-disagree" : ""}" data-value="disagree">Disagree (${disagree})</button>
    </div>
    <p class="form-error" id="vote-error"></p>
  `;
  voteWidgetEl.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.addEventListener("click", () => castVote(btn.dataset.value));
  });
}

async function castVote(value) {
  if (!auth.currentUser) {
    window.location.href = SIGN_IN_NEXT;
    return;
  }
  try {
    await castVoteFn({listId: currentListId, value});
  } catch (err) {
    document.getElementById("vote-error").textContent = err.message || "Vote failed. Try again.";
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
  const signedIn = !!auth.currentUser;
  const hasList = officialOrder.length > 0;

  fanSignInPrompt.style.display = signedIn ? "none" : (hasList ? "" : "none");
  fanBuilder.style.display = signedIn && hasList ? "" : "none";
  if (!signedIn || !hasList) return;

  if (!fanDirty) {
    fanOrder = reconcileFanOrder(myExistingRanking() || officialOrder);
  } else {
    fanOrder = reconcileFanOrder(fanOrder);
  }

  fanOrderList.innerHTML = fanOrder.map((id, i) => {
    const w = wrestlers.get(id);
    if (!w) return "";
    return `
      <li draggable="true" data-id="${id}" class="fan-drag-item">
        <span class="drag-rank">#${i + 1}</span>
        <span class="drag-name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)}</div></span>
        <span class="drag-handle" aria-hidden="true">&#8942;&#8942;</span>
      </li>`;
  }).join("");
  attachFanDragHandlers();

  const saved = myExistingRanking();
  if (fanDirty) {
    fanSaveIndicator.textContent = "Unsaved changes";
  } else if (saved) {
    fanSaveIndicator.textContent = "Saved";
  } else {
    fanSaveIndicator.textContent = "";
  }
}

function attachFanDragHandlers() {
  fanOrderList.querySelectorAll("li[draggable='true']").forEach((li) => {
    li.addEventListener("dragstart", () => {
      fanDraggedId = li.dataset.id;
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      fanDraggedId = null;
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
  if (commentClosedNote) commentClosedNote.style.display = current ? "none" : "";
  commentForm.style.display = current && signedIn ? "" : "none";
  commentSignInPrompt.style.display = current && !signedIn ? "" : "none";
}

function renderComments(snap) {
  if (snap.empty) {
    commentsListEl.innerHTML = '<p class="empty">No comments yet — be the first to weigh in.</p>';
    return;
  }
  commentsListEl.innerHTML = snap.docs.map((d) => {
    const c = d.data();
    return `
      <div class="comment">
        <div class="comment-meta"><strong>${escapeHtml(c.userName)}</strong> · ${formatDateTime(c.createdAt)}</div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
      </div>`;
  }).join("");
}

commentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  commentError.textContent = "";
  const text = commentText.value.trim();
  if (!text) return;
  try {
    await postCommentFn({listId: currentListId, text});
    commentText.value = "";
  } catch (err) {
    commentError.textContent = err.message || "Couldn't post comment. Please try again.";
  }
});

onAuthStateChanged(auth, () => {
  fanDirty = false;
  updateCommentAccess();
  renderFanBuilder();
});
