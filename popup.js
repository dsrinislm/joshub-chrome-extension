import "./libraries/jira-adf.cjs";

import {
  tabSingle,
  tabBulk,
  selectAllCheckbox,
  fileInput,
  importBtn,
  exportBtn,
  jiraBaseUrlInput,
  projectKeyInput,
  bulkView,
  createTicketBtn,
  createTicketLabel,
  singleAttachments,
  sourceSiteInput,
  sourceSiteLabels,
  setSourceSite,
  setSourceSiteLocked,
  setSourceSiteVisible,
  setSingleTabEnabled,
  setBusy,
  getBusy,
  setStatus,
  switchView,
  toggleSelectAll,
  updateBulkStatusMessage,
  syncListingControls,
  abortImportBtn,
  listingImportBtn,
  getActiveListingSite,
  getSourceSite,
  getIncludeAttachments,
  setIncludeAttachments,
  getSelectedAttachments,
  setAttachmentPickerLoading,
  clearAttachmentPicker,
  renderAttachmentPicker,
  setAttachmentSyncProgress,
  setSyncedTicketFound,
  resetTicketCard,
  attachmentPickerTitle,
  attachmentGroups,
  includeAttachmentsInput,
  state,
  smoothScrollToBottom,
  revealStatus,
  previewBody,
  previewSection,
  syncAbortBtn,
  finishSyncProgress,
  refreshSingleViewStatus,
  setAttachmentNote,
  attachmentByteSize,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  getBulkIncludeAttachments,
  setBulkPreviewCollapsed,
  setBulkRowsFromListing,
  setSuppressPreviewReveal,
  setBulkAttachmentPickerLoading,
  clearBulkAttachmentPicker,
  renderBulkAttachmentPicker,
  bulkAttachmentPickerTitle,
  setBulkAttachmentNote,
  setBulkAttachmentSyncProgress,
  markBulkRowsFullySynced,
  isExcelFlowActive,
  applyListingState,
  getListingHasSelection,
  scrollBulkToFirstSelected,
  bulkAttachmentGroups,
  bulkIncludeAttachments,
  jiraToSparkSyncBtn,
  setJiraToSparkVisible,
  setJiraSyncFlowActive,
  markAttachmentsSynced,
  setJiraFilterActive,
  isJiraFilterActive,
  isBulkBusy,
  setBulkSessionChecking,
  showLoginButton,
  hideLoginButtons,
  showBulkSystemLoginButtons,
  hideBulkSystemLoginButtons,
} from "./components/ui.js";
import { debounce } from "./components/util.js";
import {
  listTicketAttachmentsInTab,
  listListingAttachmentsInTab,
  scrapeSelectedListingInTab,
  scrapeSelectedSparkListingInTab,
  detectTabState,
  scrapeTab,
  getCurrentTab,
} from "./components/scrape.js";
import { runJiraApiInTab } from "./components/scrape-detect.js";
import { startGapArt } from "./components/gap-art.js";
import { handleFileSelected, downloadPreviewReport } from "./components/excel.js";
import { loadInitialState, saveSettings } from "./components/storage.js";
import {
  enforceJiraBaseUrlNoPath,
  clearJiraBaseUrlErrorIfNowValid,
  validateJiraBaseUrlField,
  debouncedValidateBulkProjectKey,
  extractJiraIssueDetailsFromBaseUrl,
  getJiraContext,
} from "./components/validation.js";
import {
  findExistingJiraIssueFor,
  getJiraIssueWithAttachments,
  listIssueAttachmentsDetailed,
} from "./components/api.js";
import { ensureJiraReady } from "./components/session.js";
import { extractSourceUrl } from "./components/adf.js";
import { createTicket, setSparkToJiraLookupCache } from "./components/single-ticket.js";
import {
  runBulkImport,
  runListingImport,
  runJiraFilterImport,
  loadJiraFilterRows,
  refreshJiraFilterSelection,
  requestAbort,
} from "./components/bulk-import.js";
import { requestUploadCancel } from "./components/attachments.js";
import {
  detectJiraIssueInTab,
  detectJiraPageInTab,
  syncJiraUpdates,
  getSyncAttachmentItems,
  fetchSparkAttachmentItemsInOrigin,
  parseSourceUrl,
} from "./components/jira-to-spark.js";
import {
  getSyncOctaneAttachmentItems,
  syncOctaneUpdates,
  checkOctaneAccess,
} from "./components/jira-to-octane.js";

const debouncedSaveSettings = debounce(saveSettings, 300);

let jiraFlowActive = false;
let detectionLocked = false;
let cachedJiraSyncData = null;

function sourceSiteLabel(description) {
  const url = extractSourceUrl(description || "");
  return url &&
    /entityType=work_item|shared_spaces|#\/entity-navigation/.test(url)
    ? "Octane"
    : "Spark";
}

loadInitialState();
startGapArt();

