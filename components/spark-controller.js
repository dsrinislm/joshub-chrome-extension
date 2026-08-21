import {
  listJiraCommentsDetailed,
  getJiraIssue,
} from "./api.js";
import { extractSourceUrl } from "./adf.js";
import {
  getCurrentTab,
  postJiraCommentsInSparkPage,
  postJiraCommentsInOriginPage,
} from "./scrape.js";
import {
  getMappedJiraCommentIds,
  addCommentMappings,
} from "./comment-map.js";
import { sleep } from "./util.js";

export function jiraPageInfoFromUrl(url) {
  const raw = String(url || "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const browse = /\/browse\/([A-Za-z0-9]+-\d+)(?:[/?#]|$)/.exec(
    parsed.pathname,
  );
  if (browse) {
    const key = browse[1].toUpperCase();
    return {
      origin: parsed.origin,
      type: "ticket",
      key,
      projectKey: key.replace(/-\d+$/, ""),
    };
  }

  const board = /\/projects\/([A-Za-z0-9]+)\/boards?\/(?:\d+|backlog)?(?:[/?#]|$)/.exec(
    parsed.pathname,
  );
  if (board) {
    return {
      origin: parsed.origin,
      type: "board",
      key: null,
      projectKey: board[1].toUpperCase(),
    };
  }

  const project = /\/projects\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(
    parsed.pathname,
  );
  if (project) {
    return {
      origin: parsed.origin,
      type: "project",
      key: null,
      projectKey: project[1].toUpperCase(),
    };
  }

  if (/\/secure\/RapidBoard\.jspa\b/i.test(parsed.pathname)) {
    const pk = /[?&]projectKey=([A-Za-z0-9]+)/i.exec(parsed.search);
    if (pk) {
      return {
        origin: parsed.origin,
        type: "board",
        key: null,
        projectKey: pk[1].toUpperCase(),
      };
    }
  }

  const hostname = parsed.hostname || "";
  const jiraHost =
    hostname.endsWith("atlassian.net") ||
    /(^|\.)jira[.\-]/.test(hostname) ||
    hostname === "jira";
  const jiraPath = /\/(?:jira|browse|projects|servicedesk|plugins|secure)\//i.test(
    parsed.pathname,
  );
  if (jiraHost && jiraPath) {
    return { origin: parsed.origin, type: "jira", key: null, projectKey: null };
  }

  if (jiraHost && /\/issues\/?(?:[/?#]|$)/i.test(parsed.pathname)) {
    return { origin: parsed.origin, type: "filter", key: null, projectKey: null };
  }

  return null;
}

export function jiraFilterParamsFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  const filterId = (params.get("filter") || "").trim();
  if (filterId) return { kind: "filter", filterId };
  const jql = (params.get("jql") || params.get("jqlQuery") || "").trim();
  if (jql) return { kind: "jql", jql };
  const query = (params.get("query") || "").trim();
  if (query) return { kind: "query", query };
  return null;
}

export function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

export async function useSparkTab({ sparkOrigin, sysId, requireTicket = true }, fn) {
  const sourceUrl = `${sparkOrigin}/incident.do?sys_id=${encodeURIComponent(sysId)}`;
  const allTabs = await chrome.tabs.query({ url: `${sparkOrigin}/*` });
  let tab = null;
  if (requireTicket) {
    tab = allTabs.find((t) => (t.url || "").includes(sysId)) || allTabs[0] || null;
  } else {
    tab = allTabs[0] || null;
  }
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: sourceUrl, active: false });
    created = true;
    await waitForTabComplete(tab.id);
  }
  try {
    return await fn(tab);
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runInSparkTab({ sparkOrigin, sysId, comments, mappedIds, tab }) {
  const run = async (activeTab) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: postJiraCommentsInSparkPage,
      args: [{ sysId, comments, mappedIds: [...mappedIds] }],
      world: "MAIN",
    });
    return (results || [])
      .map((r) => r.result)
      .filter((r) => r && typeof r === "object");
  };

  const execute = async (activeTab, created) => {
    let reports = [];
    let attempts = 0;
    let injectError = "";
    while (attempts < 2 && reports.length === 0) {
      if (attempts > 0) await sleep(600);
      try {
        reports = await run(activeTab);
      } catch (err) {
        injectError = String((err && err.message) || err || "injection failed");
      }
      attempts++;
    }

    const active = reports.filter((r) => !r.skippedByLock);
    const good =
      active.find((r) => r.hasFields) ||
      active
        .filter((r) => r.wnFields >= 0)
        .sort((a, b) => (b.wnFields || 0) - (a.wnFields || 0))[0] ||
      active[0] ||
      reports[0];

    const report = good || {
      posted: 0,
      failed: comments.length,
      skipped: 0,
      total: comments.length,
      hasFields: false,
      url: "",
      detail: "no frame reported a result",
    };

    if (!reports.some((r) => r.hasFields)) {
      const rawDebug = reports
        .map((r) => r.debug || r.detail)
        .filter(Boolean)
        .join(" | ");
      if (reports.length === 0) {
        let tabUrl = "";
        try {
          tabUrl = (await chrome.tabs.get(activeTab.id))?.url || "";
        } catch {}
        report.detail = "Spark tab never finished loading the incident form — open the incident in Spark and retry.";
        report.debug = `no frame reported a result (tab=${tabUrl || "not found"}${injectError ? `, inject_error=${injectError}` : ""})`;
      } else if (reports.some((r) => r.loginWall)) {
        report.detail = `Spark session expired — log in to ${sparkOrigin} in this browser and retry.`;
        report.debug = rawDebug;
      } else {
        report.detail = `Spark comments form not found — open the incident in ${sparkOrigin} and retry.`;
        report.debug = rawDebug;
      }
    } else {
      report.debug = reports.map((r) => r.debug || r.detail).filter(Boolean).join(" | ");
    }

    return { ...report, mode: created ? "spark tab (opened)" : "spark tab" };
  };

  const runApiOnly = async (activeTab) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: postJiraCommentsInOriginPage,
      args: [{ sysId, comments, mappedIds: [...mappedIds] }],
      world: "MAIN",
    });
    return (results || [])
      .map((r) => r.result)
      .filter((r) => r && typeof r === "object");
  };

  if (tab) {
    let isTicket = false;
    try {
      isTicket = ((await chrome.tabs.get(tab.id))?.url || "").includes(sysId);
    } catch {}
    if (!isTicket) {
      if (!comments || comments.length === 0) {
        return {
          posted: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          hasFields: false,
          url: "",
          loginWall: false,
          detail: "",
          debug: "",
          mapping: [],
          mode: "spark tab",
        };
      }
      try {
        const apiReports = await runApiOnly(tab);
        const apiActive = apiReports.filter((r) => !r.skippedByLock);
        const apiReport =
          apiActive.find((r) => r.hasFields) ||
          apiActive.sort((a, b) => (b.posted || 0) - (a.posted || 0))[0] ||
          apiReports[0];
        if (apiReport) {
          if (apiReport.loginWall) {
            return { ...apiReport, mode: "spark tab", debug: apiReport.detail };
          }
          if (apiReport.failed === 0) {
            return {
              ...apiReport,
              mode: "spark tab",
              debug: apiReports
                .map((r) => r.detail)
                .filter(Boolean)
                .join(" | "),
            };
          }
        }
      } catch {}
      return useSparkTab({ sparkOrigin, sysId }, (t) => execute(t, true));
    }
    return execute(tab, false);
  }
  return useSparkTab({ sparkOrigin, sysId }, (t) => execute(t, true));
}

