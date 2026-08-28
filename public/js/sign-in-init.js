const {auth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged} = window.rankingApp;

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  // Prevent open redirects: only allow bare same-origin relative paths
  // (e.g. "rankings", "rank/archive"). Anything with a scheme (":"),
  // host ("//"), backslash, or leading "/" is rejected in favor of "rankings".
  const n = params.get("next") || "";
  return /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*(\?[A-Za-z0-9_\-=&%]*)?$/.test(n) ? n : "rankings";
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
