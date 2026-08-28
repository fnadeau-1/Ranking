import {escapeHtml, teamPointsValue} from "./util.js";

const {db, collection, doc, onSnapshot} = window.rankingApp;

const titleEl = document.getElementById("team-title");
const subEl = document.getElementById("team-sub");
const standingsEl = document.getElementById("team-standings");

let teams = [];
let published = false;
let teamsLoaded = false;
let configLoaded = false;

// Teams ranked by points (highest first); blank/non-numeric points sort last,
// then alphabetical.
function sortedTeams() {
  return [...teams].sort((a, b) => {
    const pv = teamPointsValue(b.points) - teamPointsValue(a.points);
    if (pv !== 0) return pv;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function render() {
  // Wait until both sources have reported once so we don't flash a wrong state.
  if (!teamsLoaded || !configLoaded) return;

  if (!published) {
    subEl.textContent = "Team rankings aren't published yet — check back soon.";
    standingsEl.innerHTML =
      '<li class="empty">No team rankings published yet.</li>';
    return;
  }
  if (teams.length === 0) {
    subEl.textContent = "Montana teams, ranked by points.";
    standingsEl.innerHTML =
      '<li class="empty">No teams in the ranking yet.</li>';
    return;
  }
  subEl.textContent = "Montana teams, ranked by points.";
  standingsEl.innerHTML = sortedTeams().map((t, i) => {
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
}

onSnapshot(collection(db, "teams"), (snap) => {
  teams = snap.docs.map((d) => d.data());
  teamsLoaded = true;
  render();
});

onSnapshot(doc(db, "config", "teamRanking"), (snap) => {
  published = snap.exists() && snap.data().published === true;
  configLoaded = true;
  render();
});
