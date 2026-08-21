import {
  fetchJiraAttachmentDataUrl,
  getJiraIssueWithAttachments,
} from "./api.js";
import { extractSourceUrl } from "./adf.js";
import {
  fetchSparkCommentsInPage,
  fetchSparkAttachmentsInPage,
  listSparkAttachmentItemsInPage,
  uploadSparkAttachmentsInPage,
} from "./scrape.js";
import { useSparkTab } from "./spark-controller.js";
import { formatBytes, sleep } from "./util.js";

export async function fetchSparkEntriesInOrigin({ sparkOrigin, sysId, tab }) {
  const run = async (activeTab) => {
    let tabUrl = "";
    try {
      tabUrl = (await chrome.tabs.get(activeTab.id))?.url || "";
    } catch {}
    if (tabUrl && !tabUrl.startsWith(sparkOrigin)) {
      return {
        entries: [],
        error: `Spark tab is not on ${sparkOrigin} — open the incident there and retry.`,
      };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: fetchSparkCommentsInPage,
      args: [[sysId]],
      world: "MAIN",
    });
    const groups = (results || [])
      .map((r) => r.result)
      .filter((g) => Array.isArray(g) && g.length > 0);
    const loginRequired = groups.some((g) =>
      g.some((x) => x && x.loginRequired),
    );
    const entries =
      groups.sort(
        (a, b) =>
          (b[0]?.comments?.length || 0) - (a[0]?.comments?.length || 0),
      )[0]?.[0]?.comments || [];
    return {
      entries,
      error: loginRequired && !entries.length
        ? `Spark session expired or API access denied on ${sparkOrigin} — log in and retry.`
        : "",
    };
  };
  if (tab) return run(tab);
  return useSparkTab({ sparkOrigin, sysId, requireTicket: false }, run);
}

export async function fetchSparkAttachmentsInOrigin({ sparkOrigin, sysId, tab }) {
  const run = async (activeTab) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: fetchSparkAttachmentsInPage,
      args: [sysId],
      world: "MAIN",
    });
    const outs = (results || [])
      .map((r) => r.result)
      .filter((g) => Array.isArray(g) && g.length > 0);
    return (
      outs.sort(
        (a, b) =>
          (b[0]?.attachments?.length || 0) - (a[0]?.attachments?.length || 0),
      )[0]?.[0]?.attachments || []
    );
  };
  if (tab) return run(tab);
  return useSparkTab({ sparkOrigin, sysId, requireTicket: false }, run);
}

export async function fetchSparkAttachmentItemsInOrigin({ sparkOrigin, sysId, tab }) {
  const run = async (activeTab) => {
    let tabUrl = "";
    try {
      tabUrl = (await chrome.tabs.get(activeTab.id))?.url || "";
    } catch {}
    if (tabUrl && !tabUrl.startsWith(sparkOrigin)) {
      return { items: [], loginRequired: true };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: listSparkAttachmentItemsInPage,
      args: [sysId],
      world: "MAIN",
    });    const groups = (results || []).map((r) => r.result);
    const outs = groups
      .filter((g) => Array.isArray(g) && g.length > 0);
    let loginRequired = false;
    for (const g of groups) {
      if (Array.isArray(g) && g.some((r) => r && r.loginRequired)) {
        loginRequired = true;
        break;
      }
    }
    if (!outs.length && loginRequired) return { items: [], loginRequired };
    const items =
      outs.sort(
        (a, b) => (b[0]?.items?.length || 0) - (a[0]?.items?.length || 0),
      )[0]?.[0]?.items || [];
    return { items, loginRequired };
  };
  const retry = async (activeTab) => {
    let last = { items: [], loginRequired: false };
    let attempts = 0;
    while (attempts < 2 && !last.items.length) {
      if (attempts > 0) await sleep(600);
      try {
        last = await run(activeTab);
      } catch {
        last = { items: [], loginRequired: false };
      }
      attempts++;
    }
    return last;
  };
  if (tab) return retry(tab);
  return useSparkTab({ sparkOrigin, sysId, requireTicket: false }, retry);
}

