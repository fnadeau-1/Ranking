const {
  auth, db, doc, getDoc, onAuthStateChanged, signOut,
  functions, httpsCallable,
} = window.rankingApp;

const signedOutEl = document.getElementById("settings-signedout");
const signedInEl = document.getElementById("settings-signedin");
const photoEl = document.getElementById("settings-photo");
const nameEl = document.getElementById("settings-name");
const emailEl = document.getElementById("settings-email");
const verifiedEl = document.getElementById("settings-verified");
const signOutBtn = document.getElementById("settings-signout");
const deleteBtn = document.getElementById("settings-delete");
const deleteStatus = document.getElementById("settings-delete-status");
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

if (deleteBtn) {
  const deleteMyAccount = httpsCallable(functions, "deleteMyAccount");
  deleteBtn.addEventListener("click", async () => {
    // Two-step confirm: this is irreversible and wipes their content.
    const ok = window.confirm(
        "Permanently delete your account and all your votes, comments, and " +
        "rankings? This can't be undone.");
    if (!ok) return;

    deleteBtn.disabled = true;
    deleteStatus.style.color = "";
    deleteStatus.textContent = "Deleting your account…";
    try {
      await deleteMyAccount();
      // The auth record is gone server-side; clear the local session too, then
      // send them home. (signOut may reject on an already-invalid token — that's
      // fine, the account is deleted either way.)
      try {
        await signOut(auth);
      } catch (e) { /* token already revoked */ }
      window.location.href = "/";
    } catch (err) {
      deleteBtn.disabled = false;
      deleteStatus.style.color = "var(--color-danger)";
      deleteStatus.textContent =
        err.message || "Couldn't delete your account. Please try again.";
    }
  });
}
