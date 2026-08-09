import { formatBytes, escapeHtml, sanitizeHtml, truncateTextToFit } from "./util.js";
import {
  attachmentGroups,
  attachmentNote,
  attachmentPicker,
  attachmentPickerTitle,
  attachmentSelectAll,
  bulkAttachmentPicker,
  bulkView,
  createTicketBtn,
  gapArt,
  importBtn,
  includeAttachmentsInput,
  jiraBaseUrlInput,
  jiraSyncFlowActive,
  jiraToSparkSyncBtn,
  loginBtn,
  bulkLoginBtn,
  projectKeyInput,
  smoothScrollToBottom,
  sourceSiteInput,
  sourceSiteLabels,
  sourceSiteSwitch,
  state,
  statusDiv,
  statusText,
  ticketResult,
} from "./ui-dom.js";

export function expandAttachmentPicker(picker) {
  if (!picker) return;
  const busy =
    picker === bulkAttachmentPicker
      ? Boolean(importBtn?.disabled)
      : Boolean(createTicketBtn?.disabled);
  if (busy) return;
  picker.classList.remove("collapsed");
  picker
    .querySelector(".attachment-picker-collapse")
    ?.setAttribute("aria-expanded", "true");
}

export function getIncludeAttachments() {
  return Boolean(
    includeAttachmentsInput.checked || includeAttachmentsInput.indeterminate,
  );
}

export function setIncludeAttachments(checked) {
  includeAttachmentsInput.checked = Boolean(checked);
}

export function getSelectedAttachments() {
  return state.attachmentSelection;
}

export function setAttachmentPickerLoading() {
  attachmentPicker.hidden = false;
  expandAttachmentPicker(attachmentPicker);
  attachmentGroups.innerHTML = "";
  setAttachmentNote("");
  attachmentPickerHasNoAttachments = false;
  updateAttachmentSelectAll();
  updateAttachmentIncludeSyncState();
  setAttachmentSyncProgress(true);
  state.attachmentSelection = null;
}

export function clearAttachmentPicker() {
  attachmentPicker.hidden = true;
  attachmentGroups.innerHTML = "";
  setAttachmentNote("");
  attachmentPickerHasNoAttachments = false;
  setAttachmentSyncProgress(false);
  attachmentSelectAll.checked = true;
  state.attachmentSelection = null;

  syncedTicketFound = false;
  updateAttachmentIncludeSyncState();
}

export function setAttachmentSyncProgress(visible) {
  const el = document.getElementById("attachmentSyncProgress");
  if (!el) return;
  el.hidden = !visible;
}

let attachmentPickerHasNoAttachments = false;

let syncedTicketFound = false;

let ticketCardShown = false;

export function setSyncedTicketFound(found) {
  syncedTicketFound = Boolean(found);
  updateAttachmentIncludeSyncState();
}

export function resetTicketCard() {
  ticketCardShown = false;
  if (ticketResult) ticketResult.innerHTML = "";
  updateAttachmentIncludeSyncState();
}

export const MAX_ATTACHMENT_UPLOAD_BYTES = 26 * 1024 * 1024;

export function attachmentByteSize(item) {
  const bytes = Number(item?.sizeBytes);
  if (Number.isFinite(bytes) && bytes >= 0) return bytes;
  const m = /([\d.]+)\s*(KB|MB|GB)/i.exec(String(item?.size || ""));
  if (!m) return 0;
  const mult =
    m[2].toUpperCase() === "GB"
      ? 1024 ** 3
      : m[2].toUpperCase() === "MB"
        ? 1024 ** 2
        : 1024;
  return Number(m[1]) * mult;
}

export function itemSizeText(item) {
  const bytes = Number(item?.sizeBytes);
  if (Number.isFinite(bytes) && bytes > 0) return formatBytes(bytes);
  return String(item?.size || "");
}

export function setAttachmentNote(message) {
  if (!attachmentNote) return;
  attachmentNote.hidden = !message;
  attachmentNote.textContent = message || "";
}

export function refreshSingleViewStatus() {
  if (bulkView.hidden) {
    if (jiraSyncFlowActive) {
      setStatus("Sync updates with Spark", "info");
      return;
    }
    const configured =
      jiraBaseUrlInput.value.trim() && projectKeyInput.value.trim();
    setStatus(
      configured
        ? "All set - Export current ticket into JIRA"
        : "Configure Jira details and create a ticket.",
      "info",
    );
  }
}
const ATTACHMENT_GROUP_LABELS = { video: "Video", image: "Image", other: "Other" };