export async function syncSparkAttachmentsInOrigin({ jiraOrigin, sparkOrigin, sysId, files, tab, onProgress, onFileProgress, onFileState, knownSparkNames }) {
  const run = async (activeTab) => {
    const executeUpload = async (file, dataUrl) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id, allFrames: true },
        func: uploadSparkAttachmentsInPage,
        args: [{ sysId, files: [{ name: file.name, dataUrl }] }],
        world: "MAIN",
      });
      const report = (results || [])
        .map((r) => r.result)
        .filter((r) => r && r.skipped !== true)
        .sort(
          (a, b) => (b?.uploaded?.length || 0) - (a?.uploaded?.length || 0),
        )[0];
      if (report?.uploaded?.length) return { ok: true };
      return {
        ok: false,
        error:
          report?.errors?.[file.name] || "Spark rejected the upload.",
      };
    };
    const existing = new Map();
    let knownCount = 0;
    for (const name of knownSparkNames || []) {
      existing.set(String(name), null);
      knownCount++;
    }
    if (knownCount === 0) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id, allFrames: true },
          func: listSparkAttachmentItemsInPage,
          args: [sysId],
          world: "MAIN",
        });
        const items =
          (results || [])
            .map((r) => r.result)
            .filter((g) => Array.isArray(g) && g.length > 0)
            .sort(
              (a, b) =>
                (b[0]?.items?.length || 0) - (a[0]?.items?.length || 0),
            )[0]?.[0]?.items || [];
        for (const item of items) existing.set(item.name, item.sizeBytes ?? null);
      } catch {}
    }
    const outcomes = new Array(files.length);
    let nextIndex = 0;
    let completed = 0;
    let uploadChain = Promise.resolve();
    const totalBytes = files.reduce(
      (sum, f) => sum + (Number(f.size) || 0),
      0,
    );
    let bytesDownloaded = 0;
    let bytesUploaded = 0;
    const fileDownloaded = new Array(files.length).fill(0);
    const reportProgress = () => {
      if (typeof onProgress !== "function") return;
      if (totalBytes > 0) {
        onProgress(
          Math.min(bytesDownloaded + bytesUploaded, totalBytes * 2),
          totalBytes * 2,
          bytesUploaded > 0
            ? `Syncing ${formatBytes(bytesUploaded)} of ${formatBytes(totalBytes)} to Spark…`
            : `Downloading ${formatBytes(bytesDownloaded)} of ${formatBytes(totalBytes)} from Jira…`,
        );
      } else {
        onProgress(completed, files.length, `Syncing attachment ${completed} of ${files.length} to Spark…`);
      }
    };
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        const file = files[index];
        if (existing.has(file.name)) {
          const size = Number(file.size) || 0;
          bytesDownloaded += size;
          bytesUploaded += size;
          outcomes[index] = { file, result: { ok: true, skipped: true } };
          if (typeof onFileState === "function") {
            onFileState(index, "skipped", "Already synced on Spark");
          }
        } else {
          if (typeof onFileState === "function") {
            onFileState(index, "downloading", "Downloading from Jira…");
          }
          const dataUrlPromise = fetchJiraAttachmentDataUrl(
            jiraOrigin,
            file.id,
            (loaded) => {
              const delta = loaded - fileDownloaded[index];
              fileDownloaded[index] = loaded;
              bytesDownloaded += delta;
              reportProgress();
              if (typeof onFileProgress === "function") {
                onFileProgress(
                  index,
                  loaded,
                  Number(file.size) || loaded,
                );
              }
            },
          );
          const result = await (uploadChain = uploadChain.then(async () => {
            let dataUrl;
            try {
              dataUrl = await dataUrlPromise;
            } catch (err) {
              return {
                ok: false,
                error: String((err && err.message) || err || "unknown"),
              };
            }
            if (typeof onFileState === "function") {
              onFileState(index, "uploading", "Uploading to Spark…");
            }
            try {
              const res = await executeUpload(file, dataUrl);
              if (res.ok) bytesUploaded += Number(file.size) || 0;
              reportProgress();
              return res;
            } catch (err) {
              return {
                ok: false,
                error: String((err && err.message) || err || "unknown"),
              };
            }
          }));
          if (result.ok) existing.set(file.name, null);
          outcomes[index] = { file, result };
          if (typeof onFileState === "function") {
            onFileState(
              index,
              result.ok ? "done" : "failed",
              result.ok
                ? "Synced to Spark"
                : (result.error || "Spark rejected the upload.").slice(0, 120),
            );
          }
        }
        completed++;
        reportProgress();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, files.length) }, worker),
    );
    const uploaded = [];
    const failedNames = [];
    let firstError = "";
    for (const { file, result } of outcomes) {
      if (result.ok) {
        if (!result.skipped) uploaded.push(file.name);
      } else {
        failedNames.push(file.name);
        if (!firstError) firstError = result.error || "unknown";
      }
    }
    return {
      uploaded: uploaded.length,
      uploadedNames: uploaded,
      failed: failedNames.length,
      failedNames,
      firstError,
      skipped: files.length - uploaded.length - failedNames.length,
    };
  };
  if (tab) return run(tab);
  return useSparkTab({ sparkOrigin, sysId, requireTicket: false }, run);
}

