const {auth, db, doc, getDoc, onAuthStateChanged, signOut} = window.rankingApp;

const authSlot = document.getElementById("auth-slot");
const rankLink = document.getElementById("rank-link");

function renderSignedOut() {
  if (authSlot) authSlot.innerHTML = '<a href="sign-in.html">Sign in</a>';
  if (rankLink) rankLink.style.display = "none";
}

function renderSignedIn(user) {
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
