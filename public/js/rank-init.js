import {escapeHtml, listId, formatDate} from "./util.js";

const {
  auth, db, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, onAuthStateChanged,
} = window.rankingApp;

const notRankerEl = document.getElementById("not-ranker");
const dashboardEl = document.getElementById("dashboard");

const weeksListEl = document.getElementById("weeks-list");
const newWeekForm = document.getElementById("new-week-form");
const weekError = document.getElementById("week-error");

const builderWeekSelect = document.getElementById("builder-week-select");
const builderWeightClass = document.getElementById("builder-weight-class");
const loadListBtn = document.getElementById("load-list-btn");
const builderPanel = document.getElementById("builder-panel");
const publishToggle = document.getElementById("publish-toggle");
const saveIndicator = document.getElementById("save-indicator");
const orderListEl = document.getElementById("order-list");
const availableListEl = document.getElementById("available-list");
const availableSearch = document.getElementById("available-search");

const rosterListEl = document.getElementById("roster-list");
const newWrestlerForm = document.getElementById("new-wrestler-form");
const wrestlerError = document.getElementById("wrestler-error");

const newRankerForm = document.getElementById("new-ranker-form");
const rankerError = document.getElementById("ranker-error");

let allWrestlers = new Map();
let currentListRef = null;
let currentOrder = [];
let draggedId = null;

// --- Access gate ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    notRankerEl.style.display = "";
    notRankerEl.textContent = "Sign in to access the Rank Dashboard.";
    dashboardEl.style.display = "none";
    return;
  }
  const snap = await getDoc(doc(db, "rankers", user.uid));
  if (!snap.exists()) {
    notRankerEl.style.display = "";
    dashboardEl.style.display = "none";
    return;
  }
  notRankerEl.style.display = "none";
  dashboardEl.style.display = "";
  initDashboard();
});

let dashboardInitialized = false;

