import {
  formatBytes,
  extractSourceNumberFromSummary,
  isSafeHttpUrl,
  sanitizeHtml,
  truncateTextToFit,
} from "./util.js";
import {
  bulkAttachmentGroups,
  bulkAttachmentNote,
  bulkAttachmentPicker,
  bulkAttachmentPickerTitle,
  bulkAttachmentSection,
  bulkIncludeAttachments,
  bulkView,
  bulkSparkLoginBtn,
  bulkOctaneLoginBtn,
  clearFileBtn,
  dropzone,
  dropzoneHint,
  dropzoneIcon,
  dropzoneTitle,
  exportBtn,
  fileError,
  fileInput,
  fileSummary,
  importBtn,
  jiraBaseUrlInput,
  jiraSyncFlowActive,
  jiraToSparkSyncBtn,
  listingImportBtn,
  listingImportLabel,
  previewBody,
  previewCollapseBtn,
  previewIdHeader,
  previewSection,
  previewSourceHeader,
  previewTitle,
  progressSection,
  projectKeyInput,
  selectAllCheckbox,
  selectAllLabel,
  selectionCount,
  singleView,
  smoothScrollToBottom,
  state,
  tabBulk,
  tabSingle,
  tableWrap,
} from "./ui-dom.js";
import {
  collapseAttachmentPickers,
  expandAttachmentPicker,
  itemSizeText,
  setStatus,
  hideLoginButtons,
} from "./ui-single.js";
import { hideBulkMediaProgress } from "./ui-progress.js";

export function getBulkIncludeAttachments() {
  return Boolean(
    bulkIncludeAttachments?.checked || bulkIncludeAttachments?.indeterminate,
  );
}

export function getBulkSelectedAttachments() {
  return state.bulkAttachmentSelection;
}

export function setBulkAttachmentSectionVisible(visible) {
  if (!bulkAttachmentSection) return;
  bulkAttachmentSection.style.display = visible ? "block" : "none";
  if (!visible) {
    if (bulkIncludeAttachments) {
      bulkIncludeAttachments.checked = false;
      bulkIncludeAttachments.indeterminate = false;
    }
    clearBulkAttachmentPicker();
    setBulkPreviewCollapsed(false);
  }
}

export function setBulkPreviewCollapsed(collapsed) {
  if (!previewSection) return;
  previewSection.classList.toggle("preview-collapsed", Boolean(collapsed));
  previewCollapseBtn?.setAttribute("aria-expanded", String(!collapsed));
}

export function scrollBulkRowTop(row, smooth = true) {
  if (!tableWrap || !row?.tr) return;
  const thead = tableWrap.querySelector("thead");
  const headerHeight = thead ? thead.offsetHeight : 0;
  tableWrap.scrollTo({
    top: Math.max(0, row.tr.offsetTop - headerHeight),
    behavior: smooth ? "smooth" : "auto",
  });
}

export function scrollBulkToFirstSelected() {
  if (!tableWrap) return;
  const first = state.bulkRows.find(
    (r) => !r.checkbox.disabled && r.checkbox.checked,
  );
  if (first) scrollBulkRowTop(first, false);
  else scrollBulkTableTop();
}