tabSingle.addEventListener("click", () => switchView("single"));
tabBulk.addEventListener("click", () => switchView("bulk"));
selectAllCheckbox.addEventListener("change", toggleSelectAll);
fileInput.addEventListener("change", handleFileSelected);
importBtn.addEventListener("click", () => {

  scrollBulkToFirstSelected();
  runBulkImport();
});
listingImportBtn.addEventListener("click", () => {
  if (isJiraFilterActive()) {
    runJiraFilterImport();
  } else {
    runListingImport(getActiveListingSite());
  }
});
exportBtn.addEventListener("click", downloadPreviewReport);

jiraBaseUrlInput.addEventListener("input", (e) => {

  extractJiraIssueDetailsFromBaseUrl();
  enforceJiraBaseUrlNoPath();
  clearJiraBaseUrlErrorIfNowValid();
  debouncedSaveSettings();
  if (
    e.inputType === "insertFromPaste" &&
    jiraBaseUrlInput.value.trim() &&
    projectKeyInput.value.trim()
  ) {

    if (!bulkView.hidden) {
      if (!isExcelFlowActive() && getActiveListingSite() && getListingHasSelection()) {
        listingImportBtn.focus();
      } else {
        fileInput.focus();
      }
    } else {
      createTicketBtn.focus();
    }
  }
});

jiraBaseUrlInput.addEventListener("blur", () => {
  const result = validateJiraBaseUrlField();
  if (result?.valid) promptCreateTicketWhenReady();
});
projectKeyInput.addEventListener("blur", promptCreateTicketWhenReady);
projectKeyInput.addEventListener("input", debouncedSaveSettings);

function promptCreateTicketWhenReady() {
  refreshSingleViewStatus();
}

function resetSinglePromptIfIncomplete() {
  if (bulkView.hidden) {
    const configured =
      jiraBaseUrlInput.value.trim() && projectKeyInput.value.trim();
    if (!configured) {
      setStatus("Configure Jira details and create a ticket.", "info");
    }
  }
}

[jiraBaseUrlInput, projectKeyInput].forEach((input) =>
  input.addEventListener("input", () => {
    if (bulkView.hidden) {
      resetSinglePromptIfIncomplete();
    } else {
      updateBulkStatusMessage();
      debouncedValidateBulkProjectKey();
    }
  }),
);
createTicketBtn.addEventListener("click", () => {
  if (jiraFlowActive) {
    runSyncUpdates();
  } else {
    createTicket();
  }
});

jiraToSparkSyncBtn.addEventListener("click", runSyncUpdates);

