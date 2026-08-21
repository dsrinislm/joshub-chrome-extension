import { getSite, getCurrentTab, SITES } from "./scrape-detect.js";
import { scrapeInPage } from "./scrape-ticket.js";

export async function listListingAttachmentsInPage(ids, siteName) {
  const VIDEO_EXTS = new Set([
    "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpeg", "mpg",
  ]);
  const IMAGE_EXTS = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "ico",
  ]);
  const idList = Array.isArray(ids) ? ids : [ids];

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

  const typeOf = (name) => {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (VIDEO_EXTS.has(ext)) return "video";
    if (IMAGE_EXTS.has(ext)) return "image";
    return "other";
  };

  const rowToItem = (name, bytes) => {
    const sizeBytes =
      Number.isFinite(Number(bytes)) && Number(bytes) >= 0 ? Number(bytes) : null;
    return { name, sizeBytes, size: formatFileSize(sizeBytes), type: typeOf(name) };
  };

  let fetchGroup;

  if (siteName === "Spark") {

    const userToken =
      (typeof window !== "undefined" && window.g_ck) ||
      document.querySelector('meta[name="X-UserToken"]')?.content ||
      document.querySelector('input[name="X-UserToken"]')?.value ||
      "";
    const headers = { Accept: "application/json" };
    if (userToken) headers["X-UserToken"] = userToken;

    fetchGroup = async (id) => {
      const attachments = [];
      try {
        const response = await fetch(
          `${location.origin}/api/now/table/sys_attachment?sysparm_query=table_sys_id=${encodeURIComponent(id)}&sysparm_fields=file_name,size_bytes&sysparm_display_value=false&sysparm_limit=1000`,
          { credentials: "include", headers },
        );
        if (response.ok) {
          const json = await response.json();
          for (const row of Array.isArray(json?.result) ? json.result : []) {
            const name = String(row?.file_name || "").trim();
            if (name) attachments.push(rowToItem(name, row?.size_bytes));
          }
        }
      } catch {}
      return attachments;
    };
  } else {

    const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(location.search || "");
    if (!contextMatch) return [];
    const [sharedSpace, workspace] = contextMatch[1].split("/");
    if (!sharedSpace || !workspace) return [];
    const apiBase = `${location.origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`;

    fetchGroup = async (id) => {
      const attachments = [];
      if (!/^\d+$/.test(String(id))) return attachments;
      const query = `owner_work_item EQ {id EQ ${id}}`;
      const fields = "id,name,size,exists";
      try {
        const response = await fetch(
          `${apiBase}/attachments?fields=${encodeURIComponent(fields)}&query=${encodeURIComponent(`"${query}"`)}`,
          { credentials: "include" },
        );
        if (response.ok) {
          const body = await response.json();
          for (const att of Array.isArray(body?.data) ? body.data : []) {
            if (!att || att.exists === false) continue;
            const name = String(att?.name || "").trim();
            if (name) attachments.push(rowToItem(name, att?.size));
          }
        }
      } catch {}
      return attachments;
    };
  }

  return Promise.all(
    idList.map(async (id) => ({ id, attachments: await fetchGroup(id) })),
  );
}

export async function listListingAttachmentsInTab(ids, siteName, tabId) {
  const currentTab = tabId
    ? { id: tabId }
    : await getCurrentTab();

  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTab.id, allFrames: true },
    func: listListingAttachmentsInPage,
    args: [ids, siteName],
    world: siteName === "Spark" ? "MAIN" : "ISOLATED",
  });

  const outs = results.map((r) => r.result).filter(Boolean);
  return (
    outs.find((r) => r.some((g) => g.attachments?.length > 0)) ||
    outs.find((r) => r.length > 0) ||
    []
  );
}

export async function scrapeTab(tabId, siteName, options = {}) {
  const site = getSite(siteName);

  if (!site) {
    throw new Error(`Unknown site: ${siteName}`);
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeInPage,
      args: [site, options],
      world: siteName === "Spark" ? "MAIN" : "ISOLATED",
    });
  } catch {
    return null;
  }

  return (results.find((r) => r.result?.title) || results[0])?.result;
}

export async function getPageData(siteName, options = {}) {
  if (!getSite(siteName)) {
    throw new Error("Select a source site (Octane or Spark).");
  }

  const currentTab = await getCurrentTab();
  return scrapeTab(currentTab.id, siteName, options);
}