export async function detectJiraPageInTab() {
  const tab = await getCurrentTab();
  const info = jiraPageInfoFromUrl(tab?.url);
  if (!info) return null;
  return { ...info, url: tab?.url || "" };
}

function scrapeJiraFilterSelectionInPage() {
  const items = [];
  const rows = document.querySelectorAll(
    'tr[data-testid="native-issue-table.ui.issue-row"]',
  );
  rows.forEach((row) => {
    const checkboxEl = row.querySelector('input[type="checkbox"]');
    const isSelected =
      row.getAttribute("aria-selected") === "true" ||
      Boolean(checkboxEl?.checked) ||
      Boolean(checkboxEl?.hasAttribute("checked"));
    if (!isSelected) return;

    const keyLink = row.querySelector(
      'a[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]',
    );
    const browseLink = keyLink || row.querySelector('a[href*="/browse/"]');
    let key = (keyLink || browseLink)?.textContent.trim() || "";
    if (!key) {
      const label = row
        .querySelector('input[aria-label]')
        ?.getAttribute("aria-label") || "";
      key = label.replace(/^work\s*item\s*:\s*/i, "").trim();
    }
    if (!key) return;

    let summary = "";
    const summaryEl = row.querySelector('[data-testid*="summary"]');
    if (summaryEl) {
      summary = String(summaryEl.textContent).replace(/\s+/g, " ").trim();
    } else {
      const tds = Array.from(row.querySelectorAll("td"));
      const keyTdIndex = tds.findIndex(
        (td) =>
          td.querySelector('a[data-testid*="issue-key"]') ||
          td.querySelector('a[href*="/browse/"]'),
      );
      const summaryTd = keyTdIndex >= 0 ? tds[keyTdIndex + 1] : tds[2];
      if (summaryTd) {
        summary = String(summaryTd.textContent).replace(/\s+/g, " ").trim();
      }
    }

    items.push({ key: key.toUpperCase(), summary });
  });
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const k = String(item.key || "").toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(item);
  }
  return unique;
}

