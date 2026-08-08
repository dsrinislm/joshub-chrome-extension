import { getCurrentTab } from "./scrape-detect.js";

export async function fetchSparkCommentsInPage(ids) {
  const idList = Array.isArray(ids) ? ids : [ids];

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }

  const parseJournalText = (raw) => {
    const entries = [];
    const withLabel = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-\s+(.+?)\s+\(([^)]+)\)\s*$/;
    const withoutLabel = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-\s+(.+)$/;
    let current = null;
    for (const part of String(raw || "").split(/\n\n+/)) {
      const firstLine = part.split(/\r?\n/)[0];
      const m = withLabel.exec(firstLine) || withoutLabel.exec(firstLine);
      if (m) {
        if (current) entries.push(current);
        current = {
          createdAt: m[1].trim(),
          author: m[2].trim(),
          label: m[3]?.trim() || "",
          text: part.slice(firstLine.length).trim(),
        };
      } else if (current) {
        current.text = `${current.text}\n\n${part.trim()}`.trim();
      }
    }
    if (current) entries.push(current);
    return entries;
  };

  const fetchIncident = async (id) => {
    const entries = [];
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_journal_field?sysparm_query=element_id=${encodeURIComponent(id)}^ORDERBYsys_created_on&sysparm_fields=element,value,sys_created_by,sys_created_on,sys_id&sysparm_display_value=true&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (response.ok) {
        const json = await response.json();
        const rows = Array.isArray(json?.result) ? json.result : [];
        for (const row of rows) {
          const rawElement = String(row?.element || "").trim();
          if (!rawElement) continue;
          const isPublic =
            rawElement === "comments" || rawElement === "additional_comments";
          const author = String(row?.sys_created_by || "").trim();
          const text = String(row?.value || "").trim();
          if (!text && !author) continue;
          entries.push({
            sysId: String(row?.sys_id || "").trim(),
            kind: isPublic ? "comments" : "work_notes",
            author,
            createdAt: String(row?.sys_created_on || "").trim(),
            text,
          });
        }
      }
    } catch {}

    if (!entries.length && typeof GlideRecord !== "undefined") {
      try {
        await new Promise((resolve) => {
          const gr = new GlideRecord("sys_journal_field");
          gr.addQuery("element_id", id);
          gr.orderBy("sys_created_on");
          gr.setLimit(1000);
          gr.query(function () {
            while (gr.next()) {
              const rawElement = String(gr.getValue("element") || "").trim();
              if (!rawElement) continue;
              const isPublic =
                rawElement === "comments" ||
                rawElement === "additional_comments";
              const author = String(
                gr.getValue("sys_created_by") || "",
              ).trim();
              const text = String(gr.getValue("value") || "").trim();
              if (!text && !author) continue;
              entries.push({
                sysId: String(gr.getUniqueValue() || "").trim(),
                kind: isPublic ? "comments" : "work_notes",
                author,
                createdAt: String(
                  gr.getValue("sys_created_on") || "",
                ).trim(),
                text,
              });
            }
            resolve();
          });
        });
      } catch {}
    }

    if (!entries.length) {
      try {
        const response = await fetch(
          `${location.origin}/api/now/table/incident/${encodeURIComponent(id)}?sysparm_fields=comments,additional_comments,work_notes&sysparm_display_value=true`,
          { credentials: "include", headers },
        );
        if (response.ok) {
          const json = await response.json();
          const rec = json?.result;
          const seen = new Set();
          const fields = [
            "comments",
            "additional_comments",
            "work_notes",
            "comments_and_work_notes",
          ];
          for (const field of fields) {
            for (const entry of parseJournalText(rec?.[field])) {
              const isWork =
                field === "work_notes" ||
                (field === "comments_and_work_notes" &&
                  /work\s*notes?/i.test(entry.label || ""));
              const kind = isWork ? "work_notes" : "comments";
              const key = `${kind}|${entry.createdAt}|${entry.author}|${entry.text}`;
              if (seen.has(key)) continue;
              seen.add(key);
              entries.push({ kind, ...entry });
            }
          }
          entries.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        }
      } catch {}
    }

    if (!entries.length) {
      try {
        for (const li of document.querySelectorAll("li[data-journal-id]")) {
          const author =
            li.querySelector(".sn-card-component-createdby")?.textContent
              ?.trim() || "";
          const typeLabel =
            li.querySelector(".sn-card-component-time > span:first-child")
              ?.textContent?.trim() || "";
          const dateStr =
            li.querySelector(".date-calendar")?.textContent?.trim() || "";
          const text =
            li.querySelector(".sn-widget-textblock-body")?.textContent?.trim() ||
            "";
          if (!dateStr || !author) continue;
          if (
            !/work\s*notes?/i.test(typeLabel) &&
            !/additional\s*comments?/i.test(typeLabel)
          )
            continue;
          entries.push({
            sysId: li.getAttribute("data-journal-id") || "",
            kind: /work\s*notes?/i.test(typeLabel) ? "work_notes" : "comments",
            author,
            createdAt: dateStr,
            text,
          });
        }
      } catch {}
    }

    if (!entries.length) {
      try {
        const response = await fetch(
          `${location.origin}/incident.do?sys_id=${encodeURIComponent(id)}`,
          { credentials: "include", headers },
        );
        if (response.ok) {
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          for (const li of doc.querySelectorAll("li[data-journal-id]")) {
            const author =
              li.querySelector(".sn-card-component-createdby")?.textContent
                ?.trim() || "";
            const typeLabel =
              li.querySelector(".sn-card-component-time > span:first-child")
                ?.textContent?.trim() || "";
            const dateStr =
              li.querySelector(".date-calendar")?.textContent?.trim() || "";
            const text =
              li.querySelector(".sn-widget-textblock-body")?.textContent
                ?.trim() || "";
            if (!dateStr || !author) continue;
            if (
              !/work\s*notes?/i.test(typeLabel) &&
              !/additional\s*comments?/i.test(typeLabel)
            )
              continue;
            entries.push({
              sysId: li.getAttribute("data-journal-id") || "",
              kind: /work\s*notes?/i.test(typeLabel)
                ? "work_notes"
                : "comments",
              author,
              createdAt: dateStr,
              text,
            });
          }
        }
      } catch (err) {
        String(err?.message || err);
      }
    }

    const parseDate = (value) => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(
        String(value || "").trim(),
      );
      if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
      const t = Date.parse(String(value || "").replace(/\s/g, "T"));
      return Number.isFinite(t) ? new Date(t) : new Date(0);
    };
    entries.sort((a, b) => parseDate(a.createdAt) - parseDate(b.createdAt));

    return entries;
  };

  const groups = new Array(idList.length);
  let next = 0;
  const worker = async () => {
    while (next < idList.length) {
      const index = next++;
      groups[index] = {
        id: String(idList[index]),
        comments: await fetchIncident(idList[index]),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, idList.length) }, worker),
  );
  return groups;
}