function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  onSnapshot(collection(db, "wrestlers"), (snap) => {
    allWrestlers = new Map(snap.docs.map((d) => [d.id, d.data()]));
    renderRoster();
    if (builderPanel.style.display !== "none") {
      renderOrderList();
      renderAvailableList();
    }
  });

  onSnapshot(query(collection(db, "weeks"), orderBy("startDate", "desc")), (snap) => {
    const weeks = snap.docs.map((d) => ({id: d.id, ...d.data()}));
    weeksListEl.innerHTML = weeks.map((w) => `
      <li>${escapeHtml(w.label)} <span class="hint">${formatDate(w.startDate)}</span></li>
    `).join("") || '<li class="empty">No weeks yet.</li>';

    const selected = builderWeekSelect.value;
    builderWeekSelect.innerHTML = weeks.map((w) => `<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("");
    if (weeks.some((w) => w.id === selected)) builderWeekSelect.value = selected;
  });
}

// --- New week ---
newWeekForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  weekError.textContent = "";
  const label = document.getElementById("new-week-label").value.trim();
  const dateStr = document.getElementById("new-week-date").value;
  if (!label || !dateStr) return;
  try {
    await addDoc(collection(db, "weeks"), {
      label,
      startDate: new Date(`${dateStr}T00:00:00`),
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
    newWeekForm.reset();
  } catch (err) {
    weekError.textContent = err.message || "Couldn't add week.";
  }
});

// --- Ranking builder ---
loadListBtn.addEventListener("click", async () => {
  const weekId = builderWeekSelect.value;
  const weightClass = builderWeightClass.value.trim();
  if (!weekId || !weightClass) return;

  currentListRef = doc(db, "rankingLists", listId(weekId, weightClass));
  const snap = await getDoc(currentListRef);

  if (snap.exists()) {
    const data = snap.data();
    currentOrder = [...(data.order || [])];
    publishToggle.checked = !!data.published;
  } else {
    currentOrder = [];
    publishToggle.checked = false;
    await setDoc(currentListRef, {
      weekId,
      weightClass,
      order: [],
      published: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
  }

  builderPanel.style.display = "";
  saveIndicator.textContent = "";
  renderOrderList();
  renderAvailableList();
});

publishToggle.addEventListener("change", async () => {
  if (!currentListRef) return;
  await updateDoc(currentListRef, {
    published: publishToggle.checked,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  });
});

availableSearch.addEventListener("input", renderAvailableList);

async function persistOrder() {
  if (!currentListRef) return;
  saveIndicator.textContent = "Saving...";
  try {
    await updateDoc(currentListRef, {
      order: currentOrder,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
    saveIndicator.textContent = "Saved";
  } catch (err) {
    saveIndicator.textContent = err.message || "Couldn't save.";
  }
}

function renderOrderList() {
  orderListEl.innerHTML = currentOrder.map((id, i) => {
    const w = allWrestlers.get(id);
    if (!w) return "";
    return `
      <li draggable="true" data-id="${id}" class="drag-item">
        <span class="drag-rank">#${i + 1}</span>
        <span class="drag-name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)}</div></span>
        <button type="button" class="drag-remove" data-id="${id}" title="Remove from ranking">&times;</button>
      </li>`;
  }).join("") || '<li class="empty">Drag wrestlers here to rank them.</li>';

  attachDragHandlers(orderListEl);
  orderListEl.querySelectorAll(".drag-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentOrder = currentOrder.filter((id) => id !== btn.dataset.id);
      renderOrderList();
      renderAvailableList();
      persistOrder();
    });
  });
}

function renderAvailableList() {
  const search = availableSearch.value.trim().toLowerCase();
  const available = [...allWrestlers.entries()]
      .filter(([id]) => !currentOrder.includes(id))
      .filter(([, w]) => !search ||
        w.name.toLowerCase().includes(search) ||
        w.school.toLowerCase().includes(search))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));

  availableListEl.innerHTML = available.map(([id, w]) => `
    <li draggable="true" data-id="${id}" class="drag-item">
      <span class="drag-name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)} &middot; ${escapeHtml(w.weightClass)}</div></span>
      <button type="button" class="drag-add" data-id="${id}" title="Add to ranking">+</button>
    </li>`).join("") || '<li class="empty">No wrestlers match.</li>';

  attachDragHandlers(availableListEl);
  availableListEl.querySelectorAll(".drag-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentOrder.push(btn.dataset.id);
      renderOrderList();
      renderAvailableList();
      persistOrder();
    });
  });
}

function attachDragHandlers(container) {
  container.querySelectorAll("li[draggable='true']").forEach((li) => {
    li.addEventListener("dragstart", () => {
      draggedId = li.dataset.id;
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      draggedId = null;
    });
  });
}

function getDragAfterElement(container, y, excludeId) {
  const els = [...container.querySelectorAll("li[draggable='true']")]
      .filter((el) => el.dataset.id !== excludeId);
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return {offset, element: child};
    return closest;
  }, {offset: -Infinity, element: null}).element;
}

[orderListEl, availableListEl].forEach((container) => {
  container.addEventListener("dragover", (e) => e.preventDefault());
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!draggedId) return;

    if (container === orderListEl) {
      const afterEl = getDragAfterElement(orderListEl, e.clientY, draggedId);
      currentOrder = currentOrder.filter((id) => id !== draggedId);
      const insertIndex = afterEl ? currentOrder.indexOf(afterEl.dataset.id) : -1;
      currentOrder.splice(insertIndex === -1 ? currentOrder.length : insertIndex, 0, draggedId);
    } else {
      currentOrder = currentOrder.filter((id) => id !== draggedId);
    }

    renderOrderList();
    renderAvailableList();
    persistOrder();
  });
});

// --- Roster ---
function renderRoster() {
  const entries = [...allWrestlers.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  rosterListEl.innerHTML = entries.map(([id, w]) => `
    <li>
      ${escapeHtml(w.name)} <span class="hint">${escapeHtml(w.school)} &middot; ${escapeHtml(w.weightClass)}</span>
      <button type="button" class="link-btn" data-id="${id}">Remove</button>
    </li>`).join("") || '<li class="empty">No wrestlers yet.</li>';

  rosterListEl.querySelectorAll(".link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this wrestler from the roster? This does not remove them from past ranking lists.")) return;
      await deleteDoc(doc(db, "wrestlers", btn.dataset.id));
    });
  });
}

newWrestlerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  wrestlerError.textContent = "";
  const name = document.getElementById("new-wrestler-name").value.trim();
  const school = document.getElementById("new-wrestler-school").value.trim();
  const weightClass = document.getElementById("new-wrestler-weight").value.trim();
  if (!name || !school || !weightClass) return;
  try {
    await addDoc(collection(db, "wrestlers"), {
      name,
      school,
      weightClass,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
    newWrestlerForm.reset();
  } catch (err) {
    wrestlerError.textContent = err.message || "Couldn't add wrestler.";
  }
});

// --- Rankers ---
newRankerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  rankerError.textContent = "";
  const uid = document.getElementById("new-ranker-uid").value.trim();
  if (!uid) return;
  try {
    await setDoc(doc(db, "rankers", uid), {
      addedBy: auth.currentUser.uid,
      addedAt: serverTimestamp(),
    });
    newRankerForm.reset();
  } catch (err) {
    rankerError.textContent = err.message || "Couldn't add ranker.";
  }
});
