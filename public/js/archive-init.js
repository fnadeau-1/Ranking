import {escapeHtml, formatDate} from "./util.js";

const {db, collection, onSnapshot, query, orderBy} = window.rankingApp;

const cardsEl = document.getElementById("week-cards");

onSnapshot(
    query(collection(db, "weeks"), orderBy("startDate", "desc")),
    (snap) => {
      if (snap.empty) {
        cardsEl.innerHTML = '<p class="empty">No weeks published yet. Check back soon.</p>';
        return;
      }
      cardsEl.innerHTML = snap.docs.map((d, i) => {
        const w = d.data();
        const badge = i === 0 ?
          '<span class="week-badge current">Current</span>' :
          '<span class="week-badge">Past week</span>';
        return `
          <a class="week-card" href="rankings?week=${encodeURIComponent(d.id)}">
            <span>
              <span class="week-label">${escapeHtml(w.label)}</span>
              <div class="week-date">${formatDate(w.startDate)}</div>
            </span>
            ${badge}
          </a>`;
      }).join("");
    },
    () => {
      cardsEl.innerHTML = '<p class="empty">Couldn\'t load the archive. Please try again.</p>';
    },
);