export function fetchSparkAttachmentsInPage(sysId) {
  const id = String(sysId || "").trim();

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }

  const toDataUrl = async (url) => {
    try {
      const response = await fetch(url, { credentials: "include", headers });
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  return (async () => {
    const attachments = [];
    if (!id) return [{ id, attachments }];
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(id)}^ORDERBYsys_created_on&sysparm_fields=sys_id,file_name,content_type&sysparm_display_value=false&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (response.ok) {
        const json = await response.json();
        const rows = Array.isArray(json?.result) ? json.result : [];
        for (const att of rows) {
          const fileSysId = String(att?.sys_id || "").trim();
          const name = String(att?.file_name || "").trim();
          if (!fileSysId || !name) continue;
          const dataUrl = await toDataUrl(
            `${location.origin}/api/now/attachment/${encodeURIComponent(fileSysId)}/file`,
          );
          if (dataUrl) attachments.push({ name, dataUrl });
        }
      }
    } catch {}
    return [{ id, attachments }];
  })();
}

export function listSparkAttachmentNamesInPage(sysId) {
  const id = String(sysId || "").trim();

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }

  return (async () => {
    const names = [];
    if (!id) return [{ id, names }];
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(id)}^ORDERBYsys_created_on&sysparm_fields=file_name&sysparm_display_value=false&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (response.ok) {
        const json = await response.json();
        for (const att of Array.isArray(json?.result) ? json.result : []) {
          const name = String(att?.file_name || "").trim();
          if (name) names.push(name);
        }
      }
    } catch {}
    return [{ id, names }];
  })();
}

