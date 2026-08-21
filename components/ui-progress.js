import { formatBytes } from "./util.js";
import {
  bulkMediaProgress,
  bulkMediaProgressCount,
  bulkMediaProgressList,
  bulkMediaToggle,
  progressBar,
  progressLabel,
  progressPercent,
  progressSection,
  smoothScrollToBottom,
  syncAbortBtn,
  syncProgressCount,
  syncProgressList,
  syncProgressSection,
  syncProgressToggle,
} from "./ui-dom.js";

export function updateProgress(completed, total, label) {
  const pct =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  progressBar.style.width = `${pct}%`;
  progressBar.dataset.done = String(completed >= total && total > 0);
  progressPercent.textContent = `${pct}%`;
  progressSection.setAttribute("aria-valuenow", String(pct));
  progressLabel.textContent = label || `Importing ${completed} of ${total}…`;
}

export function setBulkMediaCollapsed(collapsed) {
  if (!bulkMediaProgress) return;
  bulkMediaProgress.dataset.collapsed = collapsed ? "true" : "false";
  bulkMediaToggle?.setAttribute("aria-expanded", String(!collapsed));
  refreshBulkMediaRowVisibility();
  if (!collapsed) smoothScrollToBottom();
}

bulkMediaToggle?.addEventListener("click", () => {
  setBulkMediaCollapsed(bulkMediaProgress?.dataset.collapsed !== "true");
});

function refreshBulkMediaRowVisibility() {
  if (!bulkMediaProgressList) return;
  const collapsed = bulkMediaProgress?.dataset.collapsed === "true";
  const rows = [...bulkMediaProgressList.children];
  if (!collapsed) {
    rows.forEach((r) => (r.style.display = ""));
    return;
  }
  const active =
    rows.find((r) => r.dataset.state === "uploading") ||
    rows.find((r) => r.dataset.state === "downloading") ||
    rows.find((r) => r.dataset.state === "pending") ||
    rows[rows.length - 1];
  rows.forEach((r) => (r.style.display = r === active ? "" : "none"));
}

export function setupBulkMediaProgress(labels) {
  if (!bulkMediaProgressList) return;
  bulkMediaProgressList.innerHTML = "";
  labels.forEach((label) => appendBulkMediaProgressRow(label));
  if (!labels.length) {
    if (bulkMediaProgress) bulkMediaProgress.style.display = "none";
    if (bulkMediaProgressCount) bulkMediaProgressCount.textContent = "";
  }
  refreshBulkMediaRowVisibility();
}

export function appendBulkMediaProgressRow(label) {
  if (!bulkMediaProgressList) return -1;
  const row = document.createElement("div");
  row.className = "bulk-media-row";
  row.dataset.state = "pending";

  const head = document.createElement("div");
  head.className = "bulk-media-row-head";

  const labelEl = document.createElement("span");
  labelEl.className = "bulk-media-row-label";
  labelEl.textContent = label;

  const pctEl = document.createElement("span");
  pctEl.className = "bulk-media-row-pct";
  pctEl.textContent = "0%";

  head.append(labelEl, pctEl);

  const track = document.createElement("div");
  track.className = "bulk-media-row-track";
  const bar = document.createElement("div");
  bar.className = "bulk-media-row-bar";
  track.appendChild(bar);

  const files = document.createElement("div");
  files.className = "bulk-media-row-files";
  files.textContent = "0 files";

  row.append(head, track, files);
  bulkMediaProgressList.appendChild(row);

  if (bulkMediaProgress) bulkMediaProgress.style.display = "block";
  if (bulkMediaProgressCount) {
    const count = bulkMediaProgressList.children.length;
    bulkMediaProgressCount.textContent = `${count} ticket(s) with media`;
  }
  refreshBulkMediaRowVisibility();
  return bulkMediaProgressList.children.length - 1;
}

