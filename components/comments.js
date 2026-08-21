import { listJiraComments, addJiraComment } from "./api.js";
import { isEntryFromJira, isEntryFromJiraOctane } from "./comment-map.js";
import { adfWithHardBreaks, textToADF } from "./adf.js";

export function sparkCommentHeader(entry) {
  const kind = entry?.kind === "work_notes" ? "work note" : "comment";
  return `[Spark ${kind}] ${entry.author} · ${entry.createdAt}`;
}

export function sparkCommentBody(entry) {
  const header = sparkCommentHeader(entry);
  return entry.text ? `${header}\n\n${entry.text}` : header;
}

export function octaneCommentHeader(entry) {
  const author = entry.author || "Unknown";
  return entry.createdAt
    ? `[Octane comment] ${author} · ${entry.createdAt}`
    : `[Octane comment] ${author}`;
}

export function octaneCommentAdf(entry) {
  const content = [
    {
      type: "paragraph",
      content: [{ type: "text", text: octaneCommentHeader(entry) }],
    },
  ];
  const html = String(entry.html || "").trim();
  if (html && typeof htmlToADF === "function") {
    try {
      const converted = htmlToADF(html);
      if (Array.isArray(converted?.content) && converted.content.length) {
        content.push(...adfWithHardBreaks(converted.content));
        return { version: 1, type: "doc", content };
      }
    } catch {}
  }
  const text = String(entry.text || "").trim();
  if (text) content.push(...textToADF(text).content);
  return { version: 1, type: "doc", content };
}

async function syncCommentsToJira({
  jiraOrigin,
  issueKey,
  entries,
  sourceId,
  existingBodies,
  skipPrefix,
  headerFor,
  bodyFor,
  isFromJira,
}) {
  if (!jiraOrigin || !issueKey || !entries?.length) {
    return { added: 0, total: 0 };
  }
  try {
    const existing =
      existingBodies || (await listJiraComments(jiraOrigin, issueKey));
    const known = new Set(
      existing
        .map((body) => String(body || "").split("\n")[0].trim())
        .filter(Boolean),
    );
    const knownBodies = new Set(
      existing.map((body) => String(body || "").trim()).filter(Boolean),
    );
    let added = 0;
    const errors = [];
    for (const entry of entries) {
      const text = String(entry.text || "").trim();
      if (!text) continue;
      const prefixed = skipPrefix.test(text);
      let jiraBody = "";
      if (prefixed) {
        jiraBody = text
          .replace(skipPrefix, "")
          .replace(/^[^\n]*\n+/, "")
          .trim();
        if (!jiraBody || knownBodies.has(jiraBody)) continue;
      }
      if (knownBodies.has(text)) continue;
      const entryId = entry.id || entry.sysId;
      if (
        !prefixed &&
        sourceId &&
        entryId &&
        (await isFromJira(sourceId, entryId))
      ) {
        continue;
      }
      const header = headerFor(entry);
      if (!prefixed && known.has(header)) continue;
      try {
        await addJiraComment(
          jiraOrigin,
          issueKey,
          prefixed ? jiraBody : bodyFor(entry),
        );
        known.add(header);
        added++;
      } catch (error) {
        errors.push(String(error?.message || error));
      }
    }
    return {
      added,
      total: entries.length,
      ...(errors.length ? { error: errors[0] } : {}),
    };
  } catch (error) {
    return {
      added: 0,
      total: entries.length,
      error: String(error?.message || error),
    };
  }
}

export async function syncSparkComments(
  jiraOrigin,
  issueKey,
  entries,
  sparkSysId,
  existingBodies,
) {
  return syncCommentsToJira({
    jiraOrigin,
    issueKey,
    entries,
    sourceId: sparkSysId,
    existingBodies,
    skipPrefix: /^\[Jira comment\]/i,
    headerFor: sparkCommentHeader,
    bodyFor: sparkCommentBody,
    isFromJira: isEntryFromJira,
  });
}

export async function syncOctaneComments(
  jiraOrigin,
  issueKey,
  entries,
  workItemId,
  existingBodies,
) {
  return syncCommentsToJira({
    jiraOrigin,
    issueKey,
    entries,
    sourceId: workItemId,
    existingBodies,
    skipPrefix: /^\[Jira comment\]/i,
    headerFor: octaneCommentHeader,
    bodyFor: octaneCommentAdf,
    isFromJira: isEntryFromJiraOctane,
  });
}

export async function syncSourceComments(
  site,
  jiraOrigin,
  issueKey,
  entries,
  sourceId,
  existingBodies,
) {
  if (site === "Spark") {
    return syncSparkComments(
      jiraOrigin,
      issueKey,
      entries,
      sourceId,
      existingBodies,
    );
  }
  if (site === "Octane") {
    return syncOctaneComments(
      jiraOrigin,
      issueKey,
      entries,
      sourceId,
      existingBodies,
    );
  }
  return { added: 0, total: entries?.length || 0 };
}
