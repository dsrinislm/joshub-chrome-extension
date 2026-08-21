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
  createAttachmentProgressAdapter,
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
  selectionJiraToSourceOnly = false,
  cachedJiraData,
  mediaProgress,
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
    const { entries: sparkEntries, error: sparkScrapeError } =
      await fetchSparkEntriesInOrigin({ sparkOrigin, sysId, tab });
    const sparkToJira = await syncSparkComments(
      jiraOrigin,
      issueKey,
      sparkEntries,
      sysId,
      jiraComments.map((c) => c.body),
    );
    if (sparkScrapeError && !sparkToJira.error) {
      sparkToJira.error = sparkScrapeError;
    }

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
        const progress = createAttachmentProgressAdapter(mediaProgress);
        const jiraNames = new Map(
          jiraItems.map((item) => [item.name, Number(item.size) || null]),
        );
        const images = await fetchSparkAttachmentsInOrigin({ sparkOrigin, sysId, tab });
        const imagesToSync = selectionJiraToSourceOnly
          ? images
          : selected.size
            ? images.filter((img) => selected.has(img.name))
            : Array.isArray(selectedAttachments)
              ? []
              : images;
        let progressReady = false;
        const ensureProgress = () => {
          if (progressReady) return;
          progressReady = true;
          progress.start();
        };
        if (imagesToSync.length) {
          ensureProgress();
          imagesToSync.forEach((img) => {
            progress.addFile({
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
              progress.setProgress(index, loaded, total),
          );
          const skippedSet = new Set(attachments.skippedNames || []);
          const failedSet = new Set(attachments.failedNames || []);
          imagesToSync.forEach((img, i) => {
            const name = String(img.name || "");
            if (skippedSet.has(name)) {
              progress.setState(i, "skipped", "Already on Jira");
            } else if (failedSet.has(name)) {
              progress.setState(i, "failed", "Upload to Jira failed");
            } else {
              progress.setState(i, "done", "Synced to Jira");
            }
          });
        }
        const jiraToSync = selectionJiraToSourceOnly
          ? jiraItems.filter((item) => selected.has(item.name))
          : selected.size
            ? jiraItems.filter((item) => selected.has(item.name))
            : Array.isArray(selectedAttachments)
              ? []
              : jiraItems;
        if (jiraToSync.length) {
          ensureProgress();
          const offset = imagesToSync.length;
          jiraToSync.forEach((item) => {
            progress.addFile({
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
              progress.setProgress(offset + index, loaded, total),
            onFileState: (index, state, message) =>
              progress.setState(offset + index, state, message),
          });
        }
        progress.done();
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