export function renderAttachmentPicker(items, syncedNames = new Set()) {
  attachmentPicker.hidden = false;
  expandAttachmentPicker(attachmentPicker);
  attachmentGroups.innerHTML = "";
  attachmentPickerHasNoAttachments = false;
  state.attachmentSelection = [];
  if (attachmentPickerTitle) {
    attachmentPickerTitle.textContent = `Choose attachments to upload (${items.length})`;
  }

  const grouped = { video: [], image: [], other: [] };
  for (const item of items) {
    const type =
      item.type === "video" || item.type === "image" ? item.type : "other";
    grouped[type].push(item);
  }

  let anyFiles = false;
  for (const [type, list] of Object.entries(grouped)) {
    if (!list.length) continue;
    anyFiles = true;
    const group = document.createElement("div");
    group.className = "attachment-group";

    const groupSize = formatBytes(
      list.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0),
    );

    const title = document.createElement("div");
    title.className = "attachment-group-title";
    title.textContent = `${ATTACHMENT_GROUP_LABELS[type]} (${list.length})${groupSize && groupSize !== "0 B" ? ` · ${groupSize}` : ""}`;
    group.appendChild(title);

    for (const item of list) {
      const alreadySynced = syncedNames.has(item.name);

      if (!alreadySynced) state.attachmentSelection.push(item.name);
      const row = document.createElement("label");
      row.className = "attachment-item" + (alreadySynced ? " attachment-item-synced" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.name = item.name;
      if (alreadySynced) {
        checkbox.disabled = true;
        checkbox.title = "Already synced — will be skipped on sync";
      }
      checkbox.addEventListener("change", () => {
        if (alreadySynced) return;
        const selected = state.attachmentSelection || [];
        state.attachmentSelection = checkbox.checked
          ? [...selected, item.name]
          : selected.filter((n) => n !== item.name);
        updateAttachmentSelectAll();
        updateAttachmentIncludeSyncState();
      });

      const name = document.createElement("span");
      name.className = "attachment-item-name";
      name.textContent = item.name + (alreadySynced ? " · synced" : "");
      const tip = [];
      if (item.description) tip.push(item.description);
      const sizeText = itemSizeText(item);
      if (sizeText) tip.push(`Size: ${sizeText}`);
      name.title = tip.join("\n") || item.name;

      const size = document.createElement("span");
      size.className = "attachment-item-size";
      size.textContent = sizeText;

      row.append(checkbox, name, size);
      group.appendChild(row);
    }

    attachmentGroups.appendChild(group);
  }

  attachmentGroups.querySelectorAll(".attachment-item-name").forEach(truncateTextToFit);

  if (!anyFiles) {
    attachmentGroups.innerHTML =
      '<div class="attachment-group-title">No attachments found.</div>';
    attachmentPickerHasNoAttachments = true;
  }

  updateAttachmentSelectAll();
  updateAttachmentIncludeSyncState();
}

let singleBusy = false;

function updateAttachmentSelectAll() {
  if (!attachmentSelectAll) return;
  const allBoxes = attachmentGroups.querySelectorAll(
    ".attachment-item input[type='checkbox']",
  );

  const boxes = attachmentGroups.querySelectorAll(
    ".attachment-item:not(.attachment-item-synced) input[type='checkbox']",
  );

  const toggle = attachmentSelectAll.closest(".attachment-picker-toggle");
  toggle?.classList.toggle("hidden", singleBusy || boxes.length === 0);
  let checked = 0;
  for (const box of boxes) if (box.checked) checked++;

  if (boxes.length === 0) {

    attachmentSelectAll.checked = allBoxes.length > 0;
    attachmentSelectAll.disabled = allBoxes.length > 0;
    attachmentSelectAll.indeterminate = false;
    return;
  }
  attachmentSelectAll.disabled = false;
  attachmentSelectAll.checked = checked > 0 && checked === boxes.length;
  attachmentSelectAll.indeterminate = checked > 0 && checked < boxes.length;
}

export function updateAttachmentIncludeSyncState() {
  if (!includeAttachmentsInput) return;
  const allBoxes = attachmentGroups.querySelectorAll(
    ".attachment-item input[type='checkbox']",
  );
  const boxes = attachmentGroups.querySelectorAll(
    ".attachment-item:not(.attachment-item-synced) input[type='checkbox']",
  );
  const total = allBoxes.length;
  let covered = 0;
  for (const box of allBoxes) if (box.checked) covered++;

  if (total > 0) {
    includeAttachmentsInput.indeterminate = covered > 0 && covered < total;
    includeAttachmentsInput.checked = covered === total;
  } else {
    includeAttachmentsInput.indeterminate = false;
  }

  const allSynced =
    attachmentPickerHasNoAttachments ||
    (total > 0 && boxes.length === 0);

  const fullySyncedTicket = syncedTicketFound && allSynced && ticketCardShown;
  const buttonGroup = createTicketBtn?.closest(".button-group");
  if (buttonGroup) {
    buttonGroup.style.display = fullySyncedTicket ? "none" : "";
  }
  if (fullySyncedTicket) {
    setStatus("Ticket fully synced! try new one.", "success");
  }
}