export async function scrapeSelectedListingInPage() {
  function collectSelectedFromGridModel(plain, itemUrl) {
    const out = [];
    const seen = new Set();

    const looksLikeGrid = (g) => {
      if (!g || typeof g.getData !== "function") return false;
      if (typeof g.invalidate === "function") return true;
      if (typeof g.getOptions === "function" || typeof g.getColumns === "function")
        return true;
      const d = (() => {
        try {
          return g.getData();
        } catch {
          return null;
        }
      })();
      return d && (Array.isArray(d) || typeof d.getItems === "function");
    };

    const candidates = () => {
      const elts = [];
      document
        .querySelectorAll(
          "#wrapped_grid, [pl-grid], .alm-entity-grid, .entities-container-grid, " +
            ".platform-grid, .slick-viewport, .grid-canvas, .slick-canvas, " +
            ".slickgrid-container, .slick-grid-container, .slickgrid_-grid, " +
            "[class*='grid-container'], [class*='grid-canvas']",
        )
        .forEach((el) => elts.push(el));
      const viewport = document.querySelector(".slick-viewport");
      if (viewport && viewport.parentElement) elts.push(viewport.parentElement);
      return elts;
    };

    const jq = typeof window.jQuery === "function" ? window.jQuery : null;

    const angularCandidates = () => {
      const ng = typeof window.angular === "object" ? window.angular : null;
      if (!ng || typeof ng.element !== "function") return [];
      const base = document.querySelector(
        "#wrapped_grid, [pl-grid], .alm-entity-grid, .entities-container-grid",
      );
      if (!base) return [];
      const out = [];
      let scope = null;
      try {
        scope = ng.element(base).scope();
      } catch {}
      const seen = new Set();
      while (scope && !seen.has(scope)) {
        seen.add(scope);
        const ec = scope.entitiesContainer;
        const cands = [
          scope.almEntityGrid,
          scope.maasGrid,
          scope.grid,
          scope.entitiesContainer,
          scope.almEntityGrid?.maasGrid,
          scope.almEntityGrid?.grid,
          scope.almEntityGrid?.selectionModel,
          ec?.gridConfiguration,
          ec?.selectionModel,
          ec?.grid,
        ];
        for (const c of cands) {
          if (c && typeof c === "object") out.push(c);
        }
        scope = scope.$parent;
      }
      return out;
    };

    const jqueryCandidates = () => {
      const out = [];
      for (const el of candidates()) {
        try {
          if (jq) {
            const g =
              jq(el).data("slickGrid") ||
              jq(el).data("slickgrid") ||
              jq(el).data("plGrid") ||
              jq(el).data("grid");
            if (g && typeof g === "object") out.push(g);
          }
          if (el.slickGrid && typeof el.slickGrid === "object") out.push(el.slickGrid);
          if (el.__slickGrid && typeof el.__slickGrid === "object") out.push(el.__slickGrid);
        } catch {}
      }
      return out;
    };

    const candidatesAll = [...angularCandidates(), ...jqueryCandidates()];
    const uniqCandidates = [];
    const seenObjs = new Set();
    for (const c of candidatesAll) {
      if (c && !seenObjs.has(c)) {
        seenObjs.add(c);
        uniqCandidates.push(c);
      }
    }

    const grid = uniqCandidates.find(looksLikeGrid) || null;

    let rowItems = [];
    let filteredItems = null;
    if (grid) {
      const read = (() => {
        try {
          const d = grid.getData();
          if (d && typeof d.getItems === "function") {
            return {
              items: d.getItems() || [],
              filtered:
                typeof d.getFilteredItems === "function"
                  ? d.getFilteredItems() || null
                  : null,
            };
          }
          if (Array.isArray(d)) return { items: d, filtered: d };
        } catch {}
        try {
          const d = grid._getDataItems();
          if (Array.isArray(d)) return { items: d, filtered: d };
        } catch {}
        return null;
      })();
      if (read) {
        rowItems = read.items;
        filteredItems = read.filtered;
      }
    }

    const selectedIds = new Set();
    const selectedItemMap = new Map();

    const idOf = (v) => {
      if (v == null) return null;
      if (typeof v !== "object") return v;
      return v.id ?? v.entityId ?? v.logicalId ?? v.key ?? v.sysId ?? null;
    };

    let found = false;

    const absorb = (list) => {
      let n = 0;
      if (!Array.isArray(list)) return 0;
      for (const v of list) {
        const id = idOf(v);
        if (id == null) continue;
        const sid = String(id);
        if (!selectedIds.has(sid)) n++;
        selectedIds.add(sid);
        if (v && typeof v === "object") selectedItemMap.set(sid, v);
      }
      return n;
    };

    const absorbRows = (rows) => {
      const src = filteredItems && filteredItems.length ? filteredItems : rowItems;
      let n = 0;
      for (const r of rows || []) {
        const item = src[Number(r)];
        if (item && item.id != null) {
          const sid = String(item.id);
          if (!selectedIds.has(sid)) n++;
          selectedIds.add(sid);
          selectedItemMap.set(sid, item);
        }
      }
      return n;
    };

    const probeSelection = (c) => {
      if (found || !c || typeof c !== "object") return;
      for (const fn of [
        "getSelectedItems",
        "getSelectedEntities",
        "getSelectedIds",
        "getSelectedEntityIds",
        "getSelection",
      ]) {
        try {
          if (absorb(typeof c[fn] === "function" ? c[fn]() : null)) {
            found = true;
            return;
          }
        } catch {}
      }
      try {
        if (absorb(c.getSelectedRows())) {
          found = true;
          return;
        }
      } catch {}
      for (const prop of ["selectedItems", "selectedEntities", "selectedIds"]) {
        try {
          if (absorb(c[prop])) {
            found = true;
            return;
          }
        } catch {}
      }
      const sm = (() => {
        try {
          if (typeof c.getSelectionModel === "function") return c.getSelectionModel();
          return c.selectionModel || null;
        } catch {
          return null;
        }
      })();
      if (sm && typeof sm.getSelectedRows === "function") {
        try {
          if (absorbRows(sm.getSelectedRows())) {
            found = true;
            return;
          }
        } catch {}
      }
      if (rowItems.length) {
        try {
          if (
            absorb(
              rowItems.filter(
                (i) =>
                  i && (i.isSelected || i.selected || i.__selected || i._selected),
              ),
            )
          ) {
            found = true;
          }
        } catch {}
      }
    };

    for (const cand of uniqCandidates) probeSelection(cand);
    if (grid) {
      probeSelection(grid);
      const innerNames = ["slickGrid", "grid", "internalGrid", "_grid", "maasGrid"];
      for (const name of innerNames) {
        if (!found && grid[name] && grid[name] !== grid) {
          probeSelection(grid[name]);
        }
      }
    }

    const pushItem = (item) => {
      if (!item || typeof item !== "object") return;
      const id = String(item.id ?? "");
      if (!id || seen.has(id)) return;
      const isSelected =
        selectedIds.has(id) ||
        Boolean(item.isSelected || item.selected || item.__selected || item._selected);
      if (!isSelected) return;
      seen.add(id);
      out.push({
        id,
        name: plain(item.name ?? item.title ?? ""),
        description: plain(item.description ?? item.richText ?? ""),
        url: itemUrl(id),
      });
    };

    for (const item of rowItems) pushItem(item);
    if (!out.length) {
      for (const item of selectedItemMap.values()) pushItem(item);
    }

    return out;
  }
  const plain = (value) =>
    String(value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const itemUrl = (id, entityType) =>
    `${location.href.split("#")[0]}#/entity-navigation?entityType=${entityType || "work_item"}&id=${id}`;

  try {
    const fromModel = collectSelectedFromGridModel(plain, itemUrl);
    if (fromModel.length) {
      return fromModel;
    }
  } catch {}

  const items = [];
  document.querySelectorAll("div.slick-row").forEach((row) => {
    const checkbox = row.querySelector(
      'div[field-name="isSelected"] input[type="checkbox"]',
    );
    if (!checkbox || !checkbox.checked) return;

    const link = row.querySelector("a.alm-entity-grid-id-column");
    const href = link?.getAttribute("href") || "";
    const idMatch =
      /[?&]id=(\d+)/.exec(href) || /item-id-(\d+)/.exec(row.className);
    const id = idMatch ? idMatch[1] : "";
    if (!id || !href) return;

    const entityMatch = /entityType=([^&]+)/.exec(href);
    const entityType = entityMatch ? entityMatch[1] : "work_item";
    const nameEl = row.querySelector('div[field-name="name"] .grid-cell-text');
    const descEl = row.querySelector('div[field-name="description"]');
    const text = (el) =>
      el ? String(el.textContent).replace(/\s+/g, " ").trim() : "";

    items.push({
      id,
      name: text(nameEl),
      description: text(descEl),
      url: itemUrl(id, entityType),
    });
  });

  return items;
}

export async function scrapeSelectedListingInTab() {
  const currentTab = await getCurrentTab();

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: scrapeSelectedListingInPage,
      world: "MAIN",
    });
    return results[0]?.result || [];
  } catch {
    return [];
  }
}

