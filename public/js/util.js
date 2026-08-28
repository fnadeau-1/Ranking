// The canonical weight classes. Every week uses this exact set — the dashboard
// always shows these 14 tabs and "Submit" publishes all 14 at once. Edit this
// one list if the classes ever change. (Keep in sync with functions/index.js if
// you ever enforce the set server-side.)
export const WEIGHT_CLASSES = [
  "106", "113", "120", "126", "132", "138", "144",
  "150", "157", "165", "175", "190", "215", "285",
];

// Optional roster fields beyond the required name/school/weightClass. Adding a
// field here (plus the matching allow-list entry + size cap in firestore.rules)
// is all it takes to surface a new customizable column in the Add form, inline
// edit, CSV import/export, and template. `pub: true` also shows it on the public
// ranking sub-line. Keep the `max` values in sync with firestore.rules.
export const WRESTLER_OPTIONAL_FIELDS = [
  {key: "grade", label: "Grade / Year", placeholder: "Grade / Year", max: 20, pub: true},
  {key: "record", label: "Record", placeholder: "Record (e.g. 24-3)", max: 20, pub: true},
  {key: "hometown", label: "Hometown", placeholder: "Hometown", max: 100, pub: false},
  {key: "notes", label: "Notes", placeholder: "Notes", max: 300, pub: false},
];

// The public sub-line under a wrestler's name: school plus any public optional
// fields that are set, joined with " · ". Safe on a missing/undefined wrestler.
export function wrestlerSubline(w) {
  if (!w) return "";
  const parts = [w.school]
      .concat(WRESTLER_OPTIONAL_FIELDS.filter((f) => f.pub).map((f) => w[f.key]))
      .map((s) => String(s == null ? "" : s).trim())
      .filter(Boolean);
  return parts.join(" · ");
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function slugify(str) {
  return String(str).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function listId(weekId, weightClass) {
  return `${weekId}__${slugify(weightClass)}`;
}

export function formatDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  return timestamp.toDate().toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"});
}

export function formatDateTime(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  return timestamp.toDate().toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
