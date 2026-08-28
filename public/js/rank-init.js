import {escapeHtml, listId, formatDate, slugify, WEIGHT_CLASSES,
  WRESTLER_OPTIONAL_FIELDS, wrestlerSubline}
  from "./util.js";

const {
  auth, db, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc,
  getDocs, onSnapshot, query, where, orderBy, serverTimestamp, deleteField,
  onAuthStateChanged,
} = window.rankingApp;

const notRankerEl = document.getElementById("not-ranker");
const dashboardEl = document.getElementById("dashboard");

const weeksListEl = document.getElementById("weeks-list");
const newWeekForm = document.getElementById("new-week-form");
const weekError = document.getElementById("week-error");

const builderWeekSelect = document.getElementById("builder-week-select");
const builderWeightTabs = document.getElementById("builder-weight-tabs");
const availableHeading = document.getElementById("available-heading");
const dashboardGuide = document.getElementById("dashboard-guide");
const builderPanel = document.getElementById("builder-panel");
const saveIndicator = document.getElementById("save-indicator");
const weekActionsEl = document.getElementById("week-actions");
const weekProgressEl = document.getElementById("week-progress");
const removeWeekBtn = document.getElementById("remove-week-btn");
const weightDatalist = document.getElementById("weight-class-options");
const orderListEl = document.getElementById("order-list");
const availableListEl = document.getElementById("available-list");
const availableSearch = document.getElementById("available-search");
const toggleAllWeightsBtn = document.getElementById("toggle-all-weights");

const submitRankingBtn = document.getElementById("submit-ranking-btn");
const fullViewRemoveAll = document.getElementById("fullview-remove-all");
const fullViewBtn = document.getElementById("full-view-btn");
const fullViewOverlay = document.getElementById("full-view-overlay");
const fullViewContent = document.getElementById("fullview-content");
const fullViewTitle = document.getElementById("fullview-title");
const fullViewClose = document.getElementById("fullview-close");
const fullViewPublishAll = document.getElementById("fullview-publish-all");
const fullViewStatus = document.getElementById("fullview-status");

const rosterListEl = document.getElementById("roster-list");
const newWrestlerForm = document.getElementById("new-wrestler-form");
const wrestlerError = document.getElementById("wrestler-error");
const importCsvBtn = document.getElementById("import-csv-btn");
const importCsvInput = document.getElementById("import-csv-input");
const downloadTemplateBtn = document.getElementById("download-template-btn");
const exportCsvBtn = document.getElementById("export-csv-btn");
const csvStatusEl = document.getElementById("csv-status");

// Double-click-to-edit modal, shared by every list that shows a wrestler.
const editOverlay = document.getElementById("wrestler-edit-overlay");
const editForm = document.getElementById("wrestler-edit-form");
const editName = document.getElementById("we-name");
const editSchool = document.getElementById("we-school");
const editWeight = document.getElementById("we-weight");
const editOptionalWrap = document.getElementById("we-optional-fields");
const editError = document.getElementById("wrestler-edit-error");
const editStatus = document.getElementById("wrestler-edit-status");
const editCloseBtn = document.getElementById("wrestler-edit-close");
const editDeleteBtn = document.getElementById("wrestler-edit-delete");

const newRankerForm = document.getElementById("new-ranker-form");
const rankerError = document.getElementById("ranker-error");

let allWrestlers = new Map();
let weeks = []; // all weeks, sorted by startDate DESC (newest first)
let selectedWeekId = null;
let selectedWeightClass = null;
let showAllWeights = false;
let currentListRef = null;
let currentOrder = [];
let draggedId = null;
let creatingAtSlot = null; // slot index whose inline "create wrestler" form is open
let editingWrestlerId = null; // roster row currently being edited inline
let wrestlersLoaded = false; // becomes true after the first wrestlers snapshot
// Live publish status of the selected week's lists: weightClass -> {published, count}.
let weekStatus = new Map();
let subscribedWeekId = null;
let weekStatusUnsub = null;
// Ids we just created via addDoc whose wrestlers snapshot hasn't arrived yet.
// These must NOT be pruned as "unknown" (Bug A/C): they're real, just pending.
const pendingCreateIds = new Set();

// Normalize a raw weight-class string so the stored value stays consistent with
// its slug (Bug D): trim ends and collapse internal whitespace so "132" and
// "132 " can't slugify to the same rankingLists doc id while differing raw.
function normalizeWeightClass(raw) {
  return String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
}

// Read the optional roster fields (grade/record/hometown/notes) from a raw
// {key: value} map, trimmed and clamped to each field's max length. Returns
// only the fields that are actually set — omitted fields stay off the doc.
function collectOptionalFields(raw) {
  const out = {};
  for (const f of WRESTLER_OPTIONAL_FIELDS) {
    const v = String(raw[f.key] == null ? "" : raw[f.key]).trim().slice(0, f.max);
    if (v) out[f.key] = v;
  }
  return out;
}

