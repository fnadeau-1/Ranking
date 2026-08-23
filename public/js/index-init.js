import {escapeHtml, formatDateTime} from "./util.js";

const {
  auth, db, collection, doc, setDoc, addDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, onAuthStateChanged,
} = window.rankingApp;

const weekSelect = document.getElementById("week-select");
const weightTabsEl = document.getElementById("weight-tabs");
const rankingListEl = document.getElementById("ranking-list");
const voteWidgetEl = document.getElementById("vote-widget");
const commentsListEl = document.getElementById("comments-list");
const commentForm = document.getElementById("comment-form");
const commentText = document.getElementById("comment-text");
const commentError = document.getElementById("comment-error");
const commentSignInPrompt = document.getElementById("comment-signin-prompt");

let wrestlers = new Map();
let weekLists = [];
let currentWeekId = null;
let currentListId = null;
let userHasPickedWeek = false;
let userHasPickedTab = false;

let unsubLists = null;
let unsubList = null;
let unsubVotes = null;
let unsubComments = null;

// --- Roster (kept live so a wrestler the ranker just added shows up right away) ---
onSnapshot(collection(db, "wrestlers"), (snap) => {
  wrestlers = new Map(snap.docs.map((d) => [d.id, d.data()]));
  renderRankingList();
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
  weekSelect.innerHTML = weeks.map((w) => `<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("");
  if (!userHasPickedWeek || !weeks.some((w) => w.id === currentWeekId)) {
    currentWeekId = weeks[0].id;
  }
  weekSelect.value = currentWeekId;
  loadListsForWeek(currentWeekId);
});

weekSelect.addEventListener("change", () => {
  userHasPickedWeek = true;
  userHasPickedTab = false;
  currentWeekId = weekSelect.value;
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

  unsubList = onSnapshot(doc(db, "rankingLists", currentListId), (snap) => {
    renderRankingList(snap.exists() ? snap.data() : null);
  });

  unsubVotes = onSnapshot(
      query(collection(db, "votes"), where("listId", "==", currentListId)),
      renderVoteWidget,
  );

  unsubComments = onSnapshot(
      query(collection(db, "comments"), where("listId", "==", currentListId), orderBy("createdAt")),
      renderComments,
  );
}

let lastListData = null;

function renderRankingList(listData) {
  if (listData !== undefined) lastListData = listData;
  const data = lastListData;
  if (!data) {
    rankingListEl.innerHTML = '<li class="empty">Loading...</li>';
    return;
  }
  if (!data.order || data.order.length === 0) {
    rankingListEl.innerHTML = '<li class="empty">The ranker hasn\'t ordered any wrestlers here yet.</li>';
    return;
  }
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
  `;
  voteWidgetEl.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.addEventListener("click", () => castVote(btn.dataset.value));
  });
}

async function castVote(value) {
  if (!auth.currentUser) {
    window.location.href = "sign-in.html?next=index.html";
    return;
  }
  const voteId = `${currentListId}_${auth.currentUser.uid}`;
  await setDoc(doc(db, "votes", voteId), {
    listId: currentListId,
    userId: auth.currentUser.uid,
    value,
    createdAt: serverTimestamp(),
  });
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
    await addDoc(collection(db, "comments"), {
      listId: currentListId,
      userId: auth.currentUser.uid,
      userName: auth.currentUser.displayName || auth.currentUser.email || "Fan",
      text,
      createdAt: serverTimestamp(),
    });
    commentText.value = "";
  } catch (err) {
    commentError.textContent = err.message || "Couldn't post comment. Please try again.";
  }
});

onAuthStateChanged(auth, (user) => {
  commentForm.style.display = user ? "" : "none";
  commentSignInPrompt.style.display = user ? "none" : "";
});
