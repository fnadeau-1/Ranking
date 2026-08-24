import {initializeApp} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  initializeAppCheck, ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {getFunctions, httpsCallable} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// TODO: replace with your own Firebase project's config
// (Firebase Console -> Project settings -> Your apps -> SDK setup and configuration).
// This is a separate Firebase project from any other app you run — create a new
// project at https://console.firebase.google.com, enable Authentication (Google
// provider) and Firestore, then paste its config below and update .firebaserc.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// TODO: create a reCAPTCHA v3 site key at https://www.google.com/recaptcha/admin
// and register it under Firebase Console -> App Check -> Apps -> (your web app).
// Until you do, App Check calls fail closed and castVote/postComment will be
// rejected — see README "App Check setup" for the exact steps.
const APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_V3_SITE_KEY";

const app = initializeApp(firebaseConfig);

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

window.rankingApp = {
  auth,
  db,
  functions,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  httpsCallable,
};