export function parseSourceUrl(sourceUrl) {
  let sparkOrigin;
  let sysId;
  try {
    sparkOrigin = new URL(sourceUrl).origin;
    const match = /[?&]sys_id=([^&]+)/.exec(sourceUrl);
    sysId = match ? decodeURIComponent(match[1]) : null;
  } catch {
    throw new Error("Couldn't parse the source ticket URL.");
  }
  if (!sysId) {
    throw new Error("Couldn't find the Spark ticket id in the source URL.");
  }
  return { sparkOrigin, sysId };
}

export async function getSyncAttachmentItems({ jiraOrigin, issueKey, cachedJiraData, sourceUrl }) {
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
  const srcUrl = sourceUrl || extractSourceUrl(issue?.fields?.description);
  if (!srcUrl) {
    return { items: [], syncedNames: new Set() };
  }
  const { sparkOrigin, sysId } = parseSourceUrl(srcUrl);
  const { items: sparkItems, loginRequired } =
    await fetchSparkAttachmentItemsInOrigin({
      sparkOrigin,
      sysId,
    }).catch(() => ({ items: [], loginRequired: false }));
  const jiraItems = attachments;
  const typeOf = (name) => {
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
  };
  const byName = new Map();
  for (const item of sparkItems) {
    byName.set(item.name, { ...item, source: "Spark" });
  }
  for (const item of jiraItems) {
    const size = Number(item.size);
    const normalized = {
      ...item,
      type: typeOf(item.name),
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
      url: `${jiraOrigin}/rest/api/3/attachment/content/${encodeURIComponent(item.id)}`,
    };
    if (byName.has(item.name)) {
      const spark = byName.get(item.name);
      const merged = { ...spark, inJira: true };
      if (merged.sizeBytes == null || merged.sizeBytes <= 0) {
        if (normalized.sizeBytes != null && normalized.sizeBytes > 0) {
          merged.sizeBytes = normalized.sizeBytes;
          merged.size = formatBytes(normalized.sizeBytes);
        }
      }
      byName.set(item.name, merged);
    } else {
      byName.set(item.name, { ...normalized, source: "Jira" });
    }
  }
  const items = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const syncedNames = new Set(
    items.filter((i) => i.inJira).map((i) => i.name),
  );
  return { items, syncedNames, loginRequired, sparkOrigin, issue, attachments };
}