export async function scrapeJiraFilterSelectionInTab() {
  const tab = await getCurrentTab();
  if (!tab?.id) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeJiraFilterSelectionInPage,
      args: [],
      world: "ISOLATED",
    });
    return (results || [])[0]?.result || [];
  } catch {
    return [];
  }
}

export async function detectJiraIssueInTab() {
  const tab = await getCurrentTab();
  const page = jiraPageInfoFromUrl(tab?.url);
  return {
    key: page?.key || null,
    projectKey: page?.projectKey || null,
    url: tab?.url || "",
    origin: page?.origin || "",
  };
}

export async function syncJiraCommentsToSpark({
  jiraOrigin,
  issueKey,
  tab,
  issue,
  comments,
  sourceUrl,
}) {
  const theIssue =
    !sourceUrl && !issue ? await getJiraIssue(jiraOrigin, issueKey) : issue;
  const srcUrl = sourceUrl || extractSourceUrl(theIssue?.fields?.description);
  if (!srcUrl) {
    throw new Error(
      `No source ticket URL found in the description of ${issueKey}.`,
    );
  }

  let sparkOrigin;
  let sysId;
  try {
    sparkOrigin = new URL(srcUrl).origin;
    const match = /[?&]sys_id=([^&]+)/.exec(srcUrl);
    sysId = match ? decodeURIComponent(match[1]) : null;
  } catch {
    throw new Error("Couldn't parse the source ticket URL.");
  }
  if (!sysId) {
    throw new Error("Couldn't find the Spark ticket id in the source URL.");
  }

  const all =
    comments || (await listJiraCommentsDetailed(jiraOrigin, issueKey));
  const filtered = all
    .filter((c) => !/^\[Spark /i.test(c.body.trim()))
    .map((c) => ({ ...c, created: formatDate(c.created) }));
  const mappedIds = await getMappedJiraCommentIds(sysId);

  const report = await runInSparkTab({
    sparkOrigin,
    sysId,
    comments: filtered,
    mappedIds,
    tab,
  });

  if (Array.isArray(report.mapping) && report.mapping.length) {
    await addCommentMappings(sysId, report.mapping);
  }

  return { report, sourceUrl, issueKey };
}
