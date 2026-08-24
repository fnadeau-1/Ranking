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

const firebaseConfig = {
  apiKey: "AIzaSyCGTtswc13ZM9ym6NSwbnHPsJ1FBxznVYM",
  authDomain: "rankings-d6214.firebaseapp.com",
  projectId: "rankings-d6214",
  storageBucket: "rankings-d6214.firebasestorage.app",
  messagingSenderId: "389860482949",
  appId: "1:389860482949:web:b7e135a8f16c6b02a0aeec",
};

// TODO: create a reCAPTCHA v3 site key at https://www.google.com/recaptcha/admin
// and register it under Firebase Console -> App Check -> Apps -> (your web app).
// Until you do, App Check is skipped below — castVote/postComment will still
// reject requests without a token once you deploy functions with
// enforceAppCheck, so voting/commenting won't work until this is set. See
// README "App Check setup" for the exact steps.
const APP_CHECK_SITE_KEY = "YOUR_RECAPTCHA_V3_SITE_KEY";

const app = initializeApp(firebaseConfig);

if (APP_CHECK_SITE_KEY !== "YOUR_RECAPTCHA_V3_SITE_KEY") {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

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
