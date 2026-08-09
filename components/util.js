export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function truncateTextToFit(el) {
  if (!el || typeof el.clientWidth !== "number" || el.clientWidth <= 0) return;
  const full = el.dataset.fullText || el.textContent;
  el.dataset.fullText = full;
  if (el.scrollWidth <= el.clientWidth) return;
  const marker = "\u2026";
  const m = String(full).match(/^(.*)(\s·\s?synced)$/);
  const base = m ? m[1] : String(full);
  const suffix = m ? m[2] : "";
  if (!base) return;
  let lo = 0;
  let hi = base.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.textContent = base.slice(0, mid) + marker + suffix;
    if (el.scrollWidth <= el.clientWidth) lo = mid;
    else hi = mid - 1;
  }
  el.textContent = base.slice(0, lo) + marker + suffix;
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = n / 1024;
  let i = 0;
  while (size >= 100 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function isSafeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return /^https?:\/\//i.test(value.trim());
}

/* Jira issues created from an Octane/Spark ticket carry a summary shaped
   like "SITE | TICKET | title" (see scrape-ticket.js). Extract the ticket
   number from that prefix so it can be linked back to the source ticket. */
export function extractSourceNumberFromSummary(summary) {
  const match = /^([A-Z]+) \| ([A-Z0-9][A-Z0-9._-]*) \|/i.exec(
    String(summary || ""),
  );
  return match ? match[2].toUpperCase() : "";
}

const UNSAFE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "link",
  "meta",
  "base",
  "template",
  "form",
  "svg",
  "math",
]);

export function sanitizeHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(String(html), "text/html");

  doc.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();

    if (UNSAFE_TAGS.has(tag)) {
      el.remove();
      return;
    }

    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();

      if (name.startsWith("on") || name === "style") {
        el.removeAttribute(attr.name);
        return;
      }

      if (name === "href" || name === "src") {
        if (!isSafeHttpUrl(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    });
  });

  return doc.body ? doc.body.innerHTML : String(html);
}
