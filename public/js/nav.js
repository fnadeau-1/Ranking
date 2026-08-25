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
  if (rankLink) {
    const snap = await getDoc(doc(db, "rankers", user.uid));
    rankLink.style.display = snap.exists() ? "" : "none";
  }
});