// Build the update payload for a wrestler edit: set the fields that have a
// value, and delete the ones that were cleared so blanks don't linger on the
// doc. `base` is the always-present name/school/weightClass.
function optionalFieldUpdates(raw, existing) {
  const patch = {};
  for (const f of WRESTLER_OPTIONAL_FIELDS) {
    const v = String(raw[f.key] == null ? "" : raw[f.key]).trim().slice(0, f.max);
    if (v) {
      patch[f.key] = v;
    } else if (existing && existing[f.key] != null) {
      patch[f.key] = deleteField();
    }
  }
  return patch;
}

// The admin roster meta line: school · weight · any set optional field.
function rosterMeta(w) {
  const parts = [w.school, w.weightClass]
      .concat(WRESTLER_OPTIONAL_FIELDS.map((f) => w[f.key]))
      .map((s) => String(s == null ? "" : s).trim())
      .filter(Boolean);
  return parts.join(" · ");
}

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
  if (dashboardGuide) dashboardGuide.style.display = "";
  initDashboard();
});

let dashboardInitialized = false;

function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  // Weight-class suggestions on the roster form come from the canonical 14.
  if (weightDatalist) {
    weightDatalist.innerHTML = WEIGHT_CLASSES
        .map((wc) => `<option value="${escapeHtml(wc)}"></option>`).join("");
  }

  onSnapshot(collection(db, "wrestlers"), (snap) => {
    allWrestlers = new Map(snap.docs.map((d) => [d.id, d.data()]));
    wrestlersLoaded = true;
    // A pending just-created id is confirmed once it shows up in the snapshot.
    for (const id of [...pendingCreateIds]) {
      if (allWrestlers.has(id)) pendingCreateIds.delete(id);
    }
    renderRoster();
    renderWeightTabs();
    if (builderPanel.style.display !== "none") {
      // Bug C: don't rebuild the order list (which would wipe an open inline
      // "+ Add wrestler" form mid-typing) on an unrelated roster change. The
      // form's own submit/cancel re-renders the list once it closes.
      if (creatingAtSlot === null) renderOrderList();
      renderAvailableList();
    }
  });

  onSnapshot(query(collection(db, "weeks"), orderBy("startDate", "desc")), (snap) => {
    weeks = snap.docs.map((d) => ({id: d.id, ...d.data()}));
    if (weeksListEl) {
      weeksListEl.innerHTML = weeks.map((w) => `
        <li>${escapeHtml(w.label)} <span class="hint">${formatDate(w.startDate)}</span></li>
      `).join("") || '<li class="empty">No weeks yet.</li>';
    }

    builderWeekSelect.innerHTML = weeks.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.label)}</option>`).join("");
    // Keep a valid selected week (default to the newest).
    if (!selectedWeekId || !weeks.some((w) => w.id === selectedWeekId)) {
      selectedWeekId = weeks.length ? weeks[0].id : null;
    }
    if (selectedWeekId) builderWeekSelect.value = selectedWeekId;
    if (weekActionsEl) weekActionsEl.style.display = selectedWeekId ? "" : "none";
    subscribeWeekStatus(selectedWeekId);
  });
}

// Live-track which of the week's 14 classes are published (drives the tab
// badges and the "X of 14 submitted" readout). Re-subscribes only when the
// selected week actually changes.
function subscribeWeekStatus(weekId) {
  if (weekId === subscribedWeekId) return;
  subscribedWeekId = weekId;
  if (weekStatusUnsub) {
    weekStatusUnsub();
    weekStatusUnsub = null;
  }
  weekStatus = new Map();
  renderWeightTabs();
  updateWeekProgress();
  if (!weekId) return;
  weekStatusUnsub = onSnapshot(
      query(collection(db, "rankingLists"), where("weekId", "==", weekId)),
      (snap) => {
        weekStatus = new Map();
        snap.docs.forEach((d) => {
          const data = d.data();
          weekStatus.set(data.weightClass, {
            published: data.published === true,
            count: Array.isArray(data.order) ? data.order.length : 0,
          });
        });
        renderWeightTabs();
        updateWeekProgress();
      },
  );
}

// "X of 14 submitted" — a class counts as submitted once it's published.
function updateWeekProgress() {
  if (!weekProgressEl) return;
  if (!selectedWeekId) {
    weekProgressEl.textContent = "";
    return;
  }
  const total = WEIGHT_CLASSES.length;
  const submitted = WEIGHT_CLASSES
      .filter((wc) => weekStatus.get(wc) && weekStatus.get(wc).published).length;
  // Classes with a saved order but no wrestlers in it yet — Submit will still
  // push them live, so flag them as a heads-up.
  const emptyDrafts = WEIGHT_CLASSES
      .filter((wc) => weekStatus.get(wc) && weekStatus.get(wc).count === 0).length;
  const suffix = emptyDrafts > 0 ? ` · ${emptyDrafts} empty` : "";
  weekProgressEl.textContent = `${submitted} of ${total} submitted${suffix}`;
  weekProgressEl.classList.toggle("complete", submitted === total);
}

// The weight-class tabs are the canonical 14 — every week has the same classes.
// Each tab shows a status dot: published (submitted), draft (started, not
// submitted), or empty (no list yet). Clicking one loads that week+class.
function renderWeightTabs() {
  builderWeightTabs.innerHTML = WEIGHT_CLASSES.map((wc) => {
    const st = weekStatus.get(wc);
    const statusClass = st && st.published ? "published" : (st ? "draft" : "empty");
    const label = st && st.published ? "Submitted" :
      (st ? "Draft — not submitted" : "Not started");
    const dot = `<span class="tab-status ${statusClass}" title="${label}" aria-hidden="true"></span>`;
    return `<button type="button" class="weight-tab${wc === selectedWeightClass ? " active" : ""}" data-wc="${escapeHtml(wc)}">${escapeHtml(wc)}${dot}</button>`;
  }).join("");

  builderWeightTabs.querySelectorAll(".weight-tab").forEach((btn) => {
    btn.addEventListener("click", () => selectWeightClass(btn.dataset.wc));
  });
}

// Week changed: refresh the week's publish status and, if a weight class is
// already chosen, reload its list for the new week.
builderWeekSelect.addEventListener("change", () => {
  selectedWeekId = builderWeekSelect.value;
  if (weekActionsEl) weekActionsEl.style.display = selectedWeekId ? "" : "none";
  subscribeWeekStatus(selectedWeekId);
  if (selectedWeightClass) loadOrCreateList(selectedWeekId, selectedWeightClass);
});

async function selectWeightClass(weightClass) {
  selectedWeightClass = weightClass;
  // Each class starts scoped to itself.
  showAllWeights = false;
  updateToggleAllWeightsLabel();
  selectedWeekId = builderWeekSelect.value ||
    (weeks.length ? weeks[0].id : null);
  renderWeightTabs(); // refresh active highlight
  if (!selectedWeekId) return;
  await loadOrCreateList(selectedWeekId, weightClass);
}

// Loads the ranking for (week, weightClass). If none exists yet for this week,
// it seeds a new one with LAST week's published order for the same class, so
// the ranker starts from last week and only edits what changed (optional).
async function loadOrCreateList(weekId, weightClass) {
  // Switching week/class: drop any stale inline-create form and reset the
  // "show all weights" view so nothing leaks into the newly loaded list.
  creatingAtSlot = null;
  showAllWeights = false;
  updateToggleAllWeightsLabel();
  currentListRef = doc(db, "rankingLists", listId(weekId, weightClass));
  const snap = await getDoc(currentListRef);

  let carried = false;
  if (snap.exists()) {
    const data = snap.data();
    currentOrder = [...(data.order || [])];
  } else {
    currentOrder = await previousWeekOrder(weekId, weightClass);
    carried = currentOrder.length > 0;
    await setDoc(currentListRef, {
      weekId,
      weightClass,
      order: currentOrder,
      published: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
  }

  if (availableHeading) {
    availableHeading.textContent = `Available ${weightClass} wrestlers`;
  }
  builderPanel.style.display = "";
  saveIndicator.textContent = carried ?
    "Loaded last week's order — edit as needed" : "";
  renderOrderList();
  renderAvailableList();
}

// The previous week's saved order for this weight class, filtered to wrestlers
// still on the roster and still in this class. Empty if there's no prior week.
async function previousWeekOrder(weekId, weightClass) {
  const idx = weeks.findIndex((w) => w.id === weekId);
  if (idx === -1) return [];
  const prev = weeks[idx + 1]; // weeks are DESC, so the next index is older
  if (!prev) return [];
  const prevSnap = await getDoc(
      doc(db, "rankingLists", listId(prev.id, weightClass)),
  );
  if (!prevSnap.exists()) return [];
  return (prevSnap.data().order || []).filter((id) => {
    const w = allWrestlers.get(id);
    return w && w.weightClass === weightClass;
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

// --- Submit / Remove: publish or unpublish ALL 14 classes for the week ---
// Submit pushes every one of the 14 (creating any that don't exist yet as empty
// lists) so the whole week goes live in one action. Remove takes them all back
// down. This is the only publish path — there's no per-class publish switch.
async function setWholeWeekPublished(publish) {
  if (!selectedWeekId) return;
  const uid = auth.currentUser.uid;
  saveIndicator.textContent = publish ?
    "Submitting all 14…" : "Removing from public…";
  [submitRankingBtn, removeWeekBtn].forEach((b) => {
    if (b) b.disabled = true;
  });
  try {
    for (const wc of WEIGHT_CLASSES) {
      const ref = doc(db, "rankingLists", listId(selectedWeekId, wc));
      try {
        await updateDoc(ref, {
          published: publish,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
      } catch (e) {
        // updateDoc throws if the doc doesn't exist yet. When submitting, create
        // it as an empty published list so all 14 truly go live "no matter what";
        // when removing, a missing doc is already not-public, so skip it.
        if (publish) {
          await setDoc(ref, {
            weekId: selectedWeekId,
            weightClass: wc,
            order: [],
            published: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: uid,
          });
        }
      }
    }
    saveIndicator.textContent = publish ?
      "Submitted all 14 — live on the site" : "Removed from public view";
  } catch (err) {
    saveIndicator.textContent = err.message || "Couldn't update the week.";
  } finally {
    [submitRankingBtn, removeWeekBtn].forEach((b) => {
      if (b) b.disabled = false;
    });
  }
}

if (submitRankingBtn) {
  submitRankingBtn.addEventListener("click", () => setWholeWeekPublished(true));
}
if (removeWeekBtn) {
  removeWeekBtn.addEventListener("click", () => {
    if (confirm("Remove this week's rankings from public view?")) {
      setWholeWeekPublished(false);
    }
  });
}

// --- Full View: review every weight class's ranking for the week at once,
// full-page, then publish them all in one click. ---
if (fullViewBtn) fullViewBtn.addEventListener("click", openFullView);
if (fullViewClose) fullViewClose.addEventListener("click", closeFullView);
if (fullViewOverlay) {
  fullViewOverlay.addEventListener("click", (e) => {
    if (e.target === fullViewOverlay) closeFullView();
  });
}
if (fullViewPublishAll) {
  fullViewPublishAll.addEventListener("click", async () => {
    fullViewPublishAll.disabled = true;
    fullViewStatus.textContent = "Submitting all 14…";
    await setWholeWeekPublished(true);
    await renderFullView();
    fullViewPublishAll.disabled = false;
  });
}
if (fullViewRemoveAll) {
  fullViewRemoveAll.addEventListener("click", async () => {
    if (!confirm("Remove this week's rankings from public view?")) return;
    fullViewRemoveAll.disabled = true;
    fullViewStatus.textContent = "Removing from public…";
    await setWholeWeekPublished(false);
    await renderFullView();
    fullViewRemoveAll.disabled = false;
  });
}

function closeFullView() {
  fullViewOverlay.style.display = "none";
}

// All ranking lists for a week, sorted by weight class ascending.
async function fetchWeekLists(weekId) {
  const qs = await getDocs(query(
      collection(db, "rankingLists"), where("weekId", "==", weekId),
  ));
  const lists = qs.docs.map((d) => ({id: d.id, ...d.data()}));
  lists.sort((a, b) => {
    const na = parseFloat(a.weightClass);
    const nb = parseFloat(b.weightClass);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a.weightClass).localeCompare(String(b.weightClass));
  });
  return lists;
}

async function openFullView() {
  if (!selectedWeekId) return;
  const wk = weeks.find((w) => w.id === selectedWeekId);
  fullViewTitle.textContent = wk ? `All Rankings — ${wk.label}` : "All Rankings";
  fullViewStatus.textContent = "";
  fullViewContent.innerHTML = '<p class="hint">Loading…</p>';
  fullViewOverlay.style.display = "";
  await renderFullView();
}

async function renderFullView() {
  const lists = await fetchWeekLists(selectedWeekId);
  if (lists.length === 0) {
    fullViewContent.innerHTML =
      '<p class="empty">No rankings built for this week yet.</p>';
    fullViewStatus.textContent = "";
    return;
  }
  fullViewContent.innerHTML = lists.map((l) => {
    // Number only wrestlers still on the roster so ranks stay contiguous even
    // if an id was removed (Bug A): drop unknowns first, then enumerate.
    const known = (l.order || [])
        .map((id) => ({id, w: allWrestlers.get(id)}))
        .filter((row) => row.w);
    const rows = known.map(({id, w}, i) => `
        <li class="player-row" data-id="${escapeHtml(id)}" title="Double-click to edit">
          <span class="rank">#${i + 1}</span>
          <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
        </li>`).join("") || '<li class="empty">No wrestlers ranked.</li>';
    const badge = l.published ?
      '<span class="fv-badge fv-live">Published</span>' :
      '<span class="fv-badge fv-draft">Draft</span>';
    return `
      <div class="fv-list">
        <div class="fv-list-header">
          <h3>${escapeHtml(l.weightClass)}</h3>
          ${badge}
        </div>
        <ol class="ranking-list">${rows}</ol>
      </div>`;
  }).join("");

  const drafts = lists.filter((l) => !l.published).length;
  fullViewStatus.textContent = drafts === 0 ?
    "All weight classes published." :
    `${drafts} of ${lists.length} still in draft.`;
}

availableSearch.addEventListener("input", renderAvailableList);

// Reflect showAllWeights state in the toggle button's label.
function updateToggleAllWeightsLabel() {
  if (!toggleAllWeightsBtn) return;
  toggleAllWeightsBtn.textContent = showAllWeights ?
    `Show only ${selectedWeightClass}` : "Show all weight classes";
}

if (toggleAllWeightsBtn) {
  toggleAllWeightsBtn.addEventListener("click", () => {
    showAllWeights = !showAllWeights;
    updateToggleAllWeightsLabel();
    renderAvailableList();
  });
}

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
  // Bug A: drop ids for wrestlers that are truly gone — unknown to the roster
  // AND not a just-created id awaiting its snapshot. Leaving phantom ids in
  // would let persistOrder re-save them (permanent corruption) and would skew
  // rank numbers and the slot count. We only prune once the roster is known,
  // so a not-yet-loaded snapshot can't wipe a real order.
  if (wrestlersLoaded) {
    const cleaned = currentOrder.filter((id) =>
      allWrestlers.has(id) || pendingCreateIds.has(id));
    if (cleaned.length !== currentOrder.length) {
      currentOrder = cleaned;
      persistOrder();
    }
  }

  // Number only real, displayed wrestlers so ranks stay contiguous (Bug A). A
  // pending just-created id that isn't in the snapshot yet is kept in
  // currentOrder but simply not shown until it arrives.
  const displayed = currentOrder
      .map((id) => ({id, w: allWrestlers.get(id)}))
      .filter((row) => row.w);
  const filled = displayed.length;

  // Always show at least six slots (#1–#6). Filled rows are numbered
  // contiguously; the FIRST empty slot (index === filled) is the only one that
  // offers "+ Add wrestler", so where you click is where an append lands
  // (Bug B). Any further slots are plain placeholders.
  const slotCount = Math.max(6, filled);
  let html = "";
  for (let i = 0; i < slotCount; i++) {
    if (i < filled) {
      const {id, w} = displayed[i];
      const isFirst = i === 0;
      const isLast = i === filled - 1;
      html += `
      <li draggable="true" data-id="${escapeHtml(id)}" class="drag-item">
        <span class="drag-rank">#${i + 1}</span>
        <span class="drag-name">${escapeHtml(w.name)}<div class="category">${escapeHtml(wrestlerSubline(w))}</div></span>
        <span class="move-btns">
          <button type="button" class="move-btn" data-id="${escapeHtml(id)}" data-dir="up" title="Move up"${isFirst ? " disabled" : ""}>&#9650;</button>
          <button type="button" class="move-btn" data-id="${escapeHtml(id)}" data-dir="down" title="Move down"${isLast ? " disabled" : ""}>&#9660;</button>
        </span>
        <button type="button" class="drag-remove" data-id="${escapeHtml(id)}" title="Remove from ranking">&times;</button>
      </li>`;
    } else if (i === filled && creatingAtSlot === filled) {
      // Inline create form on the first empty slot. Inputs are plain DOM nodes
      // read at submit time — no user text is ever interpolated into HTML here.
      html += `
      <li class="drag-item empty-slot creating">
        <span class="drag-rank">#${i + 1}</span>
        <form class="slot-create-form">
          <input type="text" class="slot-name" placeholder="Wrestler name" autocomplete="off">
          <input type="text" class="slot-school" placeholder="School" autocomplete="off">
          <button type="submit" class="btn btn-primary btn-sm">Create</button>
          <button type="button" class="btn-cancel link-btn">Cancel</button>
        </form>
      </li>`;
    } else if (i === filled) {
      html += `
      <li class="drag-item empty-slot">
        <span class="drag-rank">#${i + 1}</span>
        <button type="button" class="slot-add" data-slot="${i}">+ Add wrestler</button>
      </li>`;
    } else {
      html += `
      <li class="drag-item empty-slot">
        <span class="drag-rank">#${i + 1}</span>
      </li>`;
    }
  }
  orderListEl.innerHTML = html;

  attachDragHandlers(orderListEl);
  orderListEl.querySelectorAll(".drag-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentOrder = currentOrder.filter((id) => id !== btn.dataset.id);
      renderOrderList();
      renderAvailableList();
      persistOrder();
    });
  });

  // Touch-friendly reordering (drag-and-drop doesn't work on phones).
  orderListEl.querySelectorAll(".move-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = currentOrder.indexOf(btn.dataset.id);
      if (idx === -1) return;
      const swap = btn.dataset.dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= currentOrder.length) return;
      [currentOrder[idx], currentOrder[swap]] =
        [currentOrder[swap], currentOrder[idx]];
      renderOrderList();
      persistOrder();
    });
  });

  // Open the inline create form on an empty slot.
  orderListEl.querySelectorAll(".slot-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      creatingAtSlot = Number(btn.dataset.slot);
      renderOrderList();
      const nameInput = orderListEl.querySelector(".slot-create-form .slot-name");
      if (nameInput) nameInput.focus();
    });
  });

  // Wire up the single open create form (if any).
  const createForm = orderListEl.querySelector(".slot-create-form");
  if (createForm) {
    createForm.querySelector(".btn-cancel").addEventListener("click", () => {
      creatingAtSlot = null;
      renderOrderList();
    });
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      // Guard: no class picked → nothing to create against.
      const weightClass = normalizeWeightClass(selectedWeightClass);
      if (!weightClass || !slugify(weightClass)) return;
      const name = createForm.querySelector(".slot-name").value.trim();
      const school = createForm.querySelector(".slot-school").value.trim();
      if (!name || !school) return;
      saveIndicator.textContent = "Saving...";
      try {
        const ref = await addDoc(collection(db, "wrestlers"), {
          name,
          school,
          weightClass,
          createdBy: auth.currentUser.uid,
          createdAt: serverTimestamp(),
        });
        // Mark pending so the id survives an interleaving snapshot rebuild
        // until its own snapshot confirms it (Bug A/C), and seed the roster
        // map optimistically so it shows immediately. Ranked lists are
        // contiguous: append fills the first open slot.
        pendingCreateIds.add(ref.id);
        allWrestlers.set(ref.id, {
          name, school, weightClass, createdBy: auth.currentUser.uid,
        });
        currentOrder.push(ref.id);
        creatingAtSlot = null;
        await persistOrder();
        renderOrderList();
        renderAvailableList();
      } catch (err) {
        saveIndicator.textContent = err.message || "Couldn't create wrestler.";
      }
    });
  }
}

function renderAvailableList() {
  const search = availableSearch.value.trim().toLowerCase();
  const available = [...allWrestlers.entries()]
      .filter(([id]) => !currentOrder.includes(id))
      // Restrict to the selected weight class unless "show all" is on.
      .filter(([, w]) => showAllWeights || !selectedWeightClass ||
        w.weightClass === selectedWeightClass)
      .filter(([, w]) => !search ||
        (w.name || "").toLowerCase().includes(search) ||
        (w.school || "").toLowerCase().includes(search))
      .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));

  availableListEl.innerHTML = available.map(([id, w]) => {
    const category = showAllWeights ?
      `${escapeHtml(w.school)} · ${escapeHtml(w.weightClass)}` :
      escapeHtml(w.school);
    return `
    <li draggable="true" data-id="${escapeHtml(id)}" class="drag-item">
      <span class="drag-name">${escapeHtml(w.name)}<div class="category">${category}</div></span>
      <button type="button" class="drag-add" data-id="${escapeHtml(id)}" title="Add to ranking">+</button>
    </li>`;
  }).join("") || '<li class="empty">No wrestlers match.</li>';

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
  const entries = [...allWrestlers.entries()]
      .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));
  rosterListEl.innerHTML = entries.map(([id, w]) => {
    if (id === editingWrestlerId) {
      // Inline edit row. Inputs are DOM nodes read at save time; values are
      // escaped into the value="" attribute.
      const optInputs = WRESTLER_OPTIONAL_FIELDS.map((f) => `
        <input type="text" class="edit-opt" data-key="${escapeHtml(f.key)}" maxlength="${f.max}" placeholder="${escapeHtml(f.placeholder)}" value="${escapeHtml(w[f.key] || "")}">`).join("");
      return `
      <li class="roster-editing" data-id="${escapeHtml(id)}">
        <input type="text" class="edit-name" maxlength="100" placeholder="Name" value="${escapeHtml(w.name || "")}">
        <input type="text" class="edit-school" maxlength="100" placeholder="School" value="${escapeHtml(w.school || "")}">
        <input type="text" class="edit-weight" maxlength="20" list="weight-class-options" placeholder="Weight" value="${escapeHtml(w.weightClass || "")}">
        ${optInputs}
        <button type="button" class="btn btn-primary btn-sm" data-save="${escapeHtml(id)}">Save</button>
        <button type="button" class="link-btn" data-cancel-edit>Cancel</button>
      </li>`;
    }
    return `
    <li data-id="${escapeHtml(id)}" title="Double-click to edit">
      ${escapeHtml(w.name || "")} <span class="hint">${escapeHtml(rosterMeta(w))}</span>
      <button type="button" class="link-btn" data-edit="${escapeHtml(id)}">Edit</button>
      <button type="button" class="link-btn" data-remove="${escapeHtml(id)}">Remove</button>
    </li>`;
  }).join("") || '<li class="empty">No wrestlers yet.</li>';

  rosterListEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingWrestlerId = btn.dataset.edit;
      renderRoster();
    });
  });
  rosterListEl.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingWrestlerId = null;
      renderRoster();
    });
  });
  rosterListEl.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const li = btn.closest("li");
      const name = li.querySelector(".edit-name").value.trim();
      const school = li.querySelector(".edit-school").value.trim();
      const weightClass = normalizeWeightClass(li.querySelector(".edit-weight").value);
      if (!name || !school || !weightClass || !slugify(weightClass)) {
        showWrestlerNote("Name, school, and a valid weight class are required.");
        return;
      }
      // Read the optional fields off their data-key inputs.
      const raw = {};
      li.querySelectorAll(".edit-opt").forEach((inp) => {
        raw[inp.dataset.key] = inp.value;
      });
      try {
        // Rules allow updating name/school/weightClass plus the optional
        // fields; cleared optional fields are removed via deleteField().
        await updateDoc(doc(db, "wrestlers", btn.dataset.save), {
          name, school, weightClass,
          ...optionalFieldUpdates(raw, allWrestlers.get(btn.dataset.save)),
        });
        editingWrestlerId = null;
        renderRoster();
      } catch (err) {
        showWrestlerNote(err.message || "Couldn't save changes.");
      }
    });
  });
  rosterListEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this wrestler from the roster? This does not remove them from past ranking lists.")) return;
      await deleteDoc(doc(db, "wrestlers", btn.dataset.remove));
    });
  });
}

// --- Roster CSV import / export ---
// Quote a value for CSV if it contains a comma, quote, or newline.
function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

function downloadCsv(text, filename) {
  const blob = new Blob([text], {type: "text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// CSV columns: the three required fields plus every optional field, in a fixed
// order so export/template/import all agree.
const CSV_COLUMNS = ["name", "school", "weightClass",
  ...WRESTLER_OPTIONAL_FIELDS.map((f) => f.key)];

function exportRosterCsv() {
  const rows = [CSV_COLUMNS.slice()];
  [...allWrestlers.values()]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach((w) => rows.push(CSV_COLUMNS.map((c) => w[c] || "")));
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  downloadCsv(csv, "roster.csv");
}

function downloadTemplate() {
  // A header row plus one example row so the expected format is unambiguous.
  const example = {
    name: "John Doe", school: "Bozeman", weightClass: "132",
    grade: "Jr", record: "24-3", hometown: "Bozeman, MT",
    notes: "Defending champ",
  };
  const rows = [CSV_COLUMNS.slice(), CSV_COLUMNS.map((c) => example[c] || "")];
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  downloadCsv(csv, "wrestlers-template.csv");
}

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes,
// commas inside quotes, and CRLF/LF line endings. Returns array of row arrays.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === "\"") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function importCsv(file) {
  csvStatusEl.textContent = "Reading…";
  let rows;
  try {
    rows = parseCsv(await file.text())
        .filter((r) => r.some((c) => c.trim() !== ""));
  } catch (e) {
    csvStatusEl.textContent = "Couldn't read that file.";
    return;
  }
  if (rows.length === 0) {
    csvStatusEl.textContent = "That file was empty.";
    return;
  }

  // Detect a header row and map columns; otherwise assume name,school,weight.
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = header.includes("name") ||
    header.some((h) => h.startsWith("weight"));
  let iName = 0;
  let iSchool = 1;
  let iWeight = 2;
  let start = 0;
  // Column index for each optional field, or -1 when the header lacks it.
  const optIdx = {};
  WRESTLER_OPTIONAL_FIELDS.forEach((f) => {
    optIdx[f.key] = -1;
  });
  if (hasHeader) {
    start = 1;
    const find = (pred, fallback) => {
      const idx = header.findIndex(pred);
      return idx >= 0 ? idx : fallback;
    };
    iName = find((h) => h === "name", 0);
    iSchool = find((h) => h === "school", 1);
    iWeight = find((h) => h.startsWith("weight"), 2);
    WRESTLER_OPTIONAL_FIELDS.forEach((f) => {
      optIdx[f.key] = header.indexOf(f.key);
    });
  }

  const uid = auth.currentUser.uid;
  let added = 0;
  let skipped = 0;
  csvStatusEl.textContent = "Importing…";
  for (let r = start; r < rows.length; r++) {
    const cols = rows[r];
    const name = (cols[iName] || "").trim();
    const school = (cols[iSchool] || "").trim();
    const weightClass = normalizeWeightClass(cols[iWeight] || "");
    // Enforce the same limits the rules require, so a bad row is skipped rather
    // than rejected mid-batch.
    if (!name || name.length > 100 || !school || school.length > 100 ||
        !weightClass || weightClass.length > 20 || !slugify(weightClass)) {
      skipped++;
      continue;
    }
    // Pull whatever optional columns the header exposed, trimmed/clamped.
    const rawOpt = {};
    WRESTLER_OPTIONAL_FIELDS.forEach((f) => {
      if (optIdx[f.key] >= 0) rawOpt[f.key] = cols[optIdx[f.key]] || "";
    });
    try {
      await addDoc(collection(db, "wrestlers"), {
        name, school, weightClass,
        ...collectOptionalFields(rawOpt),
        createdBy: uid,
        createdAt: serverTimestamp(),
      });
      added++;
    } catch (e) {
      skipped++;
    }
  }
  csvStatusEl.textContent =
    `Imported ${added} wrestler${added === 1 ? "" : "s"}` +
    (skipped ? `, skipped ${skipped} bad row${skipped === 1 ? "" : "s"}.` : ".");
}

if (importCsvBtn && importCsvInput) {
  importCsvBtn.addEventListener("click", () => importCsvInput.click());
  importCsvInput.addEventListener("change", async () => {
    const file = importCsvInput.files[0];
    if (file) await importCsv(file);
    importCsvInput.value = ""; // let the same file be re-selected later
  });
}
if (downloadTemplateBtn) {
  downloadTemplateBtn.addEventListener("click", downloadTemplate);
}
if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportRosterCsv);

// --- Double-click-to-edit modal ---------------------------------------------
// One editor for every wrestler shown anywhere on the dashboard. Double-clicking
// a wrestler row — roster, ranked order, available list, or full view — opens it.
let editingModalId = null;

// Build the optional-field inputs once, driven by WRESTLER_OPTIONAL_FIELDS, so
// adding a new field surfaces here automatically.
if (editOptionalWrap) {
  editOptionalWrap.innerHTML = WRESTLER_OPTIONAL_FIELDS.map((f) => `
    <label class="field">
      <span>${escapeHtml(f.label)}</span>
      <input type="text" class="we-opt" data-key="${escapeHtml(f.key)}" maxlength="${f.max}" placeholder="${escapeHtml(f.placeholder)}">
    </label>`).join("");
}

function openWrestlerEditor(id) {
  const w = allWrestlers.get(id);
  if (!w) return;
  editingModalId = id;
  editError.textContent = "";
  editStatus.textContent = "";
  editName.value = w.name || "";
  editSchool.value = w.school || "";
  editWeight.value = w.weightClass || "";
  editOptionalWrap.querySelectorAll(".we-opt").forEach((inp) => {
    inp.value = w[inp.dataset.key] || "";
  });
  editOverlay.style.display = "";
  editName.focus();
}

function closeWrestlerEditor() {
  editingModalId = null;
  editOverlay.style.display = "none";
}

if (editCloseBtn) editCloseBtn.addEventListener("click", closeWrestlerEditor);
if (editOverlay) {
  editOverlay.addEventListener("click", (e) => {
    if (e.target === editOverlay) closeWrestlerEditor();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && editOverlay && editOverlay.style.display !== "none") {
    closeWrestlerEditor();
  }
});

if (editForm) {
  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editingModalId) return;
    const name = editName.value.trim();
    const school = editSchool.value.trim();
    const weightClass = normalizeWeightClass(editWeight.value);
    if (!name || !school || !weightClass || !slugify(weightClass)) {
      editError.textContent =
        "Name, school, and a valid weight class are required.";
      return;
    }
    const raw = {};
    editOptionalWrap.querySelectorAll(".we-opt").forEach((inp) => {
      raw[inp.dataset.key] = inp.value;
    });
    editError.textContent = "";
    editStatus.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "wrestlers", editingModalId), {
        name, school, weightClass,
        ...optionalFieldUpdates(raw, allWrestlers.get(editingModalId)),
      });
      closeWrestlerEditor();
    } catch (err) {
      editStatus.textContent = "";
      editError.textContent = err.message || "Couldn't save changes.";
    }
  });
}

if (editDeleteBtn) {
  editDeleteBtn.addEventListener("click", async () => {
    if (!editingModalId) return;
    if (!confirm("Delete this wrestler from the roster? This does not remove them from past ranking lists.")) return;
    const id = editingModalId;
    editStatus.textContent = "Deleting…";
    try {
      await deleteDoc(doc(db, "wrestlers", id));
      closeWrestlerEditor();
    } catch (err) {
      editStatus.textContent = "";
      editError.textContent = err.message || "Couldn't delete.";
    }
  });
}

// Delegated double-click: any wrestler row carrying a data-id opens the editor.
// Clicks that land on a control (button/input/etc.) are ignored so this never
// hijacks the roster's Edit/Remove buttons, the order-list +/×/▲▼ controls, or
// any inline input.
function onWrestlerDblClick(e) {
  if (e.target.closest("input, textarea, select, button, a, form")) return;
  const el = e.target.closest("[data-id]");
  if (!el) return;
  if (allWrestlers.has(el.dataset.id)) openWrestlerEditor(el.dataset.id);
}
[orderListEl, availableListEl, rosterListEl, fullViewContent].forEach((c) => {
  if (c) c.addEventListener("dblclick", onWrestlerDblClick);
});

let wrestlerNoteTimer = null;

// Transient success line reusing the error slot. Uses textContent (no HTML
// interpolation), so no escaping is needed or wanted here.
function showWrestlerNote(text) {
  wrestlerError.classList.add("form-note");
  wrestlerError.textContent = text;
  if (wrestlerNoteTimer) clearTimeout(wrestlerNoteTimer);
  wrestlerNoteTimer = setTimeout(() => {
    wrestlerError.textContent = "";
    wrestlerError.classList.remove("form-note");
  }, 4000);
}

newWrestlerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (wrestlerNoteTimer) clearTimeout(wrestlerNoteTimer);
  wrestlerError.classList.remove("form-note");
  wrestlerError.textContent = "";
  const name = document.getElementById("new-wrestler-name").value.trim();
  const school = document.getElementById("new-wrestler-school").value.trim();
  // Bug D: normalize so the stored value matches its rankingLists slug and
  // reject a class that slugifies to nothing (e.g. only punctuation/spaces).
  const weightClass = normalizeWeightClass(
      document.getElementById("new-wrestler-weight").value);
  if (!name || !school || !weightClass) return;
  if (!slugify(weightClass)) {
    wrestlerError.textContent = "Enter a valid weight class.";
    return;
  }
  const optional = collectOptionalFields({
    grade: document.getElementById("new-wrestler-grade").value,
    record: document.getElementById("new-wrestler-record").value,
    hometown: document.getElementById("new-wrestler-hometown").value,
    notes: document.getElementById("new-wrestler-notes").value,
  });
  try {
    await addDoc(collection(db, "wrestlers"), {
      name,
      school,
      weightClass,
      ...optional,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
    });
    newWrestlerForm.reset();
    // The wrestlers snapshot re-renders the roster, weight tabs, and (if the
    // builder is open) the Available list automatically. Naming the class here
    // makes clear where the wrestler landed when the open builder is on a
    // different weight class.
    showWrestlerNote(`Added ${name} (${weightClass}).`);
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