export function listSparkAttachmentItemsInPage(sysId) {
  const id = String(sysId || "").trim();

  const VIDEO_EXTS = new Set([
    "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpeg", "mpg",
  ]);
  const IMAGE_EXTS = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "ico",
  ]);

  const formatFileSize = (bytes) => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "";
    const units = ["MB", "GB", "TB"];
    let size = n / 1024;
    let unit = "KB";
    let i = 0;
    while (size >= 1024 && i < units.length) {
      size /= 1024;
      unit = units[i++];
    }
    return `${size.toFixed(1)} ${unit}`;
  };

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }

  const loginRequired = () => {
    const href = location.href;
    const title = document.title || "";
    if (
      /login\.do|login_page|signin|sign\.in|log\s*in|login\.microsoftonline|adfs|saml/i.test(
        href,
      )
    ) {
      return true;
    }
    if (/sign\s*in|log\s*in|microsoft/i.test(title)) {
      return true;
    }
    return !!document.querySelector(
      '#user_name, input[name="user_name"], #user_password, input[name="user_password"], ' +
        '#i0116, #passwordInput, input[name="loginfmt"], input[name="passwd"]',
    );
  };

  const itemFrom = (name, sizeBytes, url) => {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const type = VIDEO_EXTS.has(ext)
      ? "video"
      : IMAGE_EXTS.has(ext)
        ? "image"
        : "other";
    return {
      name,
      url,
      type,
      size: formatFileSize(sizeBytes),
      sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
    };
  };

  return (async () => {
    const items = [];
    if (!id) return [{ id, items, loginRequired: false }];
    if (loginRequired()) return [{ id, items, loginRequired: true }];
    const listLockKey = "__jiraSparkAttachmentListLock__";
    let acquired = false;
    try {
      const top = window.top || window;
      if (top[listLockKey]) {
        return [];
      }
      top[listLockKey] = true;
      acquired = true;
    } catch {}
    let apiFailed = false;
    let loginRequiredFlag = false;
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(id)}^ORDERBYsys_created_on&sysparm_fields=sys_id,file_name,content_type,size_bytes&sysparm_display_value=false&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (response.ok) {
        const json = await response.json();
        for (const row of Array.isArray(json?.result) ? json.result : []) {
          const name = String(row?.file_name || "").trim();
          if (!name) continue;
          items.push(
            itemFrom(
              name,
              Number(row?.size_bytes),
              `${location.origin}/api/now/attachment/${encodeURIComponent(String(row?.sys_id || ""))}/file`,
            ),
          );
        }
      } else {
        apiFailed = true;
        if (response.status === 401) loginRequiredFlag = true;
      }
    } catch {
      apiFailed = true;
    }
    if (acquired) {
      try {
        if (window.top) window.top[listLockKey] = false;
      } catch {}
    }
    if (apiFailed && !loginRequiredFlag) {
      for (const el of document.querySelectorAll('a[href*="/api/now/attachment/"], a[href*="sys_attachment.do"]')) {
        const name = (el.textContent || "").trim();
        if (!name) continue;
        items.push(itemFrom(name, null, el.href));
      }
    }
    return [{ id, items, loginRequired: loginRequiredFlag }];
  })();
}

export function uploadSparkAttachmentsInPage({ sysId, files }) {
  const id = String(sysId || "").trim();

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }

  const dataUrlToBlob = (dataUrl) => {
    const [meta, payload] = String(dataUrl || "").split(",");
    const mime =
      /data:([^;]+);/i.exec(meta || "")?.[1] || "application/octet-stream";
    let bytes;
    if (meta && /;base64/i.test(meta)) {
      const binary = atob(payload || "");
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload || ""));
    }
    return new Blob([bytes], { type: mime });
  };

  const syncLockKey = "__jiraSparkSyncAttachmentsLock__";
  const acquireSyncLock = () => {
    try {
      const top = window.top;
      if (!top) return true;
      if (top[syncLockKey]) {
        return false;
      }
      top[syncLockKey] = true;
      return true;
    } catch {
      return true;
    }
  };
  const releaseSyncLock = () => {
    try {
      if (window.top) window.top[syncLockKey] = false;
    } catch {}
  };

  return (async () => {
    if (!acquireSyncLock()) {
      return { uploaded: [], failed: [], errors: {}, skipped: true };
    }
    try {
      const uploaded = [];
      const failed = [];
      const errors = {};
      for (const file of Array.isArray(files) ? files : []) {
        const name = String(file?.name || "").trim();
        if (!name) continue;
        try {
          const form = new FormData();
          form.append("table_name", "incident");
          form.append("table_sys_id", id);
          form.append("uploadFile", dataUrlToBlob(file.dataUrl), name);
          const response = await fetch(
            `${location.origin}/api/now/attachment/upload`,
            { method: "POST", credentials: "include", headers, body: form },
          );
          if (response.ok) {
            uploaded.push(name);
          } else {
            failed.push(name);
            const bodyText = await response.text().catch(() => "");
            errors[name] = `status ${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`;
          }
        } catch (err) {
          failed.push(name);
          errors[name] = String((err && err.message) || err || "unknown");
        }
      }
      return { uploaded, failed, errors, skipped: false };
    } finally {
      releaseSyncLock();
    }
  })();
}

export async function fetchSparkCommentsInTab(ids) {
  const currentTab = await getCurrentTab();
  const idList = Array.isArray(ids) ? ids : [ids];

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id, allFrames: true },
    func: fetchSparkCommentsInPage,
    args: [idList],
    world: "MAIN",
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

