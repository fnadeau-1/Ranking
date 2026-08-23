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