export function scrollBulkTableTop(smooth = false) {
  if (!tableWrap) return;
  tableWrap.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

export function setBulkAttachmentNote(message) {
  if (!bulkAttachmentNote) return;
  bulkAttachmentNote.hidden = !message;
  bulkAttachmentNote.textContent = message || "";
}

export function setBulkAttachmentSyncProgress(visible) {
  const el = document.getElementById("bulkAttachmentSyncProgress");
  if (!el) return;
  el.hidden = !visible;
}

export function setBulkAttachmentPickerLoading() {
  if (!bulkAttachmentPicker) return;
  bulkAttachmentPicker.hidden = false;
  expandAttachmentPicker(bulkAttachmentPicker);
  bulkAttachmentGroups.innerHTML = "";
  setBulkAttachmentNote("");
  bulkPickerHasNoAttachments = false;
  updateBulkIncludeSyncState();
  setBulkAttachmentSyncProgress(true);
  state.bulkAttachmentSelection = null;
}

export function clearBulkAttachmentPicker() {
  if (bulkAttachmentPicker) bulkAttachmentPicker.hidden = true;
  if (bulkAttachmentGroups) bulkAttachmentGroups.innerHTML = "";
  setBulkAttachmentNote("");
  setBulkAttachmentSyncProgress(false);
  if (bulkIncludeAttachments) {
    bulkIncludeAttachments.indeterminate = false;
  }
  state.bulkAttachmentSelection = null;
}

export function renderBulkAttachmentPicker(groups, labels = {}, syncedMap = {}) {
  if (!bulkAttachmentPicker) return;
  bulkAttachmentPicker.hidden = false;
  expandAttachmentPicker(bulkAttachmentPicker);
  bulkAttachmentGroups.innerHTML = "";
  bulkPickerHasNoAttachments = false;
  state.bulkAttachmentSelection = {};

  const totalFiles = groups.reduce(
    (sum, group) => sum + (group.attachments || []).length,
    0,
  );
  if (bulkAttachmentPickerTitle) {
    bulkAttachmentPickerTitle.textContent = `Choose attachments to upload (${totalFiles})`;
  }

  let anyFiles = false;
  for (const group of groups) {
    const files = group.attachments || [];
    if (!files.length) continue;
    anyFiles = true;

    const ticketId = String(group.id);
    const synced = syncedMap[ticketId] || new Set();

    const selectable = files.filter(
      (f) => f.source === "jira" || !synced.has(f.name),
    );
    const fullySynced = selectable.length === 0;
    state.bulkAttachmentSelection[ticketId] = selectable.map((f) => f.name);

    const block = document.createElement("div");
    block.className = "attachment-group";

    const title = document.createElement("div");
    title.className = "attachment-group-title";
    const groupCheckbox = document.createElement("input");
    groupCheckbox.type = "checkbox";
    groupCheckbox.className = "attachment-group-check";
    groupCheckbox.checked = selectable.length > 0;
    groupCheckbox.disabled = selectable.length === 0;
    groupCheckbox.dataset.ticket = ticketId;
    groupCheckbox.title =
      "Select all attachments of this ticket that aren't synced yet";
    groupCheckbox.addEventListener("change", () => {
      state.bulkAttachmentSelection[ticketId] = groupCheckbox.checked
        ? selectable.map((f) => f.name)
        : [];
      block
        .querySelectorAll(
          ".attachment-item:not(.attachment-item-synced) input[type='checkbox']",
        )
        .forEach((box) => {
          box.checked = groupCheckbox.checked;
        });
      updateGroupCheck(ticketId);
      updateGroupSizeLabel(ticketId);
      updateBulkIncludeSyncState();
    });

    const titleText = document.createElement("span");
    titleText.textContent = buildGroupTitleText(
      labels[ticketId] || group.id,
      files,
      selectable.map((f) => f.name),
      fullySynced,
    );
    title.append(groupCheckbox, titleText);
    block.appendChild(title);

    block._files = files;
    block._titleText = titleText;
    block._fullySynced = fullySynced;
    block.dataset.title = labels[ticketId] || String(group.id);
    block.dataset.count = String(files.length);
    block.dataset.size = formatBytes(
      files.reduce((sum, f) => sum + (Number(f.sizeBytes) || 0), 0),
    );

    for (const item of files) {
      const alreadySynced = item.source !== "jira" && synced.has(item.name);
      const row = document.createElement("label");
      row.className = "attachment-item" + (alreadySynced ? " attachment-item-synced" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.name = item.name;
      checkbox.dataset.ticket = ticketId;
      if (alreadySynced) {
        checkbox.disabled = true;
        checkbox.title = "Already on Jira — will be skipped on import";
      }
      checkbox.addEventListener("change", () => {
        if (alreadySynced) return;
        const sel = state.bulkAttachmentSelection?.[ticketId] || [];
        state.bulkAttachmentSelection[ticketId] = checkbox.checked
          ? [...sel, item.name]
          : sel.filter((n) => n !== item.name);
        updateGroupCheck(ticketId);
        updateGroupSizeLabel(ticketId);
        updateBulkIncludeSyncState();
      });

      const name = document.createElement("span");
      name.className = "attachment-item-name";
      name.textContent = item.name + (alreadySynced ? " · synced" : "");
      const sizeText = itemSizeText(item);
      name.title = sizeText ? `${item.name}\nSize: ${sizeText}` : item.name;

      const size = document.createElement("span");
      size.className = "attachment-item-size";
      size.textContent = sizeText;

      row.append(checkbox, name, size);
      block.appendChild(row);
    }

    bulkAttachmentGroups.appendChild(block);
    updateGroupCheck(ticketId);
  }

  bulkAttachmentGroups
    .querySelectorAll(".attachment-item-name")
    .forEach(truncateTextToFit);

  if (!anyFiles) {
    bulkAttachmentGroups.innerHTML =
      '<div class="attachment-group-title">No attachments found.</div>';
    bulkPickerHasNoAttachments = true;
  }

  updateBulkIncludeSyncState();
}

let bulkPickerHasNoAttachments = false;

export function updateBulkIncludeSyncState() {
  if (!bulkIncludeAttachments) return;
  const allBoxes = bulkAttachmentGroups.querySelectorAll(
    ".attachment-item input[type='checkbox']",
  );
  const boxes = bulkAttachmentGroups.querySelectorAll(
    ".attachment-item:not(.attachment-item-synced) input[type='checkbox']",
  );
  const total = allBoxes.length;
  let covered = 0;
  for (const box of allBoxes) if (box.checked) covered++;

  if (total > 0) {
    bulkIncludeAttachments.indeterminate = covered > 0 && covered < total;
    bulkIncludeAttachments.checked = covered === total;
  } else {
    bulkIncludeAttachments.indeterminate = false;
  }

  const allSynced =
    bulkPickerHasNoAttachments ||
    (total > 0 && boxes.length === 0);
  if (allSynced) {
    bulkIncludeAttachments.checked = true;
    bulkIncludeAttachments.indeterminate = false;
    bulkIncludeAttachments.disabled = false;
  } else {
    bulkIncludeAttachments.disabled = false;
  }

  updateListingControls();
}

function selectedBytesOf(files, names) {
  const set = new Set(names || []);
  return files.reduce(
    (sum, f) => sum + (set.has(f.name) ? Number(f.sizeBytes) || 0 : 0),
    0,
  );
}

function buildGroupTitleText(label, files, selectedNames, fullySynced) {
  const totalBytes = files.reduce(
    (sum, f) => sum + (Number(f.sizeBytes) || 0),
    0,
  );
  const totalSize = formatBytes(totalBytes);
  if (!totalSize || totalSize === "0 B") {
    return `${label} (${files.length})`;
  }
  if (fullySynced) {
    return `${label} (${files.length}) · ${totalSize}`;
  }
  const selBytes = selectedBytesOf(files, selectedNames);
  if (selBytes <= 0) {
    return `${label} (${files.length})`;
  }
  const selSize = formatBytes(selBytes);
  if (selBytes >= totalBytes) {
    return `${label} (${files.length}) · ${totalSize}`;
  }
  return `${label} (${files.length}) · ${selSize} of ${totalSize}`;
}

function updateGroupSizeLabel(ticketId) {
  const block = bulkAttachmentGroups.querySelector(
    `.attachment-group-check[data-ticket="${ticketId}"]`,
  )?.closest(".attachment-group");
  const titleText = block?._titleText;
  const files = block?._files;
  if (!titleText || !files) return;
  titleText.textContent = buildGroupTitleText(
    block.dataset.title,
    files,
    state.bulkAttachmentSelection?.[ticketId],
    block._fullySynced,
  );
}

function updateGroupCheck(ticketId) {
  const groupCheck = bulkAttachmentGroups.querySelector(
    `.attachment-group-check[data-ticket="${ticketId}"]`,
  );
  if (!groupCheck) return;
  const group = groupCheck.closest(".attachment-group");
  const allBoxes = group.querySelectorAll(
    ".attachment-item input[type='checkbox']",
  );
  if (!allBoxes.length) return;
  const boxes = group.querySelectorAll(
    ".attachment-item:not(.attachment-item-synced) input[type='checkbox']",
  );
  if (!boxes.length) {
    groupCheck.checked = true;
    groupCheck.disabled = true;
    groupCheck.indeterminate = false;
    return;
  }
  groupCheck.disabled = false;
  let checked = 0;
  for (const box of boxes) if (box.checked) checked++;
  groupCheck.checked = checked > 0 && checked === boxes.length;
  groupCheck.indeterminate = checked > 0 && checked < boxes.length;
}

export function updateBulkGroupChecks() {
  bulkAttachmentGroups
    .querySelectorAll(".attachment-group-check")
    .forEach((groupCheck) => updateGroupCheck(groupCheck.dataset.ticket));
}

export function updateBulkGroupSizeLabels() {
  bulkAttachmentGroups
    .querySelectorAll(".attachment-group-check")
    .forEach((groupCheck) => updateGroupSizeLabel(groupCheck.dataset.ticket));
}

export function markBulkAttachmentsSynced(uploadedMap) {
  if (!bulkAttachmentGroups || !uploadedMap) return;
  for (const [ticketId, names] of Object.entries(uploadedMap)) {
    if (!names || !names.length) continue;
    for (const name of names) {
      const box = bulkAttachmentGroups.querySelector(
        `.attachment-item input[type='checkbox'][data-ticket="${ticketId}"][data-name="${CSS.escape(name)}"]`,
      );
      if (!box) continue;
      const row = box.closest(".attachment-item");
      if (row.classList.contains("attachment-item-synced")) continue;
      box.checked = true;
      box.disabled = true;
      box.title = "Already on Jira — will be skipped on import";
      row.classList.add("attachment-item-synced");
      const nameEl = row.querySelector(".attachment-item-name");
      if (nameEl && !nameEl.textContent.includes("synced")) {
        nameEl.textContent = `${name} · synced`;
      }
      const sel = state.bulkAttachmentSelection?.[ticketId];
      if (sel) {
        state.bulkAttachmentSelection[ticketId] = sel.filter((n) => n !== name);
      }
    }
    updateGroupCheck(ticketId);
    refreshBulkGroupTitle(ticketId);
  }
  updateBulkIncludeSyncState();
}

function refreshBulkGroupTitle(ticketId) {
  const block = bulkAttachmentGroups.querySelector(
    `.attachment-group-check[data-ticket="${ticketId}"]`,
  )?.closest(".attachment-group");
  const titleText = block?.querySelector(".attachment-group-title span");
  if (!titleText) return;
  const count = Number(block.dataset.count || 0);
  const size = block.dataset.size || "";
  titleText.textContent = `${block.dataset.title || ticketId} (${count})${size && size !== "0 B" ? ` · ${size}` : ""}`;
}

export function markBulkRowsFullySynced(fullySyncedIds) {
  if (!fullySyncedIds) return;
  const ids = new Set(
    Array.from(fullySyncedIds, (id) => String(id)),
  );
  for (const row of state.bulkRows || []) {
    if (
      row.statusEl.dataset.state === "created" ||
      row.statusEl.dataset.state === "exists" ||
      row.checkbox.disabled
    ) {
      continue;
    }
    if (row.rowIndex != null && ids.has(String(row.rowIndex))) {
      row.checkbox.checked = true;
      row.checkbox.disabled = true;
      row.statusEl.dataset.state = "exists";
      row.statusEl.textContent = "Already exists — attachments up to date";
    }
  }
  updateSelectionCount();
}
export function lockBulkImport() {
  importBtn.classList.add("hidden");
}

export function unlockBulkImport() {

  if (bulkRowsFromListing) return;
  importBtn.classList.remove("hidden");
  importBtn.disabled = false;
  importBtn.dataset.loading = "false";
}

let bulkBusy = false;

let bulkSessionChecking = false;

let bulkRowsFromListing = false;

export function setBulkSessionChecking(checking) {
  bulkSessionChecking = Boolean(checking);
  updateListingControls();
}

export function isBulkSessionChecking() {
  return bulkSessionChecking;
}

export function setBulkRowsFromListing(fromListing) {
  bulkRowsFromListing = Boolean(fromListing);
}

export function isBulkRowsFromListing() {
  return bulkRowsFromListing;
}

export function setBulkBusy(isBusy) {
  bulkBusy = Boolean(isBusy);
  importBtn.disabled = isBusy;
  importBtn.dataset.loading = isBusy ? "true" : "false";
  fileInput.disabled = isBusy;
  listingImportBtn.disabled = isBusy;
  listingImportBtn.dataset.loading = isBusy ? "true" : "false";
  if (isBusy) {
    listingImportBtn.style.display = "none";
    collapseAttachmentPickers();
  }

  previewCollapseBtn?.classList.toggle("hidden", isBusy);
  selectAllLabel?.classList.toggle("hidden", isBusy);
  if (!isBusy) {
    updateListingControls();
    updateBulkSelectAllVisibility();

    updateBulkIncludeSyncState();
  }
}

export function isBulkBusy() {
  return bulkBusy;
}

const viewScroll = { single: 0, bulk: 0 };

export function switchView(view, focusTab = true) {
  const isBulk = view === "bulk";
  const entering = isBulk ? "bulk" : "single";
  const leaving = isBulk ? "single" : "bulk";

  viewScroll[leaving] = document.body.scrollTop || 0;

  singleView.hidden = isBulk;
  bulkView.hidden = !isBulk;

  tabSingle.classList.toggle("active", !isBulk);
  tabSingle.setAttribute("aria-selected", String(!isBulk));
  tabBulk.classList.toggle("active", isBulk);
  tabBulk.setAttribute("aria-selected", String(isBulk));

  if (isBulk) {
    updateBulkStatusMessage();
  } else if (jiraSyncFlowActive) {
    setStatus("Sync updates with Spark", "info");
  } else {
    const jiraConfigured =
      jiraBaseUrlInput.value.trim() && projectKeyInput.value.trim();
    setStatus(
      jiraConfigured
        ? "All set - Export current ticket into JIRA"
        : "Configure Jira details and create a ticket.",
      "info",
    );
  }

  if (focusTab) {
    (isBulk ? tabBulk : tabSingle)?.focus?.({ preventScroll: true });
  }

  document.body.scrollTop = viewScroll[entering] || 0;
}

export function setSingleTabEnabled(enabled) {
  const isEnabled = Boolean(enabled);
  tabSingle.disabled = !isEnabled;
  tabSingle.setAttribute("aria-disabled", String(!isEnabled));
  tabSingle.title = isEnabled
    ? ""
    : "Open a Spark or Octane ticket to use this.";
  if (!isEnabled && bulkView.hidden && jiraFilterActive) {
    switchView("bulk", false);
  }
}

export function setJiraToSparkVisible(visible) {
  if (!jiraToSparkSyncBtn) return;
  jiraToSparkSyncBtn.style.display = visible ? "block" : "none";
}

export function updateBulkStatusMessage() {
  const jiraConfigured =
    jiraBaseUrlInput.value.trim() && projectKeyInput.value.trim();
  setStatus(
    jiraFilterActive
      ? !state.bulkRows.length
        ? jiraFilterDropCount
          ? "No selected tickets are linked to Spark/Octane."
          : "Select the issues on the Jira page to sync"
        : jiraFilterDropCount
          ? `${jiraFilterDropCount} ticket(s) dropped — not linked to Spark/Octane.`
          : getBulkHasCheckedRows() ||
              !state.bulkRows.some((r) => !r.checkbox.disabled)
            ? "All set - Sync selected Jira listing"
            : "Select the issues on the Jira page to sync"
      : jiraConfigured
        ? excelFlowActive || !activeListingSite || !listingHasSelection
          ? "Upload Octane or Spark report"
          : "All set - Sync selected listing to continue"
        : "Configure Jira details and create a ticket.",
    jiraFilterActive && jiraFilterDropCount && !state.bulkRows.length
      ? "error"
      : "info",
  );
}

let jiraFilterDropCount = 0;

export function setJiraFilterDropCount(count) {
  jiraFilterDropCount = Math.max(0, Number(count) || 0);
}

export function getJiraFilterDropCount() {
  return jiraFilterDropCount;
}

let activeListingSite = null;
let listingHasSelection = false;

export function setActiveListingSite(site) {
  activeListingSite = site || null;
}

export function getActiveListingSite() {
  return activeListingSite;
}

let jiraFilterActive = false;

export function setJiraFilterActive(active) {
  jiraFilterActive = Boolean(active);
  updateListingControls();
}

export function isJiraFilterActive() {
  return jiraFilterActive;
}

export function setListingHasSelection(hasSelection) {
  listingHasSelection = Boolean(hasSelection);
  updateListingControls();
}

export function getListingHasSelection() {
  return listingHasSelection;
}

export function getBulkHasCheckedRows() {
  return state.bulkRows.some(
    (r) => r.checkbox.checked && !r.checkbox.disabled,
  );
}

export function syncListingControls() {
  updateListingControls();
}

export function setBulkRowsUnselected() {
  state.bulkRows.forEach((r) => {
    if (!r.checkbox.disabled) r.checkbox.checked = false;
  });
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  updateListingControls();
  updateSelectionCount();
}

export function setBulkRowsSelected() {
  state.bulkRows.forEach((r) => {
    if (!r.checkbox.disabled) r.checkbox.checked = true;
  });
  if (selectAllCheckbox) selectAllCheckbox.checked = true;
  updateListingControls();
  updateSelectionCount();
}

export function autoCheckBulkRowsByKeys(keys) {
  const keySet = new Set((keys || []).map((k) => String(k).toUpperCase()));
  state.bulkRows.forEach((r) => {
    if (r.checkbox.disabled) return;
    r.checkbox.checked = keySet.has(String(r.idText).toUpperCase());
  });
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = state.bulkRows.some(
      (r) => !r.checkbox.disabled && r.checkbox.checked,
    );
  }
  updateListingControls();
  updateSelectionCount();
}

let excelFlowActive = false;

export function isExcelFlowActive() {
  return excelFlowActive;
}

export function setExcelFlowActive(active) {
  excelFlowActive = Boolean(active);
  updateListingControls();
}

function listingSyncDoneState() {
  if (!bulkRowsFromListing || !state.bulkRows.length) return false;
  const allRowsDone = state.bulkRows.every(
    (r) => r.checkbox.checked && r.checkbox.disabled,
  );
  if (jiraFilterActive) {
    return allRowsDone && exportBtn.style.display !== "none";
  }
  return (
    allRowsDone &&
    Boolean(bulkIncludeAttachments?.checked && bulkIncludeAttachments.disabled) &&
    exportBtn.style.display !== "none"
  );
}

function updateListingControls() {
  const show =
    !excelFlowActive &&
    (jiraFilterActive || (Boolean(activeListingSite) && listingHasSelection));
  setBulkAttachmentSectionVisible(show);
  listingImportBtn.style.display =
    show && !bulkBusy && !bulkSessionChecking && !listingSyncDoneState()
      ? "block"
      : "none";
  if (show && !listingSyncDoneState()) {
    listingImportLabel.textContent = jiraFilterActive
      ? "Sync selected Jira listing"
      : `Sync selected ${activeListingSite} listing`;
  }
}

export function applyListingState(listing, selectedCount) {
  setActiveListingSite(listing);
  setListingHasSelection(selectedCount > 0);
  updateClearAffordance(listing, selectedCount);
}

function bulkSystemLoginButton(system) {
  return system === "Spark" ? bulkSparkLoginBtn : bulkOctaneLoginBtn;
}

export function showBulkSystemLoginButtons(required) {
  let any = false;
  for (const { system, url, label } of required) {
    const btn = bulkSystemLoginButton(system);
    if (!btn) continue;
    const labelEl = btn.querySelector(".btn-label");
    if (labelEl) labelEl.textContent = label;
    btn.style.display = "block";
    btn.onclick = () => {
      chrome.tabs.create({ url });
    };
    any = true;
  }
  if (any) bulkView.classList.add("login-visible");
}

export function hideBulkSystemLoginButtons() {
  if (bulkSparkLoginBtn) bulkSparkLoginBtn.style.display = "none";
  if (bulkOctaneLoginBtn) bulkOctaneLoginBtn.style.display = "none";
  bulkView.classList.remove("login-visible");
}

const DROPZONE_ICON_EXCEL =
  '<rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M4 9.5h16M9.5 4v16M14.5 9.5V20" stroke="currentColor" stroke-width="1.8"/>';
const DROPZONE_ICON_CHECK =
  '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';

export function setDropzoneLoaded() {
  dropzone.dataset.loaded = "true";
  dropzoneTitle.textContent = "Upload Done";
  dropzoneIcon.innerHTML = DROPZONE_ICON_CHECK;

  setExcelFlowActive(true);
  setBulkRowsFromListing(false);

  hideLoginButtons();
  hideBulkSystemLoginButtons();

  updateClearAffordance(activeListingSite, listingHasSelection ? 1 : 0);
}

export function resetDropzone() {
  dropzone.dataset.loaded = "false";
  dropzoneTitle.textContent = "Choose an Excel file";
  dropzoneIcon.innerHTML = DROPZONE_ICON_EXCEL;
  dropzoneHint.innerHTML =
    "Octane: ID/Name/Description<br/>Spark: Number/Short description/Description";
  clearFileBtn.hidden = true;

  setExcelFlowActive(false);
}

export function clearFileUpload() {
  if (fileInput) fileInput.value = "";
  state.bulkRows = [];
  state.importData = null;
  state.importExt = null;
  if (previewBody) previewBody.innerHTML = "";
  if (previewSection) previewSection.style.display = "none";
  if (previewTitle) previewTitle.textContent = "Preview selected tickets";
  if (progressSection) progressSection.style.display = "none";
  hideBulkMediaProgress();
  if (exportBtn) exportBtn.style.display = "none";
  if (fileError) fileError.style.display = "none";
  if (fileSummary) fileSummary.textContent = "";
  selectAllLabel?.classList.add("hidden");
  unlockBulkImport();
  resetDropzone();
  setBulkRowsFromListing(false);
  updateSelectionCount();
  document.dispatchEvent(new CustomEvent("bulkflow-cleared"));
}

clearFileBtn?.addEventListener("click", clearFileUpload);

export function updateClearAffordance(listing, selectedCount) {
  if (!isExcelFlowActive()) {
    clearFileBtn.hidden = true;
    setClearHintVisible(false);
    return;
  }
  clearFileBtn.hidden = false;
  setClearHintVisible(Boolean(listing) && selectedCount > 0);
}

function setClearHintVisible(visible) {
  const hint = dropzoneHint.querySelector(".dropzone-clear-hint");
  if (!hint) return;
  hint.style.display = visible ? "" : "none";
  const br = hint.previousSibling;
  if (br && br.nodeName === "BR") br.style.display = visible ? "" : "none";
}

let selectionCountScheduled = false;

function updatePreviewTitle() {
  if (!previewTitle) return;
  previewTitle.textContent = `Preview selected tickets (${state.bulkRows.length})`;
}

export function updateSelectionCount() {
  if (selectionCountScheduled) return;
  selectionCountScheduled = true;
  requestAnimationFrame(() => {
    selectionCountScheduled = false;

    let selected = 0;
    let processed = 0;
    let selectable = 0;
    for (const r of state.bulkRows) {
      if (!r.checkbox.disabled) {
        selectable++;
        if (r.checkbox.checked) selected++;
      }
      const rowState = r.statusEl.dataset.state;
      if (
        rowState === "created" ||
        rowState === "exists" ||
        rowState === "error"
      ) {
        processed++;
      }
    }

    if (selected === 0) {
      selectionCount.textContent = "";
    } else {
      const processedLabel = processed > 0 ? `Processed ${processed}, ` : "";
      selectionCount.textContent = `${processedLabel}Selected ${selected} of ${state.bulkRows.length}`;
    }

    if (!state.bulkRows.length || importBtn.disabled) return;

    if (selectable === 0) {
      lockBulkImport();
      const allAlreadySynced = state.bulkRows.every((r) =>
        (r.statusEl.textContent || "").includes("attachments up to date"),
      );
      setStatus(
        jiraFilterActive
          ? "All set - Sync selected Jira listing"
          : bulkRowsFromListing
            ? allAlreadySynced
              ? "Selected attachments are already synced — nothing to sync."
              : "Bulk import done! Select rows on the listing page to sync more"
            : "Bulk import done! try different report",
        jiraFilterActive ? "info" : "success",
      );
    } else if (selected > 0) {

      unlockBulkImport();
      setStatus(
        jiraFilterActive
          ? "All set - Sync selected Jira listing"
          : bulkRowsFromListing
            ? "All set - Sync selected listing to continue"
            : "All set - Export selected tickets into JIRA",
        "info",
      );
    } else {

      importBtn.classList.add("hidden");
      setStatus(
        processed > 0
          ? bulkRowsFromListing
            ? "Select new items on the listing page to sync more"
            : "Select new items to continue create more"
          : jiraFilterActive
            ? "Select the issues on the Jira page to sync."
            : "Select the tickets to import.",
        "info",
      );
    }

    updateListingControls();
  });
}

export function toggleSelectAll() {
  state.bulkRows.forEach((r) => {
    if (!r.checkbox.disabled) r.checkbox.checked = selectAllCheckbox.checked;
  });
  updateSelectionCount();
  updateListingControls();
}

const isBulkRowDone = (r) =>
  r.statusEl.dataset.state === "created" || r.statusEl.dataset.state === "exists";

export function updateBulkSelectAllVisibility() {
  if (!selectAllLabel) return;
  const hasSelectable = state.bulkRows.some((r) => !isBulkRowDone(r));
  selectAllLabel.classList.toggle("hidden", !hasSelectable);
}

export function reorderBulkRowsAfterImport() {
  const done = [];
  const rest = [];
  state.bulkRows.forEach((r) => (isBulkRowDone(r) ? done : rest).push(r));
  state.bulkRows = [...done, ...rest];

  const fragment = document.createDocumentFragment();
  state.bulkRows.forEach((r) => {
    if (isBulkRowDone(r)) {
      r.checkbox.disabled = true;
      r.checkbox.checked = true;
      r.tr.classList.add("row-done");
    }
    fragment.appendChild(r.tr);
  });
  previewBody.appendChild(fragment);

  const allDone = state.bulkRows.every(isBulkRowDone);
  selectAllLabel?.classList.toggle("hidden", bulkBusy || allDone);

  updateSelectionCount();
}

export function setRowStatus(row, rowState, html) {
  row.statusEl.dataset.state = rowState;
  row.statusEl.innerHTML = sanitizeHtml(html);
  updateSelectionCount();
}
function createClampedCell(text, className) {
  const wrapper = document.createElement("div");
  wrapper.className = "clamp-cell";

  const span = document.createElement("span");
  span.className = `clamped ${className}`;
  span.textContent = text || "—";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "row-toggle";
  toggle.textContent = "more";
  toggle.style.display = "none";
  toggle.addEventListener("click", () => {
    const expanded = span.classList.toggle("expanded");
    wrapper.classList.toggle("expanded", expanded);
    toggle.textContent = expanded ? "less" : "more";
  });

  wrapper.append(span, toggle);
  return wrapper;
}

let clampUpdateScheduled = false;
function scheduleClampUpdate() {
  if (clampUpdateScheduled) return;
  clampUpdateScheduled = true;
  requestAnimationFrame(() => {
    clampUpdateScheduled = false;
    document.querySelectorAll(".clamp-cell").forEach((cell) => {
      const span = cell.querySelector(".clamped");
      const toggle = cell.querySelector(".row-toggle");
      if (!span || !toggle) return;
      const overflows = span.scrollHeight > span.clientHeight + 1;
      toggle.style.display = overflows ? "inline-flex" : "none";
    });
  });
}

let shiftSelectAnchor = null;

let lastShiftClick = false;

function buildBulkRow(record, site = "Octane") {
  const siteTag = String(site || "Octane").toUpperCase();
  const titleParts = [siteTag, record.idText, record.name].filter(Boolean);
  const title = record.title || titleParts.join(" | ");

  previewIdHeader.textContent = site === "Spark" ? "Number" : "ID";
  const isJiraFlow = site === "Jira";
  previewSourceHeader.classList.toggle("hidden", !isJiraFlow);
  const tr = document.createElement("tr");

  const checkTd = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkTd.appendChild(checkbox);

  const sourceTd = document.createElement("td");
  sourceTd.className = "row-source";
  if (isJiraFlow) {
    const sourceNumber = extractSourceNumberFromSummary(record.name);
    if (sourceNumber && isSafeHttpUrl(record.sourceUrl)) {
      const link = document.createElement("a");
      link.href = record.sourceUrl;
      link.title = `${sourceNumber} → ${record.sourceUrl}`;
      link.textContent = sourceNumber;
      link.rel = "noopener noreferrer";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: record.sourceUrl });
      });
      sourceTd.appendChild(link);
    } else {
      sourceTd.textContent = sourceNumber || "—";
    }
  } else {
    sourceTd.classList.add("hidden");
  }

  const idTd = document.createElement("td");
  idTd.className = "row-id";
  const linkUrl = record.idLink || record.sourceUrl;
  if (linkUrl && isSafeHttpUrl(linkUrl)) {
    const link = document.createElement("a");
    link.href = linkUrl;
    link.title = linkUrl;
    link.textContent = record.idText || linkUrl;
    link.rel = "noopener noreferrer";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: linkUrl });
    });
    idTd.appendChild(link);
  } else if (record.idLink) {
    idTd.textContent = record.idText || record.idLink;
  } else if (record.sourceUrl) {

    idTd.textContent = record.idText || record.sourceUrl;
  } else if (record.idText) {

    idTd.textContent = record.idText;
  } else {
    idTd.textContent = "—";
  }

  const titleTd = document.createElement("td");
  const titleEl = createClampedCell(title, "row-title");
  titleTd.appendChild(titleEl);

  const descTd = document.createElement("td");
  descTd.appendChild(createClampedCell(record.description, "row-desc"));

  const statusTd = document.createElement("td");
  statusTd.className = "row-status";
  statusTd.dataset.state = "pending";
  statusTd.textContent = "Not started";

  tr.append(checkTd, sourceTd, idTd, titleTd, descTd, statusTd);

  const row = {
    rowIndex: record.rowIndex,
    title,
    name: record.name,
    description: record.description,
    sourceUrl: record.sourceUrl,
    idText: record.idText,
    idLink: record.idLink,
    sourceText: extractSourceNumberFromSummary(record.name),
    site: String(site || "Octane"),
    checkbox,
    statusEl: statusTd,
    titleEl,
    tr,
  };
  state.bulkRows.push(row);

  row.checkbox.addEventListener("click", (e) => {
    lastShiftClick = e.shiftKey;
  });
  row.checkbox.addEventListener("change", () => {
    const rangeSelect = lastShiftClick;
    lastShiftClick = false;
    if (rangeSelect && shiftSelectAnchor && shiftSelectAnchor !== row) {
      const thisIndex = state.bulkRows.indexOf(row);
      const anchorIndex = state.bulkRows.indexOf(shiftSelectAnchor);
      if (thisIndex !== -1 && anchorIndex !== -1) {
        const start = Math.min(thisIndex, anchorIndex);
        const end = Math.max(thisIndex, anchorIndex);
        const checked = row.checkbox.checked;
        for (let i = start; i <= end; i++) {
          const r = state.bulkRows[i];
          if (!r.checkbox.disabled) r.checkbox.checked = checked;
        }
      }
    }
    shiftSelectAnchor = row;
    updateSelectionCount();
    updateListingControls();
  });

  return { tr, row };
}

