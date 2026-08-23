import {initializeApp} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.rankingApp = {
  auth,
  db,
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
};