async function runSyncUpdates() {
  hideLoginButtons();
  const ctx = getJiraContext();
  const issue = await detectJiraIssueInTab().catch(() => null);
  if (!ctx) return;
  if (!issue?.key) {
    setStatus("Open a Jira ticket to sync its updates with Spark.", "info");
    return;
  }
  if (ctx.jiraOrigin !== issue.origin) {
    setStatus(
      `This Jira (${issue.origin}) doesn't match the configured base URL (${ctx.jiraOrigin}). Update the Jira base URL and retry.`,
      "error",
    );
    return;
  }

  setBusy(true);
  detectionLocked = true;
  try {
    setStatus(`Syncing updates for ${issue.key}...`, "loading");
    const flowSite = sourceSiteLabel(
      cachedJiraSyncData?.issue?.fields?.description,
    );
    const isOctane = flowSite === "Octane";
    const syncResult = isOctane
      ? await syncOctaneUpdates({
          jiraOrigin: ctx.jiraOrigin,
          issueKey: issue.key,
          includeAttachments: getIncludeAttachments(),
          selectedAttachments: getIncludeAttachments()
            ? getSelectedAttachments()
            : null,
          cachedJiraData: cachedJiraSyncData,
        })
      : await syncJiraUpdates({
          jiraOrigin: ctx.jiraOrigin,
          issueKey: issue.key,
          includeAttachments: getIncludeAttachments(),
          selectedAttachments: getIncludeAttachments()
            ? getSelectedAttachments()
            : null,
          cachedJiraData: cachedJiraSyncData,
        });
    const { report, sparkToJira, attachments, attachmentsToSpark, sourceUrl } =
      syncResult;
    if (cachedJiraSyncData && Array.isArray(attachmentsToSpark?.uploadedNames)) {
      cachedJiraSyncData.syncedNames = [
        ...new Set([
          ...(cachedJiraSyncData.syncedNames || []),
          ...attachmentsToSpark.uploadedNames,
        ]),
      ];
    }
    const via = String(report.mode || "").startsWith("spark tab")
      ? " (via Spark tab)"
      : "";
    const bits = [];
    if (report.posted > 0) {
      bits.push(`${report.posted} Jira comment(s) synced to ${flowSite}`);
    } else if (report.failed > 0) {
      bits.push(`${report.failed} Jira comment(s) failed to sync to ${flowSite}`);
    } else {
      bits.push(`Jira comments up to date in ${flowSite}`);
    }
    if (sparkToJira?.added > 0) {
      bits.push(`${sparkToJira.added} ${flowSite} comment(s) synced to Jira`);
    } else {
      bits.push(`${flowSite} comments up to date in Jira`);
    }
    if (attachments?.uploaded > 0) {
      bits.push(`${attachments.uploaded} attachment(s) synced to Jira`);
    } else if (attachments?.failed > 0) {
      bits.push(`${attachments.failed} attachment(s) failed to sync to Jira`);
    } else if (attachments?.skipped > 0) {
      bits.push("attachments up to date in Jira");
    }
    if (attachmentsToSpark?.uploaded > 0) {
      bits.push(`${attachmentsToSpark.uploaded} attachment(s) synced to ${flowSite}`);
    } else if (attachmentsToSpark?.failed > 0) {
      const names = (attachmentsToSpark.failedNames || []).join(", ");
      bits.push(
        `${attachmentsToSpark.failed} attachment(s) failed to sync to ${flowSite}${names ? `: ${names}` : ""}`,
      );
    } else if (attachmentsToSpark?.skipped > 0) {
      bits.push(`attachments up to date in ${flowSite}`);
    }
    const failed =
      report.failed > 0 ||
      attachments?.failed > 0 ||
      attachmentsToSpark?.failed > 0;
    const uploadedNames = [
      ...(attachments?.uploadedNames || []),
      ...(attachmentsToSpark?.uploadedNames || []),
    ];
    if (uploadedNames.length) {
      markAttachmentsSynced(uploadedNames);
    }
    if (!failed) {
      const buttonGroup = createTicketBtn?.closest(".button-group");
      if (buttonGroup) {
        buttonGroup.style.display = "none";
      }
      setStatus("Ticket fully synced! try new one.", "success");
      return;
    }
    if (report.loginWall) {
      const notSynced =
        (attachmentsToSpark?.failed || 0) + (attachments?.failed || 0);
      setStatus(
        `Spark login required.${notSynced ? ` ${notSynced} attachment(s) not synced.` : ""}`,
        "error",
      );
      showLoginButton(
        sourceUrl || report.url || "https://service-now.com",
        "Log in to Spark",
      );
      return;
    }
    const attachmentError = attachmentsToSpark?.firstError
      ? ` ${attachmentsToSpark.firstError}`
      : "";
    setStatus(
      `${issue.key}: ${bits.join("; ")}${via}.${attachmentError}`,
      failed ? "error" : "success",
    );
  } catch (error) {
    setStatus(error.message || "Failed to sync updates.", "error");
  } finally {
    finishSyncProgress();
    setBusy(false);
    detectionLocked = false;
    revealStatus();
  }
}

function attachmentType(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpeg", "mpg"].includes(ext)) {
    return "video";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "ico"].includes(ext)) {
    return "image";
  }
  return "other";
}