let suppressPreviewReveal = false;

export function setSuppressPreviewReveal(suppress) {
  suppressPreviewReveal = Boolean(suppress);
}

export function addBulkRow(record, site = "Octane") {
  const { tr, row } = buildBulkRow(record, site);
  previewBody.appendChild(tr);
  if (!suppressPreviewReveal) {
    previewSection.style.display = "block";
    setBulkPreviewCollapsed(false);
  }
  selectAllLabel?.classList.toggle("hidden", bulkBusy);
  updatePreviewTitle();
  updateSelectionCount();
  scheduleClampUpdate();

  return row;
}

export function loadBulkRows(rows, site = "Octane") {
  previewBody.innerHTML = "";
  state.bulkRows = [];
  shiftSelectAnchor = null;

  const fragment = document.createDocumentFragment();
  for (const record of rows) {
    fragment.appendChild(buildBulkRow(record, site).tr);
  }
  previewBody.appendChild(fragment);

  previewSection.style.display = "block";
  setBulkPreviewCollapsed(false);
  selectAllLabel?.classList.toggle("hidden", bulkBusy);
  updatePreviewTitle();
  updateSelectionCount();
  scheduleClampUpdate();

  const revealImport = () => {
    smoothScrollToBottom();
    const focusTarget = importBtn.disabled ? selectAllCheckbox : importBtn;
    focusTarget?.focus?.({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(revealImport);
  } else {
    revealImport();
  }
}

previewCollapseBtn?.addEventListener("click", () => {
  setBulkPreviewCollapsed(
    !previewSection.classList.contains("preview-collapsed"),
  );
});
