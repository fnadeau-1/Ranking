import {escapeHtml} from "./util.js";

const {
  db, collection, getDocs, query, where, orderBy, limit,
} = window.rankingApp;

const titleEl = document.getElementById("this-week-title");
const subEl = document.getElementById("this-week-sub");
const listEl = document.getElementById("this-week-list");

const MAX_ROWS = 8;

function toMillis(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

// The most recently updated published list — so the featured class genuinely is
// the "newest from the board" the copy promises (rankingLists carry updatedAt).
function mostRecent(lists) {
  return [...lists].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))[0];
}

async function loadThisWeek() {
  try {
    const weekSnap = await getDocs(
        query(collection(db, "weeks"), orderBy("startDate", "desc"), limit(1)),
    );
    if (weekSnap.empty) {
      titleEl.textContent = "No rankings published yet";
      subEl.textContent = "Check back once the first week goes live.";
      listEl.innerHTML = '<li class="empty">Nothing here yet.</li>';
      return;
    }
    const week = {id: weekSnap.docs[0].id, ...weekSnap.docs[0].data()};

    const listsSnap = await getDocs(query(
        collection(db, "rankingLists"),
        where("weekId", "==", week.id),
        where("published", "==", true),
    ));
    const lists = listsSnap.docs.map((d) => ({id: d.id, ...d.data()}))
        .filter((l) => Array.isArray(l.order) && l.order.length > 0);
    if (lists.length === 0) {
      titleEl.textContent = week.label;
      subEl.textContent = "No weight classes published for this week yet.";
      listEl.innerHTML = '<li class="empty">Nothing ranked yet.</li>';
      return;
    }

    const list = mostRecent(lists);
    const wrestlersSnap = await getDocs(collection(db, "wrestlers"));
    const wrestlers = new Map(wrestlersSnap.docs.map((d) => [d.id, d.data()]));

    titleEl.textContent = `${week.label} — ${list.weightClass}`;
    subEl.textContent = "The newest published weight class, straight from the board.";

    const rows = list.order.slice(0, MAX_ROWS).map((id, i) => {
      const w = wrestlers.get(id);
      if (!w) return "";
      return `
        <li class="player-row">
          <span class="rank">#${i + 1}</span>
          <span class="name">${escapeHtml(w.name)}<div class="category">${escapeHtml(w.school)}</div></span>
        </li>`;
    }).join("");
    const more = list.order.length > MAX_ROWS ?
      `<li class="empty"><a href="rankings?week=${encodeURIComponent(week.id)}">See the full ${escapeHtml(list.weightClass)} ranking &rarr;</a></li>` : "";
    listEl.innerHTML = rows + more;
  } catch (err) {
    titleEl.textContent = "Couldn't load this week";
    subEl.textContent = "Head to the rankings page to see the latest.";
    listEl.innerHTML = '<li class="empty">Try the Rankings page.</li>';
  }
}

loadThisWeek();
