const {
  auth, db, doc, getDoc, onAuthStateChanged, signOut,
} = window.rankingApp;

const signedOutEl = document.getElementById("settings-signedout");
const signedInEl = document.getElementById("settings-signedin");
const photoEl = document.getElementById("settings-photo");
const nameEl = document.getElementById("settings-name");
const emailEl = document.getElementById("settings-email");
const verifiedEl = document.getElementById("settings-verified");
const signOutBtn = document.getElementById("settings-signout");
const dashboardLink = document.getElementById("settings-dashboard-link");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    signedOutEl.style.display = "";
    signedInEl.style.display = "none";
    return;
  }
  signedOutEl.style.display = "none";
  signedInEl.style.display = "";

  nameEl.textContent = user.displayName || "Signed in";
  emailEl.textContent = user.email || "";
  verifiedEl.textContent = user.emailVerified ?
    "Email verified — you can vote and comment." :
    "Email not verified — verify it with Google to vote and comment.";

  if (user.photoURL) {
    photoEl.src = user.photoURL;
    photoEl.style.display = "";
  } else {
    photoEl.style.display = "none";
  }

  // Show the Dashboard shortcut only for confirmed rankers. Fail closed on error
  // and ignore a result that resolves after the account has changed.
  const uid = user.uid;
  dashboardLink.style.display = "none";
  try {
    const snap = await getDoc(doc(db, "rankers", uid));
    if (auth.currentUser && auth.currentUser.uid === uid && snap.exists()) {
      dashboardLink.style.display = "";
    }
  } catch (e) {
    dashboardLink.style.display = "none";
  }
});

if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/";
  });
}
