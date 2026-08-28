import {escapeHtml, teamPointsValue} from "./util.js";

const {db, collection, doc, onSnapshot} = window.rankingApp;

const titleEl = document.getElementById("this-week-title");
const subEl = document.getElementById("this-week-sub");
const listEl = document.getElementById("this-week-list");
const moreLinkEl = document.getElementById("this-week-more");

const MAX_ROWS = 10;

let teams = [];
let published = false;
let teamsLoaded = false;
let configLoaded = false;

// Teams ranked by points (highest first); blank/non-numeric points sort last,
// then alphabetical — same rule as the Teams page.
function sortedTeams() {
  return [...teams].sort((a, b) => {
    const pv = teamPointsValue(b.points) - teamPointsValue(a.points);
    if (pv !== 0) return pv;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function setMoreVisible(show) {
  if (moreLinkEl) moreLinkEl.style.display = show ? "" : "none";
}

function render() {
  // Wait until both sources have reported once so we don't flash a wrong state.
  if (!teamsLoaded || !configLoaded) return;

  titleEl.textContent = "Team Rankings";

  if (!published) {
    subEl.textContent = "Team rankings aren't published yet — check back soon.";
    listEl.innerHTML = '<li class="empty">No team rankings published yet.</li>';
    setMoreVisible(false);
    return;
  }
  if (teams.length === 0) {
    subEl.textContent = "Montana teams, ranked by points.";
    listEl.innerHTML = '<li class="empty">No teams in the ranking yet.</li>';
    setMoreVisible(false);
    return;
  }

  subEl.textContent = "Montana teams, ranked by points.";
  const sorted = sortedTeams();
  listEl.innerHTML = sorted.slice(0, MAX_ROWS).map((t, i) => {
    const pts = (t.points || "").trim();
    const ptsHtml = pts ?
      `<span class="team-points">${escapeHtml(pts)} pts</span>` : "";
    return `
      <li class="player-row team-standing-row">
        <span class="rank">#${i + 1}</span>
        <span class="name">${escapeHtml(t.name || "")}</span>
        ${ptsHtml}
      </li>`;
  }).join("");
  setMoreVisible(sorted.length > MAX_ROWS);
}

onSnapshot(collection(db, "teams"), (snap) => {
  teams = snap.docs.map((d) => d.data());
  teamsLoaded = true;
  render();
}, () => {
  titleEl.textContent = "Team Rankings";
  subEl.textContent = "Head to the Teams page to see the latest.";
  listEl.innerHTML = '<li class="empty">Try the Teams page.</li>';
});

onSnapshot(doc(db, "config", "teamRanking"), (snap) => {
  published = snap.exists() && snap.data().published === true;
  configLoaded = true;
  render();
}, () => {
  configLoaded = true;
  render();
});
