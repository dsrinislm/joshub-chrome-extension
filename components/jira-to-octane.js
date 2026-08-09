import {
  listJiraCommentsDetailed,
  fetchJiraAttachmentDataUrl,
  getJiraIssue,
  getJiraIssueWithAttachments,
} from "./api.js";
import {
  getCurrentTab,
  fetchOctaneCommentsInPage,
  postOctaneCommentsInPage,
  uploadOctaneAttachmentInPage,
  listListingAttachmentsInTab,
  fetchListingDetailsInTab,
} from "./scrape.js";
import {
  getMappedOctaneCommentIds,
  addOctaneCommentMappings,
} from "./comment-map.js";
import { extractSourceUrl } from "./adf.js";
import { syncOctaneComments } from "./comments.js";
import {
  uploadMissingAttachments,
  dataUrlSize,
  imageUploadFilename,
} from "./attachments.js";
import {
  startSyncAttachmentProgress,
  addSyncAttachmentProgressRow,
  setSyncAttachmentProgress,
  setSyncAttachmentState,
  syncAbortBtn,
} from "./ui.js";
import {
  attachmentByteSize,
  MAX_ATTACHMENT_UPLOAD_BYTES,
} from "./ui-single.js";

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    function finish() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function parseOctaneSourceUrl(sourceUrl) {
  let origin;
  try {
    origin = new URL(sourceUrl).origin;
  } catch {
    throw new Error("Couldn't parse the source ticket URL.");
  }
  const contextMatch = /[?&]p=([^&#/]+\/[^&#]+)/.exec(sourceUrl.split("#")[0]);
  if (!contextMatch) {
    throw new Error(
      "Couldn't find the Octane shared space/workspace in the source URL.",
    );
  }
  const [sharedSpace, workspace] = contextMatch[1].split("/");
  const idMatch =
    /entityType=work_item&id=(\d+)/.exec(sourceUrl) ||
    /[?&]id=(\d+)/.exec(sourceUrl.split("#")[1] || "") ||
    /[?&]id=(\d+)/.exec(sourceUrl.split("#")[0]);
  if (!idMatch) {
    throw new Error("Couldn't find the Octane work item id in the source URL.");
  }
  return {
    octaneOrigin: origin,
    sharedSpace,
    workspace,
    workItemId: idMatch[1],
    apiBase: `${origin}/api/shared_spaces/${sharedSpace}/workspaces/${workspace}`,
  };
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function executeInOctaneTab(fn, args, tab) {
  const target = tab || (await getCurrentTab());
  if (!target?.id) throw new Error("No Octane tab found.");
  const results = await chrome.scripting.executeScript({
    target: { tabId: target.id, allFrames: true },
    func: fn,
    args: [args],
    world: "ISOLATED",
  });
  return (results || [])
    .map((r) => r.result)
    .filter((r) => r !== undefined && r !== null);
}

async function useOctaneTab({ octaneOrigin, sourceUrl }, fn) {
  const tabs = await chrome.tabs
    .query({ url: `${octaneOrigin}/*` })
    .catch(() => []);
  let tab = tabs[0] || null;
  let created = false;
  if (!tab && sourceUrl) {
    tab = await chrome.tabs.create({ url: sourceUrl, active: false });
    created = true;
    await waitForTabComplete(tab.id);
  }
  if (!tab) {
    throw new Error("Open the Octane source ticket in a tab and retry.");
  }
  try {
    return await fn(tab);
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export async function syncJiraCommentsToOctane({
  jiraOrigin,
  issueKey,
  comments,
  sourceUrl,
  tab,
}) {
  const ctx = parseOctaneSourceUrl(sourceUrl);
  const all =
    comments || (await listJiraCommentsDetailed(jiraOrigin, issueKey));
  const filtered = all
    .filter((c) => !/^\[Octane /i.test(c.body.trim()))
    .map((c) => ({ ...c, created: formatDate(c.created) }));
  if (!filtered.length) {
    return {
      report: {
        posted: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        mapping: [],
      },
      sourceUrl,
      issueKey,
    };
  }
  const mappedIds = await getMappedOctaneCommentIds(ctx.workItemId);
  let knownTexts = [];
  try {
    const outs = await executeInOctaneTab(
      fetchOctaneCommentsInPage,
      [ctx.workItemId],
      tab,
    );
    const groups = outs
      .filter((g) => Array.isArray(g) && g.length > 0)
      .sort(
        (a, b) =>
          (b[0]?.comments?.length || 0) - (a[0]?.comments?.length || 0),
      );
    knownTexts = groups[0]?.[0]?.comments?.map((c) => c.text) || [];
  } catch {}

  const reports = await executeInOctaneTab(
    postOctaneCommentsInPage,
    {
      workItemId: ctx.workItemId,
      comments: filtered,
      knownTexts,
      mappedIds: [...mappedIds],
    },
    tab,
  );
  const report =
    reports.find((r) => r && r.hasFields && r.posted > 0) ||
    reports.find((r) => r && r.hasFields) ||
    reports.sort((a, b) => (b?.posted || 0) - (a?.posted || 0))[0] || {
      posted: 0,
      failed: filtered.length,
      skipped: 0,
      total: filtered.length,
      mapping: [],
    };

  if (Array.isArray(report.mapping) && report.mapping.length) {
    await addOctaneCommentMappings(ctx.workItemId, report.mapping);
  }
  return { report, sourceUrl, issueKey };
}

export async function syncOctaneAttachmentsInOrigin({
  jiraOrigin,
  sourceUrl,
  files,
  tab,
  onProgress,
  onFileProgress,
  onFileState,
}) {
  const ctx = parseOctaneSourceUrl(sourceUrl);
  console.log("[octane-sync-back] ctx", {
    octaneOrigin: ctx.octaneOrigin,
    workItemId: ctx.workItemId,
    sourceUrl,
  });
  let existing = new Set();
  try {
    const groups = await listListingAttachmentsInTab(
      [ctx.workItemId],
      "Octane",
      tab?.id,
    );
    existing = new Set((groups[0]?.attachments || []).map((a) => a.name));
  } catch {}
  console.log("[octane-sync-back] existing on octane", Array.from(existing));

  const outcomes = new Array(files.length);
  let next = 0;
  let uploadedCount = 0;
  let failedCount = 0;
  let completed = 0;
  const failedNames = [];
  const uploadedNames = [];
  let firstError = "";
  let uploadChain = Promise.resolve();

  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      if (existing.has(file.name)) {
        outcomes[index] = { file, ok: true, skipped: true };
        if (typeof onFileState === "function") {
          onFileState(index, "skipped", "Already on Octane");
        }
      } else {
        if (typeof onFileState === "function") {
          onFileState(index, "downloading", "Downloading from Jira…");
        }
        const result = await (uploadChain = uploadChain.then(async () => {
          let dataUrl;
          try {
            dataUrl = await fetchJiraAttachmentDataUrl(
              jiraOrigin,
              file.id,
              (loaded, total) => {
                if (typeof onFileProgress === "function") {
                  onFileProgress(index, loaded, total);
                }
                if (typeof onProgress === "function") {
                  onProgress(
                    index,
                    files.length,
                    `Downloading ${file.name}…`,
                  );
                }
              },
            );
          } catch (err) {
            return {
              ok: false,
              error: String((err && err.message) || err || "download failed"),
            };
          }
          if (typeof onFileState === "function") {
            onFileState(index, "uploading", "Uploading to Octane…");
          }
          try {
            const outs = await executeInOctaneTab(
              uploadOctaneAttachmentInPage,
              {
                workItemId: ctx.workItemId,
                name: file.name,
                dataUrl,
              },
              tab,
            );
            return (
              outs.find((r) => r && typeof r === "object" && r.ok) ||
              outs.find((r) => r && typeof r === "object") || {
                ok: false,
                error: "no result",
              }
            );
          } catch (err) {
            return {
              ok: false,
              error: String((err && err.message) || err || "upload failed"),
            };
          }
        }));
        if (result.ok) {
          existing.add(file.name);
          uploadedCount++;
          uploadedNames.push(file.name);
          outcomes[index] = { file, ok: true };
        } else {
          failedCount++;
          failedNames.push(file.name);
          if (!firstError) firstError = result.error || "unknown";
          outcomes[index] = { file, ok: false };
        }
        if (typeof onFileState === "function") {
          onFileState(
            index,
            result.ok ? "done" : "failed",
            result.ok
              ? "Synced to Octane"
              : (result.error || "Upload to Octane failed").slice(0, 120),
          );
        }
      }
      completed++;
      if (typeof onProgress === "function") {
        onProgress(
          completed,
          files.length,
          `Synced ${completed} of ${files.length} attachments to Octane`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, files.length) }, worker),
  );
  console.log("[octane-sync-back] summary", {
    uploaded: uploadedCount,
    uploadedNames,
    failed: failedCount,
    failedNames,
    firstError,
    skipped: files.length - uploadedCount - failedCount,
    fileCount: files.length,
  });
  return {
    uploaded: uploadedCount,
    uploadedNames,
    failed: failedCount,
    failedNames,
    firstError,
    skipped: files.length - uploadedCount - failedCount,
  };
}

function typeOfAttachment(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (
    ["mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mpeg", "mpg"].includes(ext)
  ) {
    return "video";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "ico"].includes(ext)
  ) {
    return "image";
  }
  return "other";
}

export async function getSyncOctaneAttachmentItems({
  jiraOrigin,
  issueKey,
  cachedJiraData,
}) {
  let issue;
  let attachments;
  const cachedMatches =
    cachedJiraData?.issue &&
    cachedJiraData.attachments &&
    cachedJiraData.issue?.key === issueKey &&
    String(cachedJiraData.issue?.self || "").startsWith(jiraOrigin);
  if (cachedMatches) {
    issue = cachedJiraData.issue;
    attachments = cachedJiraData.attachments;
  } else {
    ({ issue, attachments } = await getJiraIssueWithAttachments(
      jiraOrigin,
      issueKey,
    ));
  }
  const sourceUrl = extractSourceUrl(issue?.fields?.description);
  if (!sourceUrl) {
    return { items: [], syncedNames: new Set() };
  }
  const ctx = parseOctaneSourceUrl(sourceUrl);
  let octaneItems = [];
  try {
    octaneItems = await useOctaneTab(
      { octaneOrigin: ctx.octaneOrigin, sourceUrl },
      async (tab) => {
        const groups = await listListingAttachmentsInTab(
          [ctx.workItemId],
          "Octane",
          tab.id,
        );
        return groups[0]?.attachments || [];
      },
    );
  } catch {}

  const byName = new Map();
  for (const item of octaneItems) {
    byName.set(item.name, { ...item, source: "Octane" });
  }
  for (const item of attachments || []) {
    const size = Number(item.size);
    const normalized = {
      ...item,
      type: typeOfAttachment(item.name),
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
      url: `${jiraOrigin}/rest/api/3/attachment/content/${encodeURIComponent(item.id)}`,
    };
    if (byName.has(item.name)) {
      const octane = byName.get(item.name);
      const sameSize =
        octane.sizeBytes == null || normalized.sizeBytes == null
          ? true
          : octane.sizeBytes === normalized.sizeBytes;
      const merged = { ...octane, inJira: sameSize };
      if (
        (merged.sizeBytes == null || merged.sizeBytes <= 0) &&
        normalized.sizeBytes != null &&
        normalized.sizeBytes > 0
      ) {
        merged.sizeBytes = normalized.sizeBytes;
      }
      byName.set(item.name, merged);
    } else {
      byName.set(item.name, { ...normalized, source: "Jira" });
    }
  }
  const mergedItems = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const syncedNames = new Set(
    mergedItems.filter((i) => i.inJira).map((i) => i.name),
  );
  const overLimitNames = new Set(
    octaneItems
      .filter((item) => attachmentByteSize(item) > MAX_ATTACHMENT_UPLOAD_BYTES)
      .map((item) => item.name),
  );
  const items = mergedItems.filter(
    (item) =>
      item.inJira ||
      item.source !== "Octane" ||
      !overLimitNames.has(item.name),
  );
  const skipped = mergedItems.filter(
    (item) =>
      !item.inJira &&
      item.source === "Octane" &&
      overLimitNames.has(item.name),
  ).length;
  const note = skipped
    ? `${skipped} file(s) over 25 MB skipped — add them from the Jira UI.`
    : "";
  return {
    items,
    syncedNames,
    loginRequired: false,
    octaneOrigin: ctx.octaneOrigin,
    issue,
    attachments,
    note,
  };
}

export async function syncOctaneUpdates({
  jiraOrigin,
  issueKey,
  includeAttachments = true,
  selectedAttachments,
  cachedJiraData,
}) {
  let issue;
  let jiraItems = [];

  const cachedMatches =
    cachedJiraData?.issue &&
    cachedJiraData.attachments &&
    cachedJiraData.issue?.key === issueKey &&
    String(cachedJiraData.issue?.self || "").startsWith(jiraOrigin);
  if (includeAttachments && cachedMatches) {
    issue = cachedJiraData.issue;
    jiraItems = cachedJiraData.attachments;
  } else if (includeAttachments) {
    const combined = await getJiraIssueWithAttachments(
      jiraOrigin,
      issueKey,
    );
    issue = combined.issue;
    jiraItems = combined.attachments;
  } else {
    issue = await getJiraIssue(jiraOrigin, issueKey);
  }

  const sourceUrl = extractSourceUrl(issue?.fields?.description);
  if (!sourceUrl) {
    throw new Error(
      `No source ticket URL found in the description of ${issueKey}.`,
    );
  }
  const ctx = parseOctaneSourceUrl(sourceUrl);
  const selected = new Set(
    Array.isArray(selectedAttachments) ? selectedAttachments : [],
  );

  return useOctaneTab(
    { octaneOrigin: ctx.octaneOrigin, sourceUrl },
    async (tab) => {
      const jiraComments = await listJiraCommentsDetailed(
        jiraOrigin,
        issueKey,
      );

      const octaneEntries = await (async () => {
        try {
          const groups = await executeInOctaneTab(
            fetchOctaneCommentsInPage,
            [ctx.workItemId],
            tab,
          );
          return (
            groups
              .filter((g) => Array.isArray(g) && g.length > 0)
              .sort(
                (a, b) =>
                  (b[0]?.comments?.length || 0) -
                  (a[0]?.comments?.length || 0),
              )[0]?.[0]?.comments || []
          );
        } catch {
          return [];
        }
      })();
      const octaneToJira = await syncOctaneComments(
        jiraOrigin,
        issueKey,
        octaneEntries,
        String(ctx.workItemId),
        jiraComments.map((c) => c.body),
      );

      let attachments = { uploaded: 0, failed: 0, skipped: 0 };
      let attachmentsToOctane = {
        uploaded: 0,
        failed: 0,
        skipped: 0,
        uploadedNames: [],
        failedNames: [],
        firstError: "",
      };
      if (includeAttachments) {
        try {
          const jiraNames = new Map(
            jiraItems.map((item) => [item.name, Number(item.size) || null]),
          );
          const details = await fetchListingDetailsInTab(
            [ctx.workItemId],
            "Octane",
            {
              includeAttachments: true,
              selectedAttachments: selected.size
                ? { [String(ctx.workItemId)]: [...selected] }
                : undefined,
            },
            tab.id,
          );
          const sourceImages = details[0]?.images || [];
          const jiraToSync = selected.size
            ? jiraItems.filter((item) => selected.has(item.name))
            : jiraItems;
          let progressReady = false;
          const ensureProgress = () => {
            if (progressReady) return;
            progressReady = true;
            startSyncAttachmentProgress();
            syncAbortBtn.disabled = false;
          };
          if (sourceImages.length) {
            ensureProgress();
            sourceImages.forEach((img) => {
              addSyncAttachmentProgressRow({
                label: img.name || imageUploadFilename(img),
                size: img.sizeBytes ?? dataUrlSize(img.dataUrl),
                hint: "Uploading to Jira…",
              });
            });
            attachments = await uploadMissingAttachments(
              jiraOrigin,
              issueKey,
              sourceImages,
              undefined,
              undefined,
              jiraNames,
              (index, loaded, total) =>
                setSyncAttachmentProgress(index, loaded, total),
            );
            const skippedSet = new Set(attachments.skippedNames || []);
            const failedSet = new Set(attachments.failedNames || []);
            sourceImages.forEach((img, i) => {
              const name = String(img.name || imageUploadFilename(img));
              if (skippedSet.has(name)) {
                setSyncAttachmentState(i, "skipped", "Already on Jira");
              } else if (failedSet.has(name)) {
                setSyncAttachmentState(i, "failed", "Upload to Jira failed");
              } else {
                setSyncAttachmentState(i, "done", "Synced to Jira");
              }
            });
          }

          if (jiraToSync.length) {
            ensureProgress();
            const offset = sourceImages.length;
            jiraToSync.forEach((item) => {
              addSyncAttachmentProgressRow({
                label: item.name,
                size: Number(item.size) || 0,
                hint: "Queued…",
              });
            });
            attachmentsToOctane = await syncOctaneAttachmentsInOrigin({
              jiraOrigin,
              sourceUrl,
              files: jiraToSync,
              tab,
              onFileProgress: (index, loaded, total) =>
                setSyncAttachmentProgress(offset + index, loaded, total),
              onFileState: (index, state, message) =>
                setSyncAttachmentState(offset + index, state, message),
            });
          }
        } catch {}
      }

      const { report } = await syncJiraCommentsToOctane({
        jiraOrigin,
        issueKey,
        comments: jiraComments,
        sourceUrl,
        tab,
      });

      return {
        report,
        sparkToJira: octaneToJira,
        attachments,
        attachmentsToSpark: attachmentsToOctane,
        sourceUrl,
        octaneOrigin: ctx.octaneOrigin,
        issueKey,
      };
    },
  );
}
