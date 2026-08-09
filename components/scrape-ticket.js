import { getSite, getCurrentTab } from "./scrape-detect.js";

export async function scrapeInPage(site, options = {}) {
  const includeAttachments = options.includeAttachments !== false;
  const selectedAttachments = options.selectedAttachments || null;

  const captureAttachments = options.captureAttachments !== false;

  const captureEmbeddedImages = options.captureEmbeddedImages !== false;

  const octaneApiPath = async () => {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return null;
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return null;

    const itemId = (() => {
      if (!site.idSelector) return null;
      const el = document.querySelector(site.idSelector);
      if (!el) return null;
      let raw;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        raw = el.value;
      } else {
        raw = el.textContent;
        if (!String(raw || "").trim()) {
          const nested = el.querySelector("input, textarea");
          if (nested) raw = nested.value;
        }
      }
      const match = /\d+/.exec(String(raw || ""));
      return match ? match[0] : null;
    })();
    if (!itemId) return null;

    const apiBase = `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;

    const toDataUrl = async (url) => {
      const response = await fetch(url, { credentials: "include" });
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    let response;
    try {
      response = await fetch(
        `${apiBase}/work_items/${itemId}?fields=id,name,description`,
        { credentials: "include" },
      );
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || !String(data.name || "").trim()) return null;

    const raw = String(data.description || "");
    const plain = !/<[a-zA-Z][^>]*>/.test(raw);
    const images = [];
    let html;
    let text = "";
    if (plain) {

      text = raw;
      html = raw.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);
    } else {

      const doc = new DOMParser().parseFromString(raw, "text/html");
      if (captureEmbeddedImages) {
        let imgIndex = 0;
        for (const imgEl of Array.from(doc.querySelectorAll("img"))) {
          if (!imgEl.src) {
            imgEl.remove();
            continue;
          }
          const placeholder = `__JIRA_IMG_${imgIndex++}__`;
          try {
            const url = new URL(imgEl.src, location.href).href;
            const res = await fetch(url, { credentials: "include" });
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            images.push({ placeholder, dataUrl });
            imgEl.replaceWith(doc.createTextNode(placeholder));
          } catch {
            imgEl.remove();
          }
        }
      }
      html = doc.body ? doc.body.innerHTML : "";
    }

    if (includeAttachments) {
      const query = `owner_work_item EQ {id EQ ${itemId}}`;

      const fields = "id,name,description,client_lock_stamp,size,exists";
      let attachments = [];
      try {
        const listResponse = await fetch(
          `${apiBase}/attachments?fields=${encodeURIComponent(fields)}&query=${encodeURIComponent(`"${query}"`)}`,
          { credentials: "include" },
        );
        if (listResponse.ok) {
          const body = await listResponse.json();
          attachments = Array.isArray(body?.data) ? body.data : [];
        }
      } catch {
        attachments = [];
      }

      const kept = attachments.filter(
        (att) =>
          att &&
          att.id != null &&
          att.exists !== false &&
          String(att.name || "").trim() &&
          (!selectedAttachments ||
            selectedAttachments.includes(String(att.name))),
      );

      if (captureAttachments === false) {

        for (const att of kept) images.push({ name: String(att.name) });
      } else {

        let attImageIndex = 0;
        let attIndex = 0;
        const worker = async () => {
          while (attIndex < kept.length) {
            const att = kept[attIndex++];
            const placeholder = `__JIRA_IMG_${attImageIndex++}__`;
            try {
              const dataUrl = await toDataUrl(
                `${apiBase}/attachments/${encodeURIComponent(att.id)}`,
              );
              images.push({ placeholder, dataUrl, name: String(att.name) });
              html += `<p>${placeholder}</p>`;
            } catch {

            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(4, kept.length) }, worker),
        );
      }
    }

    const itemIdText = String(data.id ?? itemId);
    return {
      title: `${site.name.toUpperCase()} | ${itemIdText} | ${String(data.name).replace(/\s+/g, " ").trim()}`,
      id: itemIdText,
      source: site.name,
      url: `${location.href.split("#")[0]}#/entity-navigation?entityType=work_item&id=${itemIdText}`,
      html,
      text,
      images,
    };
  };

  if (site.name === "Octane") {
    const viaApi = await octaneApiPath();
    if (viaApi) return viaApi;
    return {
      title: "",
      id: "",
      source: site.name,
      url: location.href,
      html: "",
      images: [],
    };
  }

  async function sparkIncidentApiPath() {
    const searchMatch = /[?&]sys_id=([^&]+)/.exec(location.search || "");
    const hashMatch = /sys_id=([^&]+)/.exec(location.hash || "");
    const sysId = (searchMatch && searchMatch[1]) || (hashMatch && hashMatch[1]);
    if (!sysId) return null;

    const userToken =
      (typeof window !== "undefined" && window.g_ck) ||
      document.querySelector('meta[name="X-UserToken"]')?.content ||
      document.querySelector('input[name="X-UserToken"]')?.value ||
      "";
    const apiHeaders = { Accept: "application/json" };
    if (userToken) apiHeaders["X-UserToken"] = userToken;

    async function fetchWithRetry(url, options, tries = 2) {
      let lastError;
      for (let attempt = 0; attempt < tries; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, 300 * attempt + Math.random() * 200),
          );
        }
        let response;
        try {
          response = await fetch(url, options);
        } catch (err) {
          lastError = err;
          continue;
        }
        if (
          response.status === 429 ||
          (response.status >= 500 && response.status <= 599)
        ) {
          lastError = new Error(`Spark API ${response.status}`);
          continue;
        }
        return response;
      }
      throw lastError || new Error("Spark API fetch failed");
    }

    async function sparkFetchToDataUrl(url, accept) {
      const headers = userToken ? { "X-UserToken": userToken } : {};
      if (accept) headers.Accept = accept;
      try {
        const response = await fetchWithRetry(
          url,
          { credentials: "include", headers },
          2,
        );
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
    }

    const plainText = (value) => {
      if (!value) return "";
      return new DOMParser()
        .parseFromString(String(value), "text/html")
        .body.textContent.replace(/\s+/g, " ")
        .trim();
    };

    async function captureDescription(raw) {
      const images = [];
      const source = String(raw || "");
      if (!/<[a-zA-Z][^>]*>/.test(source)) {
        const escaped = source.replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]);
        return { html: escaped, images };
      }
      const doc = new DOMParser().parseFromString(source, "text/html");
      if (captureEmbeddedImages) {
        let next = 0;
        for (const imgEl of Array.from(doc.querySelectorAll("img"))) {
          if (!imgEl.src) {
            imgEl.remove();
            continue;
          }
          const placeholder = `__JIRA_IMG_${next++}__`;
          const dataUrl = await sparkFetchToDataUrl(
            new URL(imgEl.src, location.href).href,
          );
          if (dataUrl) {
            images.push({ placeholder, dataUrl });
            imgEl.replaceWith(doc.createTextNode(placeholder));
          } else {
            imgEl.remove();
          }
        }
      }
      return { html: doc.body ? doc.body.innerHTML : "", images };
    }

    const recordResponse = await fetchWithRetry(
      `${location.origin}/api/now/table/incident/${encodeURIComponent(sysId)}?sysparm_fields=number,short_description,description&sysparm_display_value=false`,
      { credentials: "include", headers: apiHeaders },
    );
    if (!recordResponse.ok) {
      return null;
    }
    const json = await recordResponse.json().catch(() => null);
    const record = Array.isArray(json?.result) ? json.result[0] : json?.result;
    if (!record) return null;

    const number = String(record.number || "").trim();
    const shortDescription = plainText(record.short_description);
    if (!shortDescription && !number) return null;

    const { html, images } = await captureDescription(record.description);
    const jiraTitle = ["SPARK", number, shortDescription]
      .filter(Boolean)
      .join(" | ");

    if (includeAttachments) {
      const attResponse = await fetchWithRetry(
        `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(sysId)}&sysparm_fields=sys_id,file_name,content_type&sysparm_display_value=false&sysparm_limit=1000`,
        { credentials: "include", headers: apiHeaders },
      );
      let rows = [];
      if (attResponse.ok) {
        const attJson = await attResponse.json().catch(() => null);
        rows = Array.isArray(attJson?.result) ? attJson.result : [];
      }
      const selected = selectedAttachments
        ? new Set(selectedAttachments)
        : null;
      let next = images.length;
      for (const att of rows) {
        if (!att?.sys_id || !att?.file_name) continue;
        const name = String(att.file_name).trim();
        if (!name || (selected && !selected.has(name))) continue;
        if (captureAttachments === false) {

          images.push({ name });
          continue;
        }
        const dataUrl = await sparkFetchToDataUrl(
          `${location.origin}/api/now/attachment/${encodeURIComponent(att.sys_id)}/file`,
          "*/*",
        );
        if (dataUrl) {
          images.push({
            placeholder: `__JIRA_IMG_${next++}__`,
            dataUrl,
            name,
          });
        }
      }
    }

    return {
      title: jiraTitle,
      id: number,
      source: site.name,
      url: `${location.origin}/nav_to.do?uri=incident.do?sys_id=${encodeURIComponent(sysId)}`,
      html,
      text: plainText(record.description),
      images,
    };
  }

  async function sparkIncidentDomPath() {
    const readText = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      let raw;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        raw = el.value;
      } else {
        raw = el.textContent;
        if (!String(raw || "").trim()) {
          const nested = el.querySelector("input, textarea");
          if (nested) raw = nested.value;
        }
      }
      return String(raw ?? "").replace(/\s+/g, " ").trim() || null;
    };

    const id = readText(site.idSelector);
    const title = readText(site.titleSelectors);
    if (!id && !title) return null;

    const editor = document.querySelector(site.editorSelector);
    let text = "";
    let html = "";
    if (editor) {
      text = String(editor.value ?? "");
      html = text.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);
    }

    const images = [];
    if (includeAttachments && site.attachmentSelector) {
      const selected = selectedAttachments
        ? new Set(selectedAttachments)
        : null;
      let next = 0;
      for (const container of Array.from(
        document.querySelectorAll(site.attachmentSelector),
      )) {
        const href = container.getAttribute?.("href");
        if (!href) continue;
        const name = (container.textContent || "").trim();
        if (!name || (selected && !selected.has(name))) continue;
        if (captureAttachments === false) {
          images.push({ name });
          continue;
        }
        try {
          let downloadUrl;
          try {
            downloadUrl = new URL(href, location.href).href;
          } catch {

            continue;
          }
          const response = await fetch(downloadUrl, {
            credentials: "include",
          });
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const placeholder = `__JIRA_IMG_${next++}__`;
          images.push({ placeholder, dataUrl, name });
          html += `<p>${placeholder}</p>`;
        } catch {

        }
      }
    }

    return {
      title: [site.name.toUpperCase(), id, title].filter(Boolean).join(" | "),
      id: id || "",
      source: site.name,
      url: location.href,
      html,
      text,
      images,
    };
  }

  if (site.name === "Spark") {
    const viaApi = await sparkIncidentApiPath().catch(() => null);
    if (viaApi?.title) return viaApi;

    const viaDom = await sparkIncidentDomPath();
    if (viaDom?.title) return viaDom;

    return {
      title: "",
      id: "",
      source: site.name,
      url: location.href,
      html: "",
      text: "",
      images: [],
    };
  }
}

