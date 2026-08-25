const {auth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged} = window.rankingApp;

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("next") || "rankings";
}

document.getElementById("google-sign-in").addEventListener("click", async () => {
  const errorEl = document.getElementById("sign-in-error");
  errorEl.textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    errorEl.textContent = err.message || "Sign in failed. Please try again.";
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = nextUrl();
});