export function createAttachmentProgressAdapter(config) {
  if (!config || config.kind !== "bulk") {
    return {
      start: () => {
        startSyncAttachmentProgress();
        syncAbortBtn.disabled = false;
      },
      addFile: (item) => addSyncAttachmentProgressRow(item),
      setProgress: (index, loaded, total) =>
        setSyncAttachmentProgress(index, loaded, total),
      setState: (index, state, message) =>
        setSyncAttachmentState(index, state, message),
      done: () => {},
    };
  }
  let row = -1;
  let totalFiles = 0;
  let doneFiles = 0;
  return {
    start: () => {
      if (row === -1) {
        row = appendBulkMediaProgressRow(config.label || "attachment");
      }
      totalFiles = 0;
      doneFiles = 0;
      startBulkMediaProgress(row);
    },
    addFile: () => {
      totalFiles++;
      updateBulkMediaFiles(row, doneFiles, totalFiles);
      return totalFiles - 1;
    },
    setProgress: (_index, loaded, total) => {
      updateBulkMediaProgress(row, loaded, total);
    },
    setState: (_index, state) => {
      if (state === "done" || state === "failed" || state === "skipped") {
        doneFiles++;
        updateBulkMediaFiles(row, doneFiles, totalFiles);
      }
    },
    done: () => {
      if (row !== -1) setBulkMediaProgressDone(row);
    },
  };
}

export function startBulkMediaProgress(rowIndex) {
  const row = bulkMediaProgressList?.children[rowIndex];
  if (!row) return;
  row.dataset.state = "uploading";
  const bar = row.querySelector(".bulk-media-row-bar");
  if (bar) bar.style.width = "0%";
  const pctEl = row.querySelector(".bulk-media-row-pct");
  if (pctEl) pctEl.textContent = "0%";
  row.scrollIntoView({ block: "nearest" });
  refreshBulkMediaRowVisibility();
}

export function updateBulkMediaProgress(rowIndex, loaded, total, label) {
  const row = bulkMediaProgressList?.children[rowIndex];
  if (!row) return;
  row.dataset.state = "uploading";
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 100;
  const bar = row.querySelector(".bulk-media-row-bar");
  if (bar) bar.style.width = `${pct}%`;
  const pctEl = row.querySelector(".bulk-media-row-pct");
  if (pctEl) {
    const bytesText =
      total > 0
        ? `${formatBytes(loaded) || "0 B"} / ${formatBytes(total) || "0 B"}`
        : `${pct}%`;
    pctEl.textContent = label || bytesText;
  }
  if (total > 0 && loaded >= total) setBulkMediaProgressDone(rowIndex);
}

export function setBulkMediaProgressDone(rowIndex) {
  const row = bulkMediaProgressList?.children[rowIndex];
  if (!row) return;
  row.dataset.state = "done";
  const bar = row.querySelector(".bulk-media-row-bar");
  if (bar) bar.style.width = "100%";
  const pctEl = row.querySelector(".bulk-media-row-pct");
  if (pctEl) pctEl.textContent = "100%";
  const hint = row.querySelector(".bulk-media-row-files");
  const total = Number(row.dataset.filesTotal);
  const uploaded = Number(row.dataset.filesUploaded);
  if (hint && total > 0) {
    hint.textContent =
      uploaded < total
        ? `${uploaded} of ${total} file${total === 1 ? "" : "s"} uploaded`
        : `${total} file${total === 1 ? "" : "s"} uploaded`;
  }
  refreshBulkMediaRowVisibility();
}

export function updateBulkMediaFiles(rowIndex, uploaded, total) {
  const row = bulkMediaProgressList?.children[rowIndex];
  if (!row) return;
  row.dataset.filesUploaded = String(uploaded);
  row.dataset.filesTotal = String(total);
  const hint = row.querySelector(".bulk-media-row-files");
  if (!hint) return;
  if (row.dataset.state === "done") {
    hint.textContent =
      uploaded < total
        ? `${uploaded} of ${total} file${total === 1 ? "" : "s"} uploaded`
        : `${total} file${total === 1 ? "" : "s"} uploaded`;
  } else {
    hint.textContent = `Uploading ${uploaded} of ${total} file${total === 1 ? "" : "s"}…`;
  }
}

export function hideBulkMediaProgress() {
  if (bulkMediaProgress) bulkMediaProgress.style.display = "none";
  if (bulkMediaProgressList) bulkMediaProgressList.innerHTML = "";
}

const syncRows = [];

function refreshSyncRowVisibility() {
  if (!syncProgressList) return;
  const collapsed = syncProgressSection?.dataset.collapsed === "true";
  const rows = [...syncProgressList.children];
  if (!collapsed) {
    rows.forEach((r) => (r.style.display = ""));
    return;
  }
  const active =
    rows.find((r) => r.dataset.state === "uploading") ||
    rows.find((r) => r.dataset.state === "downloading") ||
    rows.find((r) => r.dataset.state === "pending") ||
    rows[rows.length - 1];
  rows.forEach((r) => (r.style.display = r === active ? "" : "none"));
}