export async function listTicketAttachmentsInPage(site) {
  try {
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

  if (site.name === "Octane") {
    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return [];
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return [];

    let itemId = null;
    if (site.idSelector) {
      const el = document.querySelector(site.idSelector);
      let raw = "";
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        raw = el.value;
      } else if (el) {
        raw = el.textContent;
        if (!String(raw || "").trim()) {
          const nested = el.querySelector("input, textarea");
          if (nested) raw = nested.value;
        }
      }
      const match = /\d+/.exec(String(raw || ""));
      if (match) itemId = match[0];
    }
    if (!itemId) return [];

    const apiBase = `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
    const query = `owner_work_item EQ {id EQ ${itemId}}`;
    const fields = "id,name,description,client_lock_stamp,size,exists";
    let data = [];
    try {
      const response = await fetch(
        `${apiBase}/attachments?fields=${encodeURIComponent(fields)}&query=${encodeURIComponent(`"${query}"`)}`,
        { credentials: "include" },
      );
      if (response.ok) {
        const body = await response.json();
        data = Array.isArray(body?.data) ? body.data : [];
      }
    } catch {
      return [];
    }

    return data
      .filter(
        (att) =>
          att &&
          att.id != null &&
          att.exists !== false &&
          String(att?.name || "").trim(),
      )
      .map((att) => {
        const name = String(att.name);
        const ext = (name.split(".").pop() || "").toLowerCase();
        const type = VIDEO_EXTS.has(ext)
          ? "video"
          : IMAGE_EXTS.has(ext)
            ? "image"
            : "other";
        const sizeBytes = Number(att.size);
        return {
          name,
          url: `${apiBase}/attachments/${encodeURIComponent(att.id)}`,
          type,
          size: formatFileSize(sizeBytes),
          sizeBytes:
            Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
          description: String(att.description || "").trim(),
        };
      });
  }

  if (site.name === "Spark") {

    const domItems = () => {
      const items = [];
      if (!site.attachmentSelector) return items;
      for (const container of Array.from(
        document.querySelectorAll(site.attachmentSelector),
      )) {
        const href = container.getAttribute?.("href");
        const name = (container.textContent || "").trim();
        if (!href || !name) continue;
        let url;
        try {
          url = new URL(href, location.href).href;
        } catch {

          continue;
        }
        const ext = (name.split(".").pop() || "").toLowerCase();
        const sizeLabel = (() => {
          const m = /([\d.]+\s*(?:KB|MB|GB))/i.exec(container.textContent || "");
          return m ? m[1] : "";
        })();
        items.push({
          name,
          url,
          type: VIDEO_EXTS.has(ext)
            ? "video"
            : IMAGE_EXTS.has(ext)
              ? "image"
              : "other",
          size: sizeLabel,
          sizeBytes: null,
        });
      }
      return items;
    };

    const searchMatch = /[?&]sys_id=([^&]+)/.exec(location.search || "");
    const hashMatch = /sys_id=([^&]+)/.exec(location.href.split("#")[1] || "");
    const sysId = (searchMatch && searchMatch[1]) || (hashMatch && hashMatch[1]);
    if (!sysId) return domItems();

    const userToken =
      (typeof window !== "undefined" && window.g_ck) ||
      document.querySelector('meta[name="X-UserToken"]')?.content ||
      document.querySelector('input[name="X-UserToken"]')?.value ||
      "";
    const headers = { Accept: "application/json" };
    if (userToken) headers["X-UserToken"] = userToken;

    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(sysId)}&sysparm_fields=sys_id,file_name,content_type,size_bytes&sysparm_display_value=false&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (!response.ok) {
        return domItems();
      }
      const json = await response.json();
      const items = [];
      for (const row of Array.isArray(json?.result) ? json.result : []) {
        const name = String(row?.file_name || "").trim();
        if (!name) continue;
        const ext = (name.split(".").pop() || "").toLowerCase();
        const type = VIDEO_EXTS.has(ext)
          ? "video"
          : IMAGE_EXTS.has(ext)
            ? "image"
            : "other";
        const sizeBytes = Number(row?.size_bytes);
        items.push({
          name,
          url: `${location.origin}/api/now/attachment/${encodeURIComponent(String(row.sys_id || ""))}/file`,
          type,
          size: formatFileSize(sizeBytes),
          sizeBytes:
            Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
        });
      }

      if (items.length) return items;
      return domItems();
    } catch {
      return domItems();
    }
  }

  return [];
  } catch {
    return [];
  }
}

export async function listTicketAttachmentsInTab(siteName) {
  const site = getSite(siteName);
  if (!site) return [];

  const currentTab = await getCurrentTab();

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id, allFrames: true },
      func: listTicketAttachmentsInPage,
      args: [site],

      world: siteName === "Spark" ? "MAIN" : "ISOLATED",
    });
  } catch {

    return [];
  }

  return (
    results.map((r) => r.result).find((r) => r && r.length > 0) ||
    (results[0] && results[0].result) ||
    []
  );
}

