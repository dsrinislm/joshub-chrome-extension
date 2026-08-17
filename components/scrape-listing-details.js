import { getCurrentTab } from "./scrape-detect.js";

export function fetchListingDetailsInPage(ids, site, options = {}) {
  const idList = Array.isArray(ids) ? ids : [ids];
  const includeAttachments = options.includeAttachments !== false;

  async function captureImages(html) {
    if (!html) return { html: "", images: [] };

    const images = [];
    const plain = !/<[a-zA-Z][^>]*>/.test(String(html));
    if (plain) {

      const escaped = String(html).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);
      return { html: escaped, images };
    }

    const doc = new DOMParser().parseFromString(String(html), "text/html");

    if (!includeAttachments) {
      for (const imgEl of Array.from(doc.querySelectorAll("img"))) {
        imgEl.remove();
      }
      return { html: doc.body ? doc.body.innerHTML : "", images };
    }

    let next = 0;

    for (const imgEl of Array.from(doc.querySelectorAll("img"))) {
      if (!imgEl.src) {
        imgEl.remove();
        continue;
      }
      const placeholder = `__JIRA_IMG_${next++}__`;
      try {
        const url = new URL(imgEl.src, location.href).href;
        const response = await fetch(url, { credentials: "include" });
        const blob = await response.blob();
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

    return { html: doc.body ? doc.body.innerHTML : "", images };
  }

  const plainText = (value) => {
    if (!value) return "";
    const text = new DOMParser()
      .parseFromString(String(value), "text/html")
      .body.textContent.replace(/\s+/g, " ")
      .trim();
    return text;
  };

  let fetchItem;
  let itemUrl;
  let apiName;

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
        lastError = new Error(`${apiName} ${response.status}`);
        continue;
      }
      return response;
    }
    throw lastError || new Error(`${apiName} fetch failed`);
  }

  if (site === "Spark") {
    apiName = "Spark API";
    itemUrl = (id) => `${location.origin}/nav_to.do?uri=incident.do?sys_id=${id}`;

    if (!document.querySelector("tr.list_row")) {
      return { items: [] };
    }

    const readRowDom = (sysId) => {
      let row = null;
      document.querySelectorAll("tr.list_row").forEach((r) => {
        if (row) return;
        const rowSysId =
          (r.getAttribute("sys_id") || "").trim() ||
          (r.querySelector('input[type="checkbox"]')?.getAttribute(
            "data-ux-metrics-sysid",
          ) || "").trim() ||
          (r.id || "").replace(/^row_[^_]+_/, "").trim();
        if (rowSysId && rowSysId === sysId) row = r;
      });
      if (!row) return null;

      const checkbox = row.querySelector('input[type="checkbox"]');
      const link = row.querySelector("a.linked.formlink");
      const number = link ? (link.textContent || "").trim() : "";
      const numberCell = link ? link.closest("td") : null;
      const shortDescCell = numberCell
        ? numberCell.nextElementSibling
        : null;
      const descCell = shortDescCell
        ? shortDescCell.nextElementSibling
        : null;
      const shortDescription = shortDescCell
        ? (shortDescCell.textContent || "").replace(/\s+/g, " ").trim()
        : "";
      const cellText = (cell) =>
        (cell.textContent || "").replace(/\s+/g, " ").trim();
      const description = descCell
        ? (descCell.getAttribute("title") || cellText(descCell))
            .replace(/\t/g, "\n")
            .replace(/[ \t]+/g, " ")
            .trim()
        : "";
      return { row, checkbox, number, shortDescription, description };
    };

    const escapePlain = (value) =>
      String(value || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]);

    const userToken =
      (typeof window !== "undefined" && window.g_ck) ||
      document.querySelector('meta[name="X-UserToken"]')?.content ||
      document.querySelector('input[name="X-UserToken"]')?.value ||
      "";

    const apiHeaders = { Accept: "application/json" };
    if (userToken) apiHeaders["X-UserToken"] = userToken;

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

    async function fetchSparkAttachments(incidentSysId) {
      if (!includeAttachments) return [];
      try {
        const response = await fetchWithRetry(
          `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(incidentSysId)}&sysparm_fields=sys_id,file_name,content_type&sysparm_display_value=false&sysparm_limit=1000`,
          { credentials: "include", headers: apiHeaders },
        );
        if (!response.ok) return [];
        const json = await response.json();

        const selectionMap = options.selectedAttachments;
        const selected = selectionMap
          ? new Set(selectionMap[String(incidentSysId)] || [])
          : null;
        return (Array.isArray(json?.result) ? json.result : []).filter(
          (att) =>
            !selected ||
            selected.has(String(att?.file_name || "").trim()),
        );
      } catch {
        return [];
      }
    }

    fetchItem = async (id) => {
      let response;
      try {
        response = await fetchWithRetry(
          `${location.origin}/api/now/table/incident/${encodeURIComponent(id)}?sysparm_fields=number,short_description,description&sysparm_display_value=false`,
          { credentials: "include", headers: apiHeaders },
        );
      } catch {
        response = null;
      }
      if (!response || !response.ok) {

        const dom = readRowDom(String(id));
        if (dom) {
          return {
            id: String(id),
            number: dom.number || "",
            name: dom.shortDescription || dom.number || String(id),
            description: escapePlain(dom.description),
            html: escapePlain(dom.description),
            images: [],
            url: itemUrl(id),
          };
        }
        throw new Error(
          `${apiName} ${response ? response.status : "network"} — row not in listing DOM`,
        );
      }
      const json = await response.json();
      const record = Array.isArray(json?.result) ? json.result[0] : json?.result;
      if (!record) {
        throw new Error("No incident record returned");
      }
      const { html, images } = await captureImages(record.description);

      let next = images.length;
      const attachments = await fetchSparkAttachments(String(id));
      for (const att of attachments) {
        if (!att?.sys_id || !att?.file_name) continue;
        const dataUrl = await sparkFetchToDataUrl(
          `${location.origin}/api/now/attachment/${encodeURIComponent(att.sys_id)}/file`,
          "*/*",
        );
        if (dataUrl) {
          images.push({
            placeholder: `__JIRA_IMG_${next++}__`,
            dataUrl,
            name: att.file_name,
          });
        }
      }

      return {
        id: String(id),
        number: record.number || "",
        name: plainText(record.short_description) || record.number || String(id),
        description: html,
        html,
        images,
        url: itemUrl(id),
      };
    };
  } else {
    apiName = "Octane API";

    const contextMatch = /[?&]p=([^&#]+)/.exec(location.search || "");
    if (!contextMatch) {
      return {
        error: "Couldn't determine the Octane shared space/workspace from the page URL.",
      };
    }
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) {
      return {
        error: "Couldn't determine the Octane shared space/workspace from the page URL.",
      };
    }
    const apiBase = `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;
    itemUrl = (id) => `${location.href.split("#")[0]}#/entity-navigation?entityType=work_item&id=${id}`;

    fetchItem = async (id) => {
      const response = await fetchWithRetry(
        `${apiBase}/work_items/${id}?fields=id,name,description`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(`${apiName} ${response.status}`);
      }
      const data = await response.json();
      const captured = await captureImages(data.description);
      let html = captured.html;
      const { images } = captured;

      if (includeAttachments) {
        const query = `owner_work_item EQ {id EQ ${id}}`;
        const fields = "id,name,description,client_lock_stamp,size,exists";

        const selectionMap = options.selectedAttachments;
        const selected = selectionMap
          ? new Set(selectionMap[String(id)] || [])
          : null;
        let attachments = [];
        try {
          const listResponse = await fetchWithRetry(
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
            (!selected || selected.has(String(att.name))),
        );
        let attImageIndex = images.length;
        let attIndex = 0;
        const worker = async () => {
          while (attIndex < kept.length) {
            const att = kept[attIndex++];
            const placeholder = `__JIRA_IMG_${attImageIndex++}__`;
            try {
              const blobResponse = await fetchWithRetry(
                `${apiBase}/attachments/${encodeURIComponent(att.id)}`,
                { credentials: "include" },
              );
              const blob = await blobResponse.blob();
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
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

      return {
        id: String(data.id ?? id),
        name: data.name || "",
        description: html,
        html,
        images,
        url: itemUrl(id),
      };
    };
  }

  return (async () => {
    const items = new Array(idList.length);
    let next = 0;
    const MAX_PAR = 4;
    const worker = async () => {
      while (next < idList.length) {
        const index = next++;
        const id = idList[index];
        try {
          items[index] = await fetchItem(id);
        } catch (err) {
          items[index] = {
            id: String(id),
            name: "",
            description: "",
            html: "",
            images: [],
            url: itemUrl(id),
            error: err.message || `${apiName} fetch failed`,
          };
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_PAR, idList.length) },
        worker,
      ),
    );
    return { items };
  })();
}

export async function fetchListingDetailsInTab(ids, site, options = {}, tabId) {
  const currentTab = tabId
    ? { id: tabId }
    : await getCurrentTab();

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id, allFrames: true },
    func: fetchListingDetailsInPage,
    args: [ids, site, options],

    world: site === "Spark" ? "MAIN" : "ISOLATED",
  });
  const outs = results.map((r) => r.result).filter(Boolean);
  const out =
    outs.find((o) => (o.items || []).some((i) => !i.error)) ||
    outs.find((o) => (o.items || []).length > 0) ||
    outs[0];
  if (!out) return [];
  if (out.error) throw new Error(out.error);
  return out.items || [];
}