includeAttachmentsInput.addEventListener("change", async () => {
  if (!getIncludeAttachments()) {
    clearAttachmentPicker();
    setStatus("Attachments skipped.", "info");
    return;
  }

  const jiraConfigured =
    jiraBaseUrlInput.value.trim() && projectKeyInput.value.trim();
  if (!jiraFlowActive) {
    const ctx = getJiraContext();
    if (!ctx) {
      setIncludeAttachments(false);
      setStatus("Configure Jira details to sync attachments.", "error");
      showLoginButton(
        jiraBaseUrlInput.value.trim() || "https://id.atlassian.com",
        "Log in to Jira",
      );
      return;
    }
    const ready = await ensureJiraReady(ctx.jiraOrigin, ctx.projectKey);
    if (!ready) {
      setIncludeAttachments(false);
      return;
    }
    hideLoginButtons();
  } else if (!jiraConfigured) {
    setIncludeAttachments(false);
    setStatus("Configure Jira details to sync attachments.", "error");
    return;
  }

  setStatus("Loading attachments...", "loading");
  setAttachmentPickerLoading();
  smoothScrollToBottom();
  detectionLocked = true;

  if (jiraFlowActive) {
    try {
      const ctx = getJiraContext();
      const issue = await detectJiraIssueInTab().catch(() => null);
      if (!ctx || !issue?.key) {
        clearAttachmentPicker();
        return;
      }
      const isOctane =
        sourceSiteLabel(cachedJiraSyncData?.issue?.fields?.description) ===
        "Octane";
      const { items, syncedNames, loginRequired, sparkOrigin, issue: pickedIssue, attachments, note } =
        isOctane
          ? await getSyncOctaneAttachmentItems({
              jiraOrigin: ctx.jiraOrigin,
              issueKey: issue.key,
              cachedJiraData: cachedJiraSyncData,
            })
          : await getSyncAttachmentItems({
              jiraOrigin: ctx.jiraOrigin,
              issueKey: issue.key,
              cachedJiraData: cachedJiraSyncData,
            });
      cachedJiraSyncData = { issue: pickedIssue, attachments, syncedNames };
      if (!getIncludeAttachments()) return;
      if (loginRequired) {
        setSyncedTicketFound(false);
        setStatus("Not logged in to Spark — log in and retry.", "error");
        attachmentGroups.innerHTML =
          '<div class="attachment-group-title">Not logged in to Spark — log in and retry.</div>';
        if (attachmentPickerTitle) {
          attachmentPickerTitle.textContent = "Choose attachments to upload (0)";
        }
        showLoginButton(
          sparkOrigin || "https://service-now.com",
          "Log in to Spark",
        );
        smoothScrollToBottom();
        return;
      }
      renderAttachmentPicker(items, syncedNames);
      setAttachmentNote(note || "");
      setStatus("Choose attachments to upload.", "info");
      smoothScrollToBottom();
    } catch {
      setSyncedTicketFound(false);
      setStatus("Couldn't list attachments.", "error");
      attachmentGroups.innerHTML =
        '<div class="attachment-group-title">Couldn’t list attachments.</div>';
      if (attachmentPickerTitle) {
        attachmentPickerTitle.textContent = "Choose attachments to upload (0)";
      }
      smoothScrollToBottom();
    } finally {
      setAttachmentSyncProgress(false);
      detectionLocked = false;
    }
    return;
  }

  try {
    const items = await listTicketAttachmentsInTab(getSourceSite());
    if (!getIncludeAttachments()) return;

    let syncedNames = new Set();
    let jiraItems = [];
    let foundTicket = false;
    const ctx = getJiraContext();
    if (ctx) {
      const currentTab = await getCurrentTab();
      const pageData = await scrapeTab(currentTab.id, getSourceSite(), {
        includeAttachments: false,
        captureAttachments: false,
        captureEmbeddedImages: false,
      }).catch(() => null);
      if (pageData?.title) {
        const found = await findExistingJiraIssueFor(
          ctx.jiraOrigin,
          ctx.projectKey,
          pageData.title,
          pageData.url,
        );
        setSparkToJiraLookupCache({
          jiraOrigin: ctx.jiraOrigin,
          projectKey: ctx.projectKey,
          url: pageData.url,
          existing: found,
        });
        if (found.issue) {
          foundTicket = true;
          try {
            const combined = await getJiraIssueWithAttachments(
              ctx.jiraOrigin,
              found.issue.key,
            );
            jiraItems = combined.attachments;
            setSparkToJiraLookupCache({
              jiraOrigin: ctx.jiraOrigin,
              projectKey: ctx.projectKey,
              url: pageData.url,
              existing: found,
              combined,
            });
          } catch {
            jiraItems = [];
          }
        }
      }
    }
    setSyncedTicketFound(foundTicket);
    if (!getIncludeAttachments()) return;

    const byName = new Map();
    for (const item of items) {
      byName.set(item.name, { ...item, source: "Spark" });
    }
    for (const j of jiraItems) {
      const size = Number(j.size);
      const normalized = {
        ...j,
        type: attachmentType(j.name),
        sizeBytes:
          Number.isFinite(size) && size >= 0 ? size : null,
        url: `${ctx?.jiraOrigin}/rest/api/3/attachment/content/${encodeURIComponent(j.id)}`,
      };
      if (byName.has(j.name)) {
        const spark = byName.get(j.name);
        const sparkSize = spark.sizeBytes ?? null;
        const sameSize =
          sparkSize == null || normalized.sizeBytes == null
            ? true
            : sparkSize === normalized.sizeBytes;
        const merged = { ...spark, inJira: sameSize };
        if (
          (merged.sizeBytes == null || merged.sizeBytes <= 0) &&
          normalized.sizeBytes != null &&
          normalized.sizeBytes > 0
        ) {
          merged.sizeBytes = normalized.sizeBytes;
        }
        byName.set(j.name, merged);
      } else {
        byName.set(j.name, { ...normalized, source: "Jira" });
      }
    }
    const mergedItems = Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    syncedNames = new Set(
      mergedItems.filter((i) => i.inJira).map((i) => i.name),
    );
    const overLimitNames = new Set(
      items
        .filter((item) => attachmentByteSize(item) > MAX_ATTACHMENT_UPLOAD_BYTES)
        .map((item) => item.name),
    );
    const renderItems = mergedItems.filter(
      (item) =>
        item.inJira ||
        item.source !== "Spark" ||
        !overLimitNames.has(item.name),
    );
    const skipped = mergedItems.filter(
      (item) =>
        !item.inJira &&
        item.source === "Spark" &&
        overLimitNames.has(item.name),
    ).length;
    const note = skipped
      ? `${skipped} file(s) over 25 MB skipped — add them from the Jira UI.`
      : "";
    renderAttachmentPicker(renderItems, syncedNames);
    setAttachmentNote(note);
    setStatus("Choose attachments to upload.", "info");
    smoothScrollToBottom();
  } catch {
    setSyncedTicketFound(false);
    setStatus("Couldn't list attachments.", "error");
    attachmentGroups.innerHTML =
      '<div class="attachment-group-title">Couldn’t list attachments.</div>';
    if (attachmentPickerTitle) {
      attachmentPickerTitle.textContent = "Choose attachments to upload (0)";
    }
    smoothScrollToBottom();
  } finally {
    setAttachmentSyncProgress(false);
    detectionLocked = false;
  }
});

