import { getCurrentTab } from "./scrape-detect.js";

export async function fetchOctaneCommentsInPage(ids) {
  const idList = Array.isArray(ids) ? ids : [ids];
  const octaneApiContext = () => {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return null;
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return null;
    return `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
  };
  const apiBase = octaneApiContext();
  const plainText = (html) => {
    if (!html) return "";
    try {
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      return (doc.body ? doc.body.textContent || "" : String(html))
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch {
      return String(html).trim();
    }
  };
  const resolveLinks = (html) => {
    try {
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      doc.querySelectorAll("a[href]").forEach((a) => {
        try {
          const resolved = new URL(a.getAttribute("href"), location.href);
          if (resolved.protocol === "http:" || resolved.protocol === "https:") {
            a.href = resolved.href;
          }
        } catch {}
      });
      return doc.body ? doc.body.innerHTML : String(html);
    } catch {
      return String(html);
    }
  };
  const groups = new Array(idList.length);
  let next = 0;
  const worker = async () => {
    while (next < idList.length) {
      const index = next++;
      const workItemId = idList[index];
      const comments = [];
      if (apiBase && /^\d+$/.test(String(workItemId))) {
        try {
          const query = `"owner_work_item EQ {id EQ ${workItemId}}"`;
          const response = await fetch(
            `${apiBase}/comments?fields=${encodeURIComponent("id,text,author,creation_time")}&query=${encodeURIComponent(query)}&limit=500`,
            { credentials: "include" },
          );
          if (response.ok) {
            const body = await response.json();
            for (const c of Array.isArray(body?.data) ? body.data : []) {
              const text = plainText(c?.text);
              if (!text) continue;
              const author =
                c?.author && typeof c.author === "object"
                  ? c.author.name || c.author.full_name || c.author.id || ""
                  : String(c?.author || "");
              comments.push({
                id: String(c?.id ?? "").trim(),
                author: String(author).trim(),
                createdAt: String(
                  c?.creation_time || c?.created || "",
                ).trim(),
                text,
                html: resolveLinks(c?.text),
                kind: "comment",
              });
            }
          }
        } catch {}
      }
      groups[index] = { id: String(workItemId), comments };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, idList.length) }, worker),
  );
  return groups;
}

export async function fetchOctaneCommentsInTab(ids) {
  const currentTab = await getCurrentTab();
  const idList = Array.isArray(ids) ? ids : [ids];

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id, allFrames: true },
    func: fetchOctaneCommentsInPage,
    args: [idList],
    world: "ISOLATED",
  });

  const outs = results.map((r) => r.result).filter(Boolean);
  const countComments = (groups) =>
    groups.reduce(
      (sum, g) => sum + (Array.isArray(g?.comments) ? g.comments.length : 0),
      0,
    );
  const best =
    outs
      .filter((g) => Array.isArray(g) && g.length > 0)
      .sort((a, b) => countComments(b) - countComments(a))[0] || [];
  return best;
}

export async function postOctaneCommentsInPage({ workItemId, comments, knownTexts, mappedIds }) {
  const octaneApiContext = () => {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return null;
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return null;
    return `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
  };
  const apiBase = octaneApiContext();
  const OCTANE_XSRF_HEADER = "XSRF-HEADER";
  const xsrfToken = () => {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)XSRF_COOKIE=([^;]+)/);
    if (cookieMatch) return cookieMatch[1];
    const fromSearch = new URLSearchParams(location.search).get("xsrf_token");
    if (fromSearch) return fromSearch;
    const hashIndex = location.hash.indexOf("?");
    if (hashIndex >= 0) {
      const fromHash = new URLSearchParams(
        location.hash.slice(hashIndex + 1),
      ).get("xsrf_token");
      if (fromHash) return fromHash;
    }
    return "";
  };
  const mapped = new Set(
    Array.isArray(mappedIds)
      ? mappedIds
      : mappedIds && typeof mappedIds.has === "function"
        ? Array.from(mappedIds)
        : [],
  );
  const norm = (s) =>
    String(s || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  const known = new Set(
    (Array.isArray(knownTexts) ? knownTexts : []).map(norm),
  );
  const toHtml = (text) => {
    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const paras = String(text)
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const body = paras.length
      ? paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("")
      : "<p></p>";
    return `<html><body>${body}</body></html>`;
  };
  const commentText = (c) => {
    const body = String(c?.body || "").trim();
    if (!body || /^\[(Spark|Octane|Jira comment)\b/i.test(body)) return body;
    const meta = [
      String(c?.author || "").trim(),
      String(c?.created || c?.createdAt || "").trim(),
    ]
      .filter(Boolean)
      .join(" · ");
    return meta ? `[Jira comment] ${meta}\n\n${body}` : `[Jira comment]\n\n${body}`;
  };
  const failedIds = [];
  const mapping = [];
  let posted = 0;
  if (apiBase) {
    for (const c of comments || []) {
      const text = commentText(c);
      if (!text) continue;
      if (mapped.has(String(c.id))) continue;
      if (known.has(norm(text))) continue;
      try {
        const headers = { "Content-Type": "application/json" };
        const token = xsrfToken();
        if (token) headers[OCTANE_XSRF_HEADER] = token;
        const response = await fetch(`${apiBase}/comments`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            data: [
              {
                text: toHtml(text),
                owner_work_item: {
                  type: "work_item",
                  id: String(workItemId),
                },
              },
            ],
          }),
        });
        if (response.ok) {
          const created = await response.json().catch(() => null);
          posted++;
          const createdId =
            created?.data?.[0]?.id ?? created?.id ?? null;
          if (createdId != null) {
            mapping.push({
              jiraCommentId: String(c.id),
              octaneCommentId: String(createdId),
            });
          }
        } else {
          failedIds.push(c.id);
        }
      } catch {
        failedIds.push(c.id);
      }
    }
  } else {
    for (const c of comments || []) if (c?.id) failedIds.push(c.id);
  }
  return {
    posted,
    failed: failedIds.length,
    skipped: (comments || []).length - posted - failedIds.length,
    total: (comments || []).length,
    hasFields: true,
    url: location.href,
    mapping,
  };
}

