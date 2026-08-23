# Montana Wrestling Rankings

A weekly wrestling ranking site. A **ranker** (an admin) builds each week's
ranking per weight class with a drag-and-drop tool. Everyone else can vote
agree/disagree on a ranking and leave comments — both update live.

Plain HTML/CSS/JS on Firebase Hosting, with Firebase Auth (Google sign-in)
and Firestore. No build step, no backend server, no Cloud Functions —
everything writes straight to Firestore and is protected by
`firestore.rules`.

This is a separate Firebase project from any other app — it does not touch
or share data with anything else.

## How it works

- **Wrestlers** (the roster) and **weeks** are created by rankers.
- A **ranking list** is one week + one weight class, holding an ordered
  array of wrestler IDs. Rankers build it in `rank.html` by dragging
  wrestlers from the roster into ranked order; every drag/drop autosaves.
  A list is a draft until the ranker flips "Published."
- The public site (`index.html`) shows published lists only, grouped by
  week and weight-class tabs, with a live agree/disagree vote and a live
  comment thread per list.

## One-time setup

1. Create a new Firebase project at https://console.firebase.google.com
   (use a name specific to this app, not any other project).
2. In the project: enable **Authentication → Sign-in method → Google**,
   and create a **Firestore** database (production mode, pick a region).
3. Add a Web App in Project Settings and copy its config object into
   `public/js/firebase-init.js` (replace the `firebaseConfig` placeholder).
4. Update `.firebaserc` — replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`
   with your Firebase project ID.
5. Install the Firebase CLI if you don't have it: `npm install -g firebase-tools`,
   then `firebase login`.
6. Deploy rules + hosting:
   ```
   firebase deploy --only firestore:rules,hosting
   ```
7. **Bootstrap the first ranker.** Sign in to the deployed site once with
   the Google account that should be the first ranker, then in the
   Firebase Console → Firestore, manually create a document:
   - Collection: `rankers`
   - Document ID: that user's Auth UID (Console → Authentication → Users)
   - Field: `addedAt` (timestamp, now)

   After that, the first ranker can add more rankers from the Rank
   Dashboard's "Rankers" panel (no console needed).

## Local development

```
firebase emulators:start --only hosting,firestore
```

Then open the printed local URL. The emulator UI (Firestore data) runs on
the port shown in the terminal.