function setSyncProgressCollapsed(collapsed) {
  if (!syncProgressSection) return;
  syncProgressSection.dataset.collapsed = collapsed ? "true" : "false";
  syncProgressToggle?.setAttribute("aria-expanded", String(!collapsed));
  refreshSyncRowVisibility();
  if (!collapsed) smoothScrollToBottom();
}

syncProgressToggle?.addEventListener("click", () => {
  setSyncProgressCollapsed(syncProgressSection?.dataset.collapsed !== "true");
});

function updateSyncProgressHeader() {
  if (syncProgressCount) {
    const shown = syncRows.filter((r) => r.el);
    syncProgressCount.textContent = shown.length
      ? `${shown.length} attachment${shown.length === 1 ? "" : "s"}`
      : "";
  }
}

export function showSyncProgressSection() {
  if (!syncProgressSection) return;
  syncProgressSection.style.display = "block";
}

export function startSyncAttachmentProgress() {
  syncRows.length = 0;
  if (syncProgressList) syncProgressList.innerHTML = "";
  syncAbortBtn.disabled = true;
  syncAbortBtn.style.display = "";
  updateSyncProgressHeader();
  refreshSyncRowVisibility();
}

export function finishSyncProgress() {
  if (!syncAbortBtn) return;
  syncAbortBtn.disabled = true;
  syncAbortBtn.style.display = "none";
  if (syncProgressSection && !syncRows.some((r) => r.el)) {
    syncProgressSection.style.display = "none";
  }
}

export function addSyncAttachmentProgressRow(item) {
  if (!syncProgressList) return -1;
  const row = document.createElement("div");
  row.className = "bulk-media-row";
  row.dataset.state = "pending";

  const head = document.createElement("div");
  head.className = "bulk-media-row-head";

  const labelEl = document.createElement("span");
  labelEl.className = "bulk-media-row-label";
  labelEl.textContent = item.label || "attachment";

  const pctEl = document.createElement("span");
  pctEl.className = "bulk-media-row-pct";
  pctEl.textContent = "0%";

  head.append(labelEl, pctEl);

  const track = document.createElement("div");
  track.className = "bulk-media-row-track";
  const bar = document.createElement("div");
  bar.className = "bulk-media-row-bar";
  track.appendChild(bar);

  const hint = document.createElement("div");
  hint.className = "bulk-media-row-files";
  hint.textContent = item.hint || "";

  row.append(head, track, hint);
  syncProgressList.appendChild(row);

  syncRows.push({
    el: row,
    pctEl,
    bar,
    hint,
    loaded: 0,
    total: Number(item.size) || 0,
    state: "pending",
  });
  updateSyncProgressHeader();
  return syncRows.length - 1;
}

export function setSyncAttachmentProgress(index, loaded, total) {
  const row = syncRows[index];
  if (!row || !row.el) return;
  showSyncProgressSection();
  const becameActive =
    row.state !== "uploading" && row.state !== "downloading";
  if (row.state !== "downloading") {
    row.state = "uploading";
    row.el.dataset.state = "uploading";
  }
  if (total > 0) row.total = total;
  const cap = row.total > 0 ? row.total : loaded;
  row.loaded = Math.max(row.loaded, Math.min(loaded, cap));
  const pct =
    row.total > 0 ? Math.min(100, Math.round((row.loaded / row.total) * 100)) : 0;
  row.bar.style.width = `${pct}%`;
  row.pctEl.textContent = `${pct}%`;
  if (becameActive) row.el.scrollIntoView({ block: "nearest" });
  updateSyncProgressHeader();
  refreshSyncRowVisibility();
}

export function setSyncAttachmentState(index, state, message) {
  const row = syncRows[index];
  if (!row) return;
  if (state === "skipped") {
    row.state = "skipped";
    if (row.el) row.el.remove();
    row.el = null;
    updateSyncProgressHeader();
    refreshSyncRowVisibility();
    return;
  }
  if (state === "done" || state === "failed") showSyncProgressSection();
  row.state = state;
  row.el.dataset.state = state;
  if (state === "downloading" || state === "uploading") {
    row.el.scrollIntoView({ block: "nearest" });
  }
  if (state === "uploading") row.bar.style.width = "100%";
  if (state === "done" || state === "failed" || state === "skipped") {
    row.bar.style.width = "100%";
    row.pctEl.textContent =
      state === "done" ? "100%" : state === "failed" ? "failed" : "skipped";
    if (state === "done") row.loaded = row.total;
  }
  if (message) row.hint.textContent = message;
  updateSyncProgressHeader();
  refreshSyncRowVisibility();
}