bulkIncludeAttachments.addEventListener("change", async () => {
  if (isJiraFilterActive()) {
    if (!getBulkIncludeAttachments()) {
      clearBulkAttachmentPicker();
      setBulkPreviewCollapsed(false);
      hideBulkSystemLoginButtons();
      return;
    }

    setSuppressPreviewReveal(true);
    try {
      if (!state.bulkRows.length) {
        await loadJiraFilterRows();
        if (!state.bulkRows.length) {
          bulkIncludeAttachments.checked = false;
          bulkIncludeAttachments.indeterminate = false;
          clearBulkAttachmentPicker();
          return;
        }
      }

      await refreshJiraFilterSelection();
    } finally {
      setSuppressPreviewReveal(false);
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

    const seenRows = new Set();
    const selectedRows = state.bulkRows.filter((r) => {
      if (!r.checkbox.checked) return false;
      const k = String(r.idText || "").trim().toUpperCase();
      if (seenRows.has(k)) return false;
      seenRows.add(k);
      return true;
    });
    if (!selectedRows.length) {
      bulkIncludeAttachments.checked = false;
      bulkIncludeAttachments.indeterminate = false;
      setStatus("Select the issues on the Jira page to sync.", "error");
      clearBulkAttachmentPicker();
      return;
    }

    hideBulkSystemLoginButtons();
    const neededSystems = new Map();
    for (const row of selectedRows) {
      const sourceUrl = String(row.sourceUrl || "").trim();
      if (!sourceUrl) continue;
      const system = /entityType=work_item|shared_spaces|#\/entity-navigation/.test(
        sourceUrl,
      )
        ? "Octane"
        : "Spark";
      if (!neededSystems.has(system)) neededSystems.set(system, sourceUrl);
    }

    if (neededSystems.size) {
      const checkToggle = bulkIncludeAttachments.closest(".attach-toggle");
      bulkIncludeAttachments.checked = false;
      bulkIncludeAttachments.indeterminate = true;
      bulkIncludeAttachments.disabled = true;
      checkToggle?.classList.add("checking");
      setBulkSessionChecking(true);
      setStatus(
        `Checking ${Array.from(neededSystems.keys()).join(" and ")} access…`,
        "loading",
      );
      const missing = [];
      for (const [system, sourceUrl] of neededSystems) {
        let loginRequired = false;
        if (system === "Spark") {
          try {
            const { sparkOrigin, sysId } = parseSourceUrl(sourceUrl);
            const res = await fetchSparkAttachmentItemsInOrigin({
              sparkOrigin,
              sysId,
            });
            loginRequired = !res || Boolean(res.loginRequired);
          } catch {
            loginRequired = true;
          }
        } else {
          try {
            const octaneOrigin = new URL(sourceUrl).origin;
            const res = await checkOctaneAccess({
              octaneOrigin,
              sourceUrl,
            });
            loginRequired = !res || Boolean(res.loginRequired);
          } catch {
            loginRequired = true;
          }
        }
        if (loginRequired) missing.push({ system, url: sourceUrl });
      }
      bulkIncludeAttachments.disabled = false;
      checkToggle?.classList.remove("checking");
      setBulkSessionChecking(false);
      if (missing.length) {
        bulkIncludeAttachments.checked = false;
        bulkIncludeAttachments.indeterminate = false;
        showBulkSystemLoginButtons(
          missing.map(({ system, url }) => ({
            system,
            url,
            label: `Log in to ${system}`,
          })),
        );
        const names = missing.map((m) => m.system).join(" and ");
        setStatus(
          `Log in to ${names} to sync attachments with the selected Jira issues.`,
          "error",
        );
        smoothScrollToBottom();
        return;
      }
      bulkIncludeAttachments.checked = true;
      bulkIncludeAttachments.indeterminate = false;
      hideBulkSystemLoginButtons();
    }

    setBulkPreviewCollapsed(true);
    setBulkAttachmentPickerLoading();
    smoothScrollToBottom();

    try {
      let jiraOrigin = "";
      try {
        const tab = await getCurrentTab();
        jiraOrigin = new URL(tab?.url || "").origin;
      } catch {}

      const groups = [];
      const labels = {};
      const syncedMap = {};
      let skipped = 0;
      for (const row of selectedRows) {
        const key = String(row.idText || "").trim();
        if (!key) continue;
        let merged = [];
        let syncedNames = new Set();
        let jiraAttachments = [];
        let fetchedData = null;
        try {
          const fetched = await runJiraApiInTab({
            path: `/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment,description`,
          });
          fetchedData = fetched.data;
          jiraAttachments = Array.isArray(
            fetched?.data?.fields?.attachment,
          )
            ? fetched.data.fields.attachment
                .map((a) => {
                  const name = String(a.filename || "").trim();
                  const id = String(a.id || "").trim();
                  const size = Number(a.size);
                  return {
                    name,
                    id,
                    sizeBytes: size,
                    size,
                    mimeType: String(a.mimeType || ""),
                    type: attachmentType(name),
                    url: `${jiraOrigin}/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
                    source: "jira",
                  };
                })
                .filter((a) => a.name)
            : [];
        } catch {}

        const description = fetchedData?.fields?.description || "";
        const sourceUrl =
          String(row.sourceUrl || "").trim() || extractSourceUrl(description);
        if (sourceUrl) {
          const cachedJiraData = {
            issue: fetchedData,
            attachments: jiraAttachments,
          };
          try {
            const result = /entityType=work_item|shared_spaces|#\/entity-navigation/.test(
              sourceUrl,
            )
              ? await getSyncOctaneAttachmentItems({
                  jiraOrigin,
                  issueKey: key,
                  cachedJiraData,
                  sourceUrl,
                })
              : await getSyncAttachmentItems({
                  jiraOrigin,
                  issueKey: key,
                  cachedJiraData,
                  sourceUrl,
                });
            if (result?.items?.length) {
              merged = result.items.map((item) =>
                item.source === "Jira"
                  ? { ...item, source: "jira" }
                  : item,
              );
            } else {
              merged = jiraAttachments;
            }
            syncedNames = result?.syncedNames || new Set();
            skipped += result?.skipped || 0;
          } catch {
            merged = jiraAttachments;
          }
        } else {
          merged = jiraAttachments;
        }
        const listable = merged.filter(
          (a) =>
            !Number.isFinite(a.sizeBytes) ||
            a.sizeBytes <= MAX_ATTACHMENT_UPLOAD_BYTES,
        );
        skipped += merged.length - listable.length;
        groups.push({ id: key, attachments: listable });
        labels[key] = key;
        if (syncedNames.size) syncedMap[key] = syncedNames;
      }

      const fullySynced = fullySyncedIds(groups, syncedMap);
      renderBulkAttachmentPicker(groups, labels, syncedMap);
      markBulkRowsFullySynced(fullySynced);
      setBulkAttachmentNote(
        skipped
          ? `${skipped} file(s) over 25 MB skipped — add them from the Jira UI.`
          : "",
      );
      const allRowsFullySynced =
        state.bulkRows.length > 0 &&
        state.bulkRows.every((r) => r.checkbox.disabled);
      setStatus(
        allRowsFullySynced
          ? "All set - Sync selected Jira listing"
          : "Select which attachments to sync between Jira and the linked Octane/Spark tickets.",
        "info",
      );
      smoothScrollToBottom();
    } catch {
      setStatus("Couldn't list attachments for the selected issues.", "error");
      bulkAttachmentGroups.innerHTML =
        '<div class="attachment-group-title">Couldn’t list attachments.</div>';
      if (bulkAttachmentPickerTitle) {
        bulkAttachmentPickerTitle.textContent =
          "Choose attachments to upload (0)";
      }
      smoothScrollToBottom();
    } finally {
      setBulkAttachmentSyncProgress(false);
    }
    return;
  }

  if (!getBulkIncludeAttachments()) {
    clearBulkAttachmentPicker();
    setBulkPreviewCollapsed(false);
    setStatus("Attachments skipped.", "info");
    return;
  }

  setBulkPreviewCollapsed(true);

  const site = getActiveListingSite();
  if (!site) {
    setStatus("Open a Spark or Octane listing to choose attachments.", "error");
    clearBulkAttachmentPicker();
    return;
  }

  const ctx = getJiraContext();
  if (!ctx) {
    bulkIncludeAttachments.checked = false;
    bulkIncludeAttachments.indeterminate = false;
    setStatus("Configure Jira details to sync attachments.", "error");
    showLoginButton(
      jiraBaseUrlInput.value.trim() || "https://id.atlassian.com",
      "Log in to Jira",
    );
    return;
  }
  const ready = await ensureJiraReady(ctx.jiraOrigin, ctx.projectKey);
  if (!ready) {
    bulkIncludeAttachments.checked = false;
    bulkIncludeAttachments.indeterminate = false;
    return;
  }
  hideLoginButtons();

  setStatus("Loading attachments...", "loading");
  setBulkAttachmentPickerLoading();
  smoothScrollToBottom();

  try {
    const scrapedItems =
      site === "Spark"
        ? await scrapeSelectedSparkListingInTab()
        : await scrapeSelectedListingInTab();
    const seenItems = new Set();
    const items = scrapedItems.filter((item) => {
      const id = String(item?.id ?? "").trim();
      if (!id || seenItems.has(id)) return false;
      seenItems.add(id);
      return true;
    });
    if (!getBulkIncludeAttachments()) return;
    if (!items.length) {
      setStatus(
        `Tick the rows you want to import on the ${site} page, then enable attachments.`,
        "error",
      );
      bulkAttachmentGroups.innerHTML =
        '<div class="attachment-group-title">No rows selected on the listing page.</div>';
      if (bulkAttachmentPickerTitle) {
        bulkAttachmentPickerTitle.textContent = "Choose attachments to upload (0)";
      }
      smoothScrollToBottom();
      return;
    }

    const labels = {};
    for (const item of items) {
      labels[item.id] = site === "Spark" ? item.number || item.id : item.id;
    }

    const groups = await listListingAttachmentsInTab(
      items.map((i) => i.id),
      site,
    );
    if (!getBulkIncludeAttachments()) return;

    let skipped = 0;
    for (const group of groups) {
      const listable = (group.attachments || []).filter(
        (a) => attachmentByteSize(a) <= MAX_ATTACHMENT_UPLOAD_BYTES,
      );
      skipped += (group.attachments || []).length - listable.length;
      group.attachments = listable;
    }

    const note = skipped
      ? `${skipped} file(s) over 25 MB skipped — add them from the Jira UI.`
      : "";

    const { synced: syncedMap, sizes: jiraMeta } = await buildBulkSyncedMap(
      items,
      site,
    );
    if (!getBulkIncludeAttachments()) return;

    const fullySynced = fullySyncedIds(groups, syncedMap);

    if (site === "Octane" || site === "Spark") {
      for (const group of groups) {
        const sourceNames = new Set(
          (group.attachments || []).map((a) => a.name),
        );
        const jiraNames = syncedMap[String(group.id)] || new Set();
        const metaByName = new Map(
          (jiraMeta[String(group.id)] || []).map((a) => [a.name, a]),
        );
        const jiraOnly = Array.from(jiraNames)
          .filter((name) => !sourceNames.has(name))
          .map((name) => {
            const meta = metaByName.get(name) || {};
            const sizeBytes =
              Number.isFinite(meta.sizeBytes) && meta.sizeBytes > 0
                ? meta.sizeBytes
                : null;
            return {
              name,
              source: "jira",
              sizeBytes,
              size: sizeBytes == null ? "" : sizeBytes,
              type: attachmentType(name),
            };
          });
        if (jiraOnly.length) {
          group.attachments = (group.attachments || []).concat(jiraOnly);
        }
      }
    }

    renderBulkAttachmentPicker(groups, labels, syncedMap);
    setBulkAttachmentNote(note);
    markBulkRowsFullySynced(fullySynced);

    setStatus(
      "Attachments are checked against Jira during import — files already attached to existing tickets are skipped.",
      "info",
    );
    smoothScrollToBottom();
  } catch {
    setStatus("Couldn't list attachments for the selected rows.", "error");
    bulkAttachmentGroups.innerHTML =
      '<div class="attachment-group-title">Couldn’t list attachments.</div>';
    if (bulkAttachmentPickerTitle) {
      bulkAttachmentPickerTitle.textContent = "Choose attachments to upload (0)";
    }
    smoothScrollToBottom();
  } finally {
    setBulkAttachmentSyncProgress(false);
  }
});

async function buildBulkSyncedMap(items, site) {
  const ctx = getJiraContext();
  if (!ctx || !items.length) return { synced: {}, sizes: {} };
  const { jiraOrigin, projectKey } = ctx;
  const synced = {};
  const sizes = {};
  let next = 0;
  const MAX_CONCURRENCY = 4;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {

        const title = `${site.toUpperCase()} | ${item.number || item.id} | ${item.name || ""}`;
        if (!title) continue;
        const found = await findExistingJiraIssueFor(
          jiraOrigin,
          projectKey,
          title,
          item.url,
        );
        if (!found.issue) continue;
        const attachments = await listIssueAttachmentsDetailed(
          jiraOrigin,
          found.issue.key,
        );
        synced[String(item.id)] = new Set(
          attachments.map((a) => a.name),
        );
        sizes[String(item.id)] = attachments;
      } catch {

      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, worker),
  );
  return { synced, sizes };
}

function fullySyncedIds(groups, syncedMap) {
  return new Set(
    groups
      .filter((group) => {
        const files = group.attachments || [];
        const set = syncedMap[String(group.id)];
        return set && files.length > 0 && files.every((f) => set.has(f.name));
      })
      .map((group) => group.id),
  );
}

abortImportBtn.addEventListener("click", () => {
  requestAbort();
  abortImportBtn.disabled = true;
});

syncAbortBtn.addEventListener("click", () => {
  requestUploadCancel();
  syncAbortBtn.disabled = true;
});

sourceSiteInput.addEventListener("change", () => {
  setSourceSite(getSourceSite());
  debouncedSaveSettings();
});

sourceSiteLabels.forEach((label) =>
  label.addEventListener("click", () => {
    setSourceSite(label.dataset.site);
    debouncedSaveSettings();
  }),
);

function syncJiraContextFromTab(info) {
  let changed = false;
  if (info.origin && jiraBaseUrlInput.value.trim() !== info.origin) {
    jiraBaseUrlInput.value = info.origin;
    changed = true;
  }
  const currentKey = projectKeyInput.value.trim().toUpperCase();
  if (info.projectKey && currentKey !== info.projectKey) {
    projectKeyInput.value = info.projectKey;
    changed = true;
  }
  if (changed) {
    clearJiraBaseUrlErrorIfNowValid();
    extractJiraIssueDetailsFromBaseUrl();
  }
}

async function applyDetectedState() {
  if (getBusy() || detectionLocked || isBulkBusy()) return;

  setSyncedTicketFound(false);
  resetTicketCard();

  const jiraPage = await detectJiraPageInTab().catch(() => null);

  let site = null;
  let listing = null;
  let selectedCount = 0;
  if (!jiraPage) {
    setJiraFilterActive(false);
    try {
      ({ site, listing, selectedCount } = await detectTabState());
    } catch {
      setSourceSiteVisible(false);
      setSingleTabEnabled(false);
      setJiraToSparkVisible(false);
      createTicketBtn.hidden = false;
      applyListingState(null, 0);
      return;
    }
  }

  const matched = site !== null && listing === null;

  if (jiraPage) {
    syncJiraContextFromTab(jiraPage);
  }

  let onSyncFlow = false;
  if (jiraPage?.type === "filter") {
    setJiraFilterActive(true);
    setBulkRowsFromListing(true);
    if (!state.bulkRows.length) {
      previewSection.style.display = "none";
      previewBody.innerHTML = "";
      syncListingControls();
    }
  } else if (jiraPage?.type === "ticket") {
    setJiraFilterActive(false);
    try {
      const cached =
        cachedJiraSyncData &&
        cachedJiraSyncData.issue?.key === jiraPage.key &&
        cachedJiraSyncData.issue?.self?.includes(jiraPage.origin)
          ? cachedJiraSyncData
          : null;
      if (cached) {
        onSyncFlow = Boolean(extractSourceUrl(cached.issue?.fields?.description));
      } else {
        const combined = await getJiraIssueWithAttachments(
          jiraPage.origin,
          jiraPage.key,
        );
        cachedJiraSyncData = { issue: combined.issue, attachments: combined.attachments, syncedNames: [] };
        onSyncFlow = Boolean(extractSourceUrl(combined.issue?.fields?.description));
      }
    } catch {
      onSyncFlow = false;
    }
  } else if (jiraPage) {
    setJiraFilterActive(false);
  }
  const isTicketContext = matched || onSyncFlow;
  tabSingle.hidden = !isTicketContext;
  setSingleTabEnabled(isTicketContext);

  if (jiraPage) {
    setSourceSiteVisible(false);
  } else {
    if (matched) setSourceSite(site);
    setSourceSiteVisible(matched);
    setSourceSiteLocked(matched);
  }

  setJiraToSparkVisible(false);
  jiraFlowActive = onSyncFlow;
  setJiraSyncFlowActive(jiraFlowActive);
  singleAttachments.hidden = Boolean(jiraPage) && !jiraFlowActive;
  if (jiraFlowActive) {
    includeAttachmentsInput.disabled = false;
  }
  createTicketLabel.textContent = jiraFlowActive
    ? "Sync Updates"
    : "Create or Sync ticket";
  createTicketBtn.hidden = Boolean(jiraPage) && !jiraFlowActive;
  const buttonGroup = createTicketBtn.closest(".button-group");
  if (buttonGroup) {
    buttonGroup.style.display = "";
  }
  const shouldShowBulk = isJiraFilterActive() || listing;
  if (shouldShowBulk) {
    if (bulkView.hidden) {
      switchView("bulk", false);
    }
    if (listingImportBtn && listingImportBtn.style.display !== "none") {
      listingImportBtn.focus({ preventScroll: true });
    }
  } else if (jiraFlowActive && !bulkView.hidden) {
    switchView("single", false);
  }

  applyListingState(listing, selectedCount);
  if (jiraFlowActive && jiraPage?.type === "ticket") {
    setStatus("Sync updates with Spark", "info");
    createTicketBtn.focus();
  } else if (!bulkView.hidden) {
    updateBulkStatusMessage();
  } else if (jiraPage) {
    setStatus(
      jiraPage.type === "filter"
        ? "Jira filter detected — select tickets to sync with Octane/Spark."
        : jiraPage.projectKey
          ? `Jira project ${jiraPage.projectKey} detected — base URL and project key set.`
          : "Jira page detected — base URL set.",
      "info",
    );
  } else {

    refreshSingleViewStatus();
  }
}

applyDetectedState();

const debouncedDetectState = debounce(applyDetectedState, 150);
chrome.tabs.onActivated.addListener(debouncedDetectState);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {

  if (changeInfo.status === "complete" || changeInfo.url) {
    debouncedDetectState();
  }
});
window.addEventListener("focus", debouncedDetectState);
document.addEventListener("bulkflow-cleared", applyDetectedState);