export function markAttachmentsSynced(uploadedNames) {
  if (!attachmentGroups || !uploadedNames?.length) return;
  for (const name of uploadedNames) {
    const box = attachmentGroups.querySelector(
      `.attachment-item input[type='checkbox'][data-name="${CSS.escape(name)}"]`,
    );
    if (!box) continue;
    const row = box.closest(".attachment-item");
    if (row.classList.contains("attachment-item-synced")) continue;
    box.checked = true;
    box.disabled = true;
    box.title = "Already on Jira — will be skipped on sync";
    row.classList.add("attachment-item-synced");
    const nameEl = row.querySelector(".attachment-item-name");
    if (nameEl && !nameEl.textContent.includes("synced")) {
      nameEl.textContent = `${name} · synced`;
    }
    const selected = state.attachmentSelection || [];
    state.attachmentSelection = selected.filter((n) => n !== name);
  }
  updateAttachmentSelectAll();
  updateAttachmentIncludeSyncState();
}
export function getSourceSite() {
  return sourceSiteInput.checked ? "Spark" : "Octane";
}

export function setSourceSite(site) {
  sourceSiteInput.checked = site === "Spark";
  sourceSiteLabels.forEach((label) =>
    label.classList.toggle("active", label.dataset.site === site),
  );
}

export function setSourceSiteLocked(locked) {
  sourceSiteInput.disabled = locked;
  const current = getSourceSite();
  sourceSiteLabels.forEach((label) => {
    label.disabled = locked && label.dataset.site !== current;
  });
  document.querySelector(".site-toggle")?.classList.toggle("locked", locked);
}

export function setSourceSiteVisible(visible) {
  sourceSiteSwitch
    .closest(".field-block")
    ?.classList.toggle("hidden", !visible);
  gapArt?.classList.toggle("hidden", visible);
}
export function setStatus(message, status = "info") {
  statusText.textContent = message;
  statusDiv.dataset.state = status;

  if (status === "loading") {
    smoothScrollToBottom();
  }
}

export function setBusy(isBusy) {
  singleBusy = Boolean(isBusy);
  createTicketBtn.disabled = isBusy;
  createTicketBtn.dataset.loading = isBusy ? "true" : "false";
  jiraToSparkSyncBtn.disabled = isBusy;
  jiraToSparkSyncBtn.dataset.loading = isBusy ? "true" : "false";
  jiraBaseUrlInput.disabled = isBusy;
  projectKeyInput.disabled = isBusy;
  includeAttachmentsInput.disabled = isBusy;
  if (isBusy) collapseAttachmentPickers();
  updateAttachmentSelectAll();

  if (!isBusy) updateAttachmentIncludeSyncState();
}

export function getBusy() {
  return singleBusy;
}

export function collapseAttachmentPickers() {
  for (const picker of [attachmentPicker, bulkAttachmentPicker]) {
    if (!picker || picker.hidden) continue;
    picker.classList.add("collapsed");
    picker
      .querySelector(".attachment-picker-collapse")
      ?.setAttribute("aria-expanded", "false");
  }
}
export function renderTicketCard(issueKey, issueUrl) {
  const safeKey = escapeHtml(issueKey);
  const safeUrl = escapeHtml(issueUrl);

  ticketResult.innerHTML = sanitizeHtml(`
        <div class="ticket-card">
          <div class="ticket-key">
            <a id="jiraIssueLink" href="${safeUrl}" target="_blank" rel="noopener noreferrer">
              ${safeKey}
            </a>
          </div>
          <div class="ticket-url">
            <a id="jiraUrlLink" href="${safeUrl}" target="_blank" rel="noopener noreferrer">
              ${safeUrl}
            </a>
          </div>
        </div>
      `);

  ["jiraIssueLink", "jiraUrlLink"].forEach((id) => {
    const link = document.getElementById(id);
    link?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: issueUrl });
    });
  });

  ticketCardShown = true;
  updateAttachmentIncludeSyncState();
}

export function showLoginButton(url, label = "Log in to Jira") {
  const btn = bulkView.hidden ? loginBtn : bulkLoginBtn;
  const labelEl = btn.querySelector(".btn-label");
  if (labelEl) labelEl.textContent = label;
  btn.style.display = "block";
  btn.focus();
  btn.scrollIntoView({ block: "nearest" });
  if (btn === loginBtn) {
    createTicketBtn.closest(".button-group")?.classList.add("login-visible");
  } else {
    bulkView.classList.add("login-visible");
  }
  btn.onclick = () => {
    chrome.tabs.create({ url });
  };
}

export function hideLoginButtons() {
  loginBtn.style.display = "none";
  bulkLoginBtn.style.display = "none";
  createTicketBtn.closest(".button-group")?.classList.remove("login-visible");
  bulkView.classList.remove("login-visible");
}

export function redirectToLogin(jiraBaseUrl, projectKey) {
  setStatus("Jira login required.", "error");
  showLoginButton(
    projectKey ? `${jiraBaseUrl}/browse/${projectKey}` : jiraBaseUrl,
  );
}