export async function uploadOctaneAttachmentInPage({ workItemId, name, dataUrl }) {
  const octaneApiContext = () => {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return null;
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return null;
    return `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
  };
  const apiBase = octaneApiContext();
  if (!apiBase) {
    return {
      ok: false,
      error: "Couldn't determine the Octane workspace from the page URL.",
    };
  }
  const OCTANE_XSRF_HEADER = "XSRF-HEADER";
  const xsrfToken = () => {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)XSRF_COOKIE=([^;]+)/);
    if (cookieMatch) return cookieMatch[1];
    const fromSearch = new URLSearchParams(location.search).get("xsrf_token");
    if (fromSearch) return fromSearch;
    const hashIndex = location.hash.indexOf("?");
    if (hashIndex >= 0) {
      const fromHash = new URLSearchParams(
        location.hash.slice(hashIndex + 1),
      ).get("xsrf_token");
      if (fromHash) return fromHash;
    }
    return "";
  };
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    const entityJson = JSON.stringify({
      owner_work_item: { type: "work_item", id: String(workItemId) },
      name,
    });
    form.append(
      "entity",
      new Blob([entityJson], { type: "application/json" }),
      "blob",
    );
    form.append("content", blob, name);
    const uploadHeaders = {};
    const token = xsrfToken();
    if (token) uploadHeaders[OCTANE_XSRF_HEADER] = token;
    const response = await fetch(`${apiBase}/attachments`, {
      method: "POST",
      credentials: "include",
      headers: uploadHeaders,
      body: form,
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Octane rejected the upload (status ${response.status}).`,
      };
    }
    const entity = await response.json().catch(() => null);
    const attachmentId = entity?.data?.[0]?.id ?? entity?.id ?? "";
    if (!attachmentId) {
      return { ok: false, error: "Octane didn't return an attachment id." };
    }
    return { ok: true, id: attachmentId };
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err || "upload failed"),
    };
  }
}

export async function fetchOctanePhaseInPage(workItemId) {
  const octaneApiContext = () => {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return null;
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return null;
    return `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
  };
  const apiBase = octaneApiContext();
  if (!apiBase || !/^\d+$/.test(String(workItemId))) return "";
  try {
    const response = await fetch(
      `${apiBase}/work_items/${workItemId}?fields=phase`,
      { credentials: "include" },
    );
    if (!response.ok) return "";
    const data = await response.json();
    return data?.phase?.name || "";
  } catch {
    return "";
  }
}
