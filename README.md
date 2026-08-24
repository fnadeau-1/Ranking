# Montana Wrestling Rankings

A weekly wrestling ranking site. A **ranker** (an admin) builds each week's
ranking per weight class with a drag-and-drop tool. Everyone else can vote
agree/disagree on a ranking and leave comments — both update live.

Firebase Hosting (plain HTML/CSS/JS, no build step) + Firebase Auth (Google
sign-in) + Firestore + Cloud Functions.

This is a separate Firebase project from any other app — it does not touch
or share data with anything else.

## Security model — nothing is trusted client-side

Every write is authorized by something that runs on Google's servers, never
by client-side JavaScript:

- **Ranker actions** (roster, weeks, ranking order, publishing, adding other
  rankers) go straight from the browser to Firestore, but `firestore.rules`
  requires a `rankers/{uid}` document to exist for that user on *every* such
  write — the client cannot fake that, and rules also enforce field types,
  max lengths, and an exact allow-list of fields on each write.
- **Votes and comments** are *not* written directly by the client at all —
  `firestore.rules` denies those writes outright. Instead the client calls
  the `castVote` / `postComment` Cloud Functions, which run with the Admin
  SDK and enforce: sign-in, email verification (comments), that the target
  ranking is actually published, a length cap, and a per-user rate limit
  backed by a server-only `rateLimits/{uid}` counter a client can neither
  read nor write. A modified client can call these functions with bad
  input, but it cannot skip the checks inside them or forge the rate-limit
  counter, because that code only runs on Google's infrastructure.
- **App Check** is wired in (`public/js/firebase-init.js`, reCAPTCHA v3) and
  the two Cloud Functions are deployed with `enforceAppCheck: true`, so even
  a request with a stolen API key gets rejected unless it also carries a
  fresh App Check token minted by your real, running web app.

## One-time setup

1. Create a new Firebase project at https://console.firebase.google.com
   (use a name specific to this app, not any other project) — this requires
   the Blaze (pay-as-you-go) plan, since Cloud Functions need it. Blaze
   still has a generous free tier; a small fan site won't come close.
2. In the project: enable **Authentication → Sign-in method → Google**,
   and create a **Firestore** database (production mode, pick a region).
3. Add a Web App in Project Settings and copy its config object into
   `public/js/firebase-init.js` (replace the `firebaseConfig` placeholder).
4. Update `.firebaserc` — replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`
   with your Firebase project ID.
5. **App Check**: create a reCAPTCHA v3 site key at
   https://www.google.com/recaptcha/admin (choose v3), then in Firebase
   Console → App Check → Apps, register your web app with that site key.
   Paste the site key into `APP_CHECK_SITE_KEY` in
   `public/js/firebase-init.js`. In App Check → APIs, turn on enforcement
   for Cloud Functions once you've deployed them (step 8) — turning it on
   too early will block your own first deploys/tests.
6. Install the Firebase CLI if you don't have it: `npm install -g firebase-tools`,
   then `firebase login`.
7. Install Cloud Functions dependencies: `npm install` inside `functions/`.
8. Deploy everything:
   ```
   firebase deploy --only hosting,firestore:rules,firestore:indexes,functions
   ```
9. **Bootstrap the first ranker.** Sign in to the deployed site once with
   the Google account that should be the first ranker, then in the
   Firebase Console → Firestore, manually create a document:
   - Collection: `rankers`
   - Document ID: that user's Auth UID (Console → Authentication → Users)
   - Field: `addedAt` (timestamp, now)

   After that, the first ranker can add more rankers from the Rank
   Dashboard's "Rankers" panel (no console needed).

## Continuous deployment (optional)

`.github/workflows/deploy.yml` deploys automatically on every push to
`main`. One-time setup:

```
firebase login:ci
```

Copy the printed token into a GitHub repo secret named `FIREBASE_TOKEN`
(Settings → Secrets and variables → Actions). After that, pushes to `main`
deploy hosting, rules, indexes, and functions with no manual step.

## Local development

```
firebase emulators:start --only hosting,firestore,functions
```

Then open the printed local URL. Note the emulator does not enforce App
Check by default, so votes/comments work locally even without a real
reCAPTCHA key.
