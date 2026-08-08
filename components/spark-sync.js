import {
  listJiraCommentsDetailed,
  getJiraIssue,
  getJiraIssueWithAttachments,
} from "./api.js";
import { extractSourceUrl } from "./adf.js";
import { syncSparkComments } from "./comments.js";
import {
  uploadMissingAttachments,
  dataUrlSize,
} from "./attachments.js";
import {
  startSyncAttachmentProgress,
  addSyncAttachmentProgressRow,
  setSyncAttachmentProgress,
  setSyncAttachmentState,
  syncAbortBtn,
} from "./ui.js";
import {
  useSparkTab,
  syncJiraCommentsToSpark,
} from "./spark-controller.js";
import {
  parseSourceUrl,
  fetchSparkEntriesInOrigin,
  fetchSparkAttachmentsInOrigin,
  syncSparkAttachmentsInOrigin,
} from "./spark-attachments.js";

export async function syncJiraUpdates({
  jiraOrigin,
  issueKey,
  includeAttachments = true,
  selectedAttachments,
  cachedJiraData,
}) {
  let issue;
  let jiraItems = [];
  let knownSparkNames = [];

  const cachedMatches =
    cachedJiraData?.issue &&
    cachedJiraData.attachments &&
    cachedJiraData.issue?.key === issueKey &&
    String(cachedJiraData.issue?.self || "").startsWith(jiraOrigin);
  if (includeAttachments && cachedMatches) {
    issue = cachedJiraData.issue;
    jiraItems = cachedJiraData.attachments;
    knownSparkNames = cachedJiraData.syncedNames || [];
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
  const { sparkOrigin, sysId } = parseSourceUrl(sourceUrl);
  const selected = new Set(
    Array.isArray(selectedAttachments) ? selectedAttachments : [],
  );

  return useSparkTab({ sparkOrigin, sysId, requireTicket: false }, async (tab) => {
    const jiraComments = await listJiraCommentsDetailed(jiraOrigin, issueKey);
    const sparkEntries = await fetchSparkEntriesInOrigin({ sparkOrigin, sysId, tab });
    const sparkToJira = await syncSparkComments(
      jiraOrigin,
      issueKey,
      sparkEntries,
      sysId,
      jiraComments.map((c) => c.body),
    );

    let attachments = { uploaded: 0, failed: 0, skipped: 0 };
    let attachmentsToSpark = {
      uploaded: 0,
      failed: 0,
      skipped: 0,
      failedNames: [],
      firstError: "",
    };
    if (includeAttachments) {
      try {
        const jiraNames = new Map(
          jiraItems.map((item) => [item.name, Number(item.size) || null]),
        );
        const images = await fetchSparkAttachmentsInOrigin({ sparkOrigin, sysId, tab });
        const imagesToSync = selected.size
          ? images.filter((img) => selected.has(img.name))
          : images;
        let progressReady = false;
        const ensureProgress = () => {
          if (progressReady) return;
          progressReady = true;
          startSyncAttachmentProgress();
          syncAbortBtn.disabled = false;
        };
        if (imagesToSync.length) {
          ensureProgress();
          imagesToSync.forEach((img) => {
            addSyncAttachmentProgressRow({
              label: img.name,
              size: img.sizeBytes ?? dataUrlSize(img.dataUrl),
              hint: "Uploading to Jira…",
            });
          });
          attachments = await uploadMissingAttachments(
            jiraOrigin,
            issueKey,
            imagesToSync,
            undefined,
            undefined,
            jiraNames,
            (index, loaded, total) =>
              setSyncAttachmentProgress(index, loaded, total),
          );
          const skippedSet = new Set(attachments.skippedNames || []);
          const failedSet = new Set(attachments.failedNames || []);
          imagesToSync.forEach((img, i) => {
            const name = String(img.name || "");
            if (skippedSet.has(name)) {
              setSyncAttachmentState(i, "skipped", "Already on Jira");
            } else if (failedSet.has(name)) {
              setSyncAttachmentState(i, "failed", "Upload to Jira failed");
            } else {
              setSyncAttachmentState(i, "done", "Synced to Jira");
            }
          });
        }
        const jiraToSync = selected.size
          ? jiraItems.filter((item) => selected.has(item.name))
          : jiraItems;
        if (jiraToSync.length) {
          ensureProgress();
          const offset = imagesToSync.length;
          jiraToSync.forEach((item) => {
            addSyncAttachmentProgressRow({
              label: item.name,
              size: Number(item.size) || 0,
              hint: "Queued…",
            });
          });
          attachmentsToSpark = await syncSparkAttachmentsInOrigin({
            jiraOrigin,
            sparkOrigin,
            sysId,
            files: jiraToSync,
            tab,
            knownSparkNames,
            onFileProgress: (index, loaded, total) =>
              setSyncAttachmentProgress(offset + index, loaded, total),
            onFileState: (index, state, message) =>
              setSyncAttachmentState(offset + index, state, message),
          });
        }
      } catch {}
    }

    const { report } = await syncJiraCommentsToSpark({
      jiraOrigin,
      issueKey,
      tab,
      issue,
      comments: jiraComments,
    });

    return {
      report,
      sparkToJira,
      attachments,
      attachmentsToSpark,
      sourceUrl,
      sparkOrigin,
      issueKey,
    };
  });
}
