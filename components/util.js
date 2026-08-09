export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["MB", "GB", "TB"];
  let size = n / 1024;
  let unit = "KB";
  let i = 0;
  while (size >= 1024 && i < units.length) {
    size /= 1024;
    unit = units[i++];
  }
  return `${size.toFixed(1)} ${unit}`;
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