export function detectListingInPage() {
  if (
    document.querySelector("div.slick-row") &&
    document.querySelector("a.alm-entity-grid-id-column")
  ) {
    return "Octane";
  }

  const formlink = document.querySelector("a.linked.formlink");
  if (
    document.querySelector("tr.list_row") &&
    formlink &&
    /incident\.do/.test(formlink.getAttribute("href") || "")
  ) {
    return "Spark";
  }
  return null;
}

function detectTabStateInPage(sites) {
  const matches = (selector) => {
    try {
      return !!document.querySelector(selector);
    } catch {
      return false;
    }
  };

  let site = null;

  const spark = sites.find((s) => s.name === "Spark");
  if (spark) {
    const searchAndHash = (location.search || "") + (location.hash || "");
    const isIncidentUrl = /incident\.do/.test(
      (location.pathname || "") + searchAndHash,
    );
    if (isIncidentUrl && /[?&]sys_id=[^&#]/.test(searchAndHash)) {
      site = "Spark";
    }
  }

  const octane = sites.find((s) => s.name === "Octane");
  if (!site && /[?&]p=[^&#/]+\/[^&#]+/.test(location.search || "")) {
    site = "Octane";
  }

  const octaneDetailOpen =
    site === "Octane" &&
    /entity-navigation/.test(location.hash || "") &&
    !!octane &&
    matches(octane.idSelector);

  let listing = null;
  if (
    !octaneDetailOpen &&
    matches("div.slick-row") &&
    matches("a.alm-entity-grid-id-column")
  ) {
    listing = "Octane";
  } else if (!octaneDetailOpen) {
    const formlink = document.querySelector("a.linked.formlink");
    if (
      matches("tr.list_row") &&
      formlink &&
      /incident\.do/.test(formlink.getAttribute("href") || "")
    ) {
      listing = "Spark";
    }
  }

  let selectedCount = 0;
  if (listing === "Octane") {
    const bar = document.querySelector(
      '[data-aid="status-bar-selected-items-count"]',
    );
    if (bar) {
      const barMatch = /Selected[^:]*:\s*(\d+)/.exec(bar.textContent || "");
      if (barMatch) selectedCount = Number(barMatch[1]);
    }
    if (!selectedCount) {
      document.querySelectorAll("div.slick-row").forEach((row) => {
        const checkbox = row.querySelector(
          'div[field-name="isSelected"] input[type="checkbox"]',
        );
        if (checkbox && checkbox.checked) selectedCount++;
      });
    }
  } else if (listing === "Spark") {
    document.querySelectorAll("tr.list_row").forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) selectedCount++;
    });
  }

  return { site, listing, selectedCount, detail: octaneDetailOpen };
}

