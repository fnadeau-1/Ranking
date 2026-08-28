const {auth, db, doc, getDoc, onAuthStateChanged, signOut} = window.rankingApp;

const authSlot = document.getElementById("auth-slot");
const rankLink = document.getElementById("rank-link");

// Mobile nav toggle.
const navToggle = document.getElementById("nav-toggle");
const navLinks = document.getElementById("nav-links");
if (navToggle && navLinks) {
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function renderSignedOut() {
  if (authSlot) authSlot.innerHTML = '<a href="sign-in">Sign in</a>';
  if (rankLink) rankLink.style.display = "none";
}

function renderSignedIn() {
  if (authSlot) {
    authSlot.innerHTML = '<a href="#" id="sign-out-link">Sign out</a>';
    document.getElementById("sign-out-link").addEventListener("click", (e) => {
      e.preventDefault();
      signOut(auth);
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderSignedOut();
    return;
  }
  renderSignedIn(user);
  if (!rankLink) return;
  // Hide by default and only reveal for a confirmed ranker. Fail closed if the
  // read errors (offline / App Check), and ignore a result that resolves after
  // the signed-in account has already changed (stale-await race).
  rankLink.style.display = "none";
  const uid = user.uid;
  try {
    const snap = await getDoc(doc(db, "rankers", uid));
    if (auth.currentUser && auth.currentUser.uid === uid) {
      rankLink.style.display = snap.exists() ? "" : "none";
    }
  } catch (e) {
    rankLink.style.display = "none";
  }
});