export async function detectTabState() {
  const currentTab = await getCurrentTab();
  const url = (currentTab?.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { site: null, listing: null };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id, allFrames: true },
      func: detectTabStateInPage,
      args: [SITES],
    });

    const site = results.map((r) => r.result?.site).find(Boolean) || null;
    const detailFrame = results
      .map((r) => r.result)
      .find((r) => r && r.detail);
    const found =
      results.map((r) => r.result).find((r) => r && r.listing) || null;
    return {
      site,
      listing: detailFrame ? null : found ? found.listing : null,
      selectedCount: detailFrame ? 0 : found ? found.selectedCount || 0 : 0,
    };
  } catch {
    return { site: null, listing: null };
  }
}

export function scrapeSelectedSparkListingInPage() {
  const items = [];

  document.querySelectorAll("tr.list_row").forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;

    const sysId =
      (row.getAttribute("sys_id") || "").trim() ||
      (checkbox.getAttribute("data-ux-metrics-sysid") || "").trim() ||
      (row.id || "").replace(/^row_[^_]+_/, "").trim();
    if (!sysId) return;

    const link = row.querySelector("a.linked.formlink");
    const number = link ? (link.textContent || "").trim() : "";

    const numberCell = link ? link.closest("td") : null;
    const shortDescCell = numberCell ? numberCell.nextElementSibling : null;
    const descCell = shortDescCell ? shortDescCell.nextElementSibling : null;

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

    items.push({
      id: sysId,
      number,
      name: shortDescription || number || sysId,
      description: description || shortDescription,
      url: `${location.origin}/nav_to.do?uri=incident.do?sys_id=${sysId}`,
    });
  });

  return items;
}

export async function scrapeSelectedSparkListingInTab() {
  const currentTab = await getCurrentTab();

  try {

    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id, allFrames: true },
      func: scrapeSelectedSparkListingInPage,
    });
    return (
      results.map((r) => r.result).find((r) => Array.isArray(r) && r.length) ||
      []
    );
  } catch {
    return [];
  }
}

