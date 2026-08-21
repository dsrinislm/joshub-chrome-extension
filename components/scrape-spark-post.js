export function postJiraCommentsInSparkPage({ sysId, comments, mappedIds }) {
  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";

  const apiHeaders = (accept) => {
    const h = { Accept: accept };
    if (userToken) {
      h["X-UserToken"] = userToken;
    } else {
      h["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
    }
    return h;
  };

  const mappedIdSet = new Set(
    Array.isArray(mappedIds)
      ? mappedIds
      : mappedIds && typeof mappedIds.has === "function"
        ? Array.from(mappedIds)
        : [],
  );

  const commentText = (c) => {
    const body = String(c.body || "").trim();
    if (!body || /^\[(Spark|Octane|Jira comment)\b/i.test(body)) return body;
    const meta = [String(c.author || "").trim(), String(c.created || c.createdAt || "").trim()]
      .filter(Boolean)
      .join(" · ");
    return meta ? `[Jira comment] ${meta}\n\n${body}` : `[Jira comment]\n\n${body}`;
  };

  const syncLockKey = "__jiraSparkSyncPostingLock__";
  const acquireSyncLock = () => {
    try {
      const top = window.top;
      if (!top) return true;
      if (top[syncLockKey]) {
        return false;
      }
      top[syncLockKey] = true;
      return true;
    } catch {
      return true;
    }
  };
  const releaseSyncLock = () => {
    try {
      if (window.top) window.top[syncLockKey] = false;
    } catch {}
  };

  const findWorkNotesComposer = () =>
    document.querySelector('textarea[data-stream-text-input="work_notes"]') ||
    document.querySelector("#activity-stream-work_notes-textarea") ||
    document.querySelector(
      'textarea[name$=".work_notes"], textarea[name="work_notes"]',
    );

  const findWorkNotesField = () =>
    document.querySelector(
      'textarea[name$=".work_notes"], textarea[name="work_notes"], ' +
        '#work_notes, [data-field-name="work_notes"]',
    );

  const fetchServerEntries = async (bodies = []) => {
    const readJournalApi = async () => {
      const headers = apiHeaders("application/json");
      const response = await fetch(
        `${location.origin}/api/now/table/sys_journal_field?sysparm_query=element_id=${encodeURIComponent(sysId)}^ORDERBYsys_created_on&sysparm_fields=element,value,sys_created_by,sys_created_on,sys_id&sysparm_display_value=true&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (!response.ok) return { entries: [], source: "journal:blocked" };
      const json = await response.json();
      const rows = Array.isArray(json?.result) ? json.result : [];
      return {
        entries: rows
          .map((row) => ({
            sysId: String(row?.sys_id || "").trim(),
            text: String(row?.value || "").trim(),
          }))
          .filter((e) => e.sysId && e.text),
        source: "journal",
      };
    };

    const readIncidentHtml = async () => {
      const headers = apiHeaders("text/html");
      const response = await fetch(
        `${location.origin}/incident.do?sys_id=${encodeURIComponent(sysId)}`,
        { credentials: "include", headers },
      );
      if (!response.ok) return { entries: [], source: "html:error" };
      const doc = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const entries = [];
      for (const li of doc.querySelectorAll("li[data-journal-id]")) {
        const text =
          li.querySelector(".sn-widget-textblock-body")?.textContent?.trim() ||
          "";
        const id = li.getAttribute("data-journal-id") || "";
        if (text && id) entries.push({ sysId: id, text });
      }
      return { entries, source: "html" };
    };

    const readGlideRecord = async () => {
      if (typeof GlideRecord === "undefined") {
        return { entries: [], source: "glide:none" };
      }
      const entries = [];
      try {
        await new Promise((resolve) => {
          const gr = new GlideRecord("sys_journal_field");
          gr.addQuery("element_id", sysId);
          gr.orderBy("sys_created_on");
          gr.setLimit(1000);
          gr.query(function () {
            while (gr.next()) {
              const text = String(gr.getValue("value") || "").trim();
              const id = String(gr.getUniqueValue() || "").trim();
              if (text && id) entries.push({ sysId: id, text });
            }
            resolve();
          });
        });
      } catch {}
      return { entries, source: "glide" };
    };

    const readIncidentApi = async () => {
      const headers = apiHeaders("application/json");
      const response = await fetch(
        `${location.origin}/api/now/table/incident/${encodeURIComponent(sysId)}?sysparm_fields=comments,additional_comments,work_notes,comments_and_work_notes&sysparm_display_value=true`,
        { credentials: "include", headers },
      );
      if (!response.ok) return { entries: [], source: "incident:error" };
      const rec = (await response.json())?.result;
      const entries = [];
      const seen = new Set();
      const parser = (raw) => {
        const out = [];
        const labeled = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-\s+(.+?)\s+\(([^)]+)\)\s*$/;
        const unlabeled = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+-\s+(.+)$/;
        let current = null;
        for (const part of String(raw || "").split(/\n\n+/)) {
          const firstLine = part.split(/\r?\n/)[0];
          const m = labeled.exec(firstLine) || unlabeled.exec(firstLine);
          if (m) {
            if (current) out.push(current);
            current = { text: part.slice(firstLine.length).trim() };
          } else if (current) {
            current.text = `${current.text}\n\n${part.trim()}`.trim();
          }
        }
        if (current) out.push(current);
        return out;
      };
      for (const field of [
        "comments",
        "additional_comments",
        "work_notes",
        "comments_and_work_notes",
      ]) {
        for (const entry of parser(rec?.[field])) {
          if (entry.text && !seen.has(entry.text)) {
            seen.add(entry.text);
            entries.push({ sysId: "", text: entry.text });
          }
        }
      }
      return { entries, source: "incident" };
    };

    const results = await Promise.all([
      readJournalApi(),
      readGlideRecord(),
      readIncidentApi(),
    ]);
    const merged = [];
    const seen = new Set();
    const entryMatches = (entry, body) =>
      entry.text === body ||
      (body && body.length > 20 && entry.text.includes(body));
    for (const r of results) {
      for (const e of r.entries) {
        if (e.text && !seen.has(e.text)) {
          seen.add(e.text);
          merged.push(e);
        }
      }
    }
    let sources = results
      .filter((r) => r.entries.length)
      .map((r) => r.source)
      .join("|");
    const anyBodyMissing =
      bodies.length > 0 &&
      !bodies.every((b) => merged.some((e) => entryMatches(e, b)));
    if (merged.length === 0 || anyBodyMissing) {
      const html = await readIncidentHtml();
      for (const e of html.entries) {
        if (e.text && !seen.has(e.text)) {
          seen.add(e.text);
          merged.push(e);
        }
      }
      if (html.entries.length) {
        sources = sources ? `${sources}|${html.source}` : html.source;
      }
    }
    return { entries: merged, sources: sources || "none" };
  };

  const setFieldValue = (el, text) => {
    let applied = false;
    const ng = window.angular;
    if (ng && ng.element) {
      try {
        const elt = ng.element(el);
        const scope = elt.scope();
        if (scope) {
          scope.$apply(() => {
            const model = elt.controller
              ? elt.controller("ngModel")
              : null;
            if (model && typeof model.$setViewValue === "function") {
              model.$setViewValue(text);
            } else {
              el.value = text;
            }
          });
          applied = true;
        }
      } catch {}
    }
    if (!applied) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(el, text);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const findPostButton = (composer) => {
    const isMatch = (el) =>
      /saveActivity|postActivity|postComment|submit|Add comment|Post/i.test(
        (el.getAttribute("ng-click") || "") +
          (el.getAttribute("aria-label") || "") +
          (el.textContent || ""),
      );
    const scan = (root) => {
      const nodes = [
        ...root.querySelectorAll(
          "button, a, input[type='submit'], [ng-click]",
        ),
      ];
      return nodes.find(isMatch) || null;
    };
    let node = composer.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const btn = scan(node);
      if (btn) return btn;
    }
    return scan(document) || null;
  };

  const postViaComposer = async (c) => {
    const composer = findWorkNotesComposer();
    if (!composer) return { ok: false, stage: "composer:none", btn: "" };
    const text = commentText(c);
    setFieldValue(composer, text);
    composer.focus();
    await new Promise((resolve) => setTimeout(resolve, 300));

    let invoked = "click";
    const ng = window.angular;
    if (ng && ng.element) {
      try {
        const scope = ng.element(composer).scope();
        const modelExpr = composer.getAttribute("ng-model") || "";
        const objName = modelExpr.split(".")[0];
        if (scope && objName && scope[objName]) {
          const field = scope[objName];
          field.value = text;
          const fns = [
            "saveActivity",
            "postActivity",
            "postComment",
            "saveStreamActivity",
            "submit",
          ];
          const fnName = fns.find((n) => typeof scope[n] === "function");
          if (fnName) {
            scope.$apply(() => scope[fnName](field));
            invoked = `scope:${fnName}`;
          }
        }
      } catch {}
    }

    if (invoked === "click") {
      const button = findPostButton(composer);
      if (!button) return { ok: false, stage: "composer:no-button", btn: "" };
      button.disabled = false;
      button.click();
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
    const bodyHtml = document.body?.innerHTML || "";
    const streamText =
      composer
        .closest(
          "[data-stream-form], .sn-activity-stream, .sc-activity-stream-comments, .sn-activity-stream-comments",
        )
        ?.innerText || "";
    const found = (
      streamText +
      (document.body?.innerText || "") +
      bodyHtml
    ).includes(commentText(c));
    return {
      ok: found,
      stage: found
        ? `composer:ok:${invoked}`
        : `composer:unverified:${invoked}`,
      btn: findPostButton(composer)?.getAttribute("ng-click") || "",
    };
  };

  const postViaRest = async (c) => {
    const text = commentText(c);
    const attempts = [];
    const jsonHeaders = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (userToken) jsonHeaders["X-UserToken"] = userToken;

    const patchRecord = async () => {
      try {
        const response = await fetch(
          `${location.origin}/api/now/table/incident/${encodeURIComponent(sysId)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: jsonHeaders,
            body: JSON.stringify({ work_notes: text }),
          },
        );
        if (!response.ok) {
          attempts.push(`api:patch:error:${response.status}`);
          return false;
        }
        attempts.push("api:patch:ok");
        return true;
      } catch {
        attempts.push("api:patch:throw");
        return false;
      }
    };

    const formPost = async () => {
      const formHeaders = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      };
      if (userToken) formHeaders["X-UserToken"] = userToken;
      try {
        const response = await fetch(location.href, {
          method: "POST",
          credentials: "include",
          headers: formHeaders,
          body: new URLSearchParams({ work_notes: text }).toString(),
        });
        if (!response.ok) {
          attempts.push(`api:form:error:${response.status}`);
          return false;
        }
        const html = await response.text();
        if (html.includes(text)) {
          attempts.push("api:form:ok");
          return true;
        }
        attempts.push("api:form:unconfirmed");
        return false;
      } catch {
        attempts.push("api:form:throw");
        return false;
      }
    };

    if (await patchRecord()) {
      return { ok: true, stage: attempts.join(" -> "), btn: "" };
    }
    if (await formPost()) {
      return { ok: true, stage: attempts.join(" -> "), btn: "" };
    }
    return { ok: false, stage: attempts.join(" -> ") || "api:none", btn: "" };
  };

  const postReport = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const collectTexts = () => {
      const parts = [
        document.body?.innerText || "",
        document.body?.innerHTML || "",
      ];
      const field = findWorkNotesField();
      if (field?.value) parts.push(field.value);
      const composer = findWorkNotesComposer();
      if (composer) {
        if (composer.value) parts.push(composer.value);
        const container = composer.closest(
          "[data-stream-form], .sn-activity-stream, .sc-activity-stream-comments, .sn-activity-stream-comments",
        );
        if (container?.innerText) parts.push(container.innerText);
      }
      return parts.join("\n");
    };
    const streamHasEntries = () =>
      document.querySelector(
        "[data-journal-id], [data-entry-id], [data-stream-entry], .sn-activity-stream-entry, .activity-stream-entry, .sc-activity-stream-entry",
      ) !== null;
    let existingText = collectTexts();
    let serverText = "";
    let serverEntries = 0;
    let serverEntryTexts = [];
    let serverSources = "";
    try {
      const server = await fetchServerEntries();
      serverEntries = server.entries.length;
      serverEntryTexts = server.entries.map((e) => e.text);
      serverText = serverEntryTexts.join("\n");
      serverSources = server.sources;
    } catch {}
    if (!serverEntries) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        existingText = collectTexts();
        if (
          comments.some(
            (c) => commentText(c) && existingText.includes(commentText(c)),
          )
        ) {
          break;
        }
        if (streamHasEntries()) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const knownEntryTexts = new Set(
      serverEntryTexts.map((t) => String(t).trim()),
    );
    const dedupText = `${serverText}\n${existingText}`;
    const existing = comments.filter((c) => {
      const body = commentText(c);
      return (
        mappedIdSet.has(c.id) ||
        knownEntryTexts.has(body) ||
        (body && dedupText.includes(body))
      );
    });
    const pending = comments.filter((c) => !existing.includes(c));
    const failedIds = new Set();
    const stages = [];
    const composerBtns = [];

    for (const c of pending) {
      const attempted = [];
      let res;
      try {
        res = await postViaRest(c);
      } catch {
        res = { ok: false, stage: "api:throw", btn: "" };
      }
      attempted.push(res.stage);
      if (res.btn) composerBtns.push(res.btn);
      if (!res.ok) {
        let comp;
        try {
          comp = await postViaComposer(c);
        } catch {
          comp = { ok: false, stage: "composer:throw", btn: "" };
        }
        attempted.push(comp.stage);
        if (comp.btn) composerBtns.push(comp.btn);
        res = comp;
      }
      stages.push(attempted.join(" -> "));
      if (!res.ok) failedIds.add(c.id);
    }

    const entryMatches = (entry, body) =>
      entry.text === body ||
      (body && body.length > 20 && entry.text.includes(body));

    const mapping = [];
    let afterEntries = [];
    let afterSources = "";
    if (pending.length - failedIds.size > 0) {
      let after = { entries: [], sources: "" };
      try {
        after = await fetchServerEntries(
          pending
            .filter((c) => !failedIds.has(c.id))
            .map((c) => commentText(c))
            .filter(Boolean),
        );
      } catch {}
      afterEntries = after.entries;
      afterSources = after.sources;
      for (const c of pending) {
        if (failedIds.has(c.id)) continue;
        const body = commentText(c);
        if (!after.entries.some((e) => entryMatches(e, body))) {
          failedIds.add(c.id);
        }
      }
      for (const c of pending) {
        if (failedIds.has(c.id)) continue;
        const body = commentText(c);
        const entry = after.entries.find((e) => entryMatches(e, body));
        if (entry?.sysId) {
          mapping.push({
            jiraCommentId: c.id,
            sparkEntrySysId: entry.sysId,
          });
        }
      }
    }

    const skipped = comments.length - pending.length;
    const hasFields = Boolean(findWorkNotesComposer() || findWorkNotesField());
    const probe = {
      noteTextareas:
        [...document.querySelectorAll("textarea")]
          .map((t) => t.name || t.id || "?")
          .filter((n) => /comments|work_notes|note|activity/i.test(n))
          .slice(0, 6)
          .join("|") || "none",
      workNotesFields: document.querySelectorAll(
        'textarea[name$=".work_notes"], input[name$=".work_notes"], [name="work_notes"]',
      ).length,
      readonlyWorkNotes: document.querySelectorAll(
        '[name$=".work_notes"][readonly], [id$="work_notes"][readonly]',
      ).length,
    };
    const loginWall = /login\.do|signin|sign\.in|log\s*in/i.test(
      `${location.href} ${document.body?.innerText?.slice(0, 2000) || ""}`,
    );
    const detail = [
      `token=${userToken ? "yes" : "no"}`,
      `existing=${existing.length}`,
      `server_entries=${serverEntries}`,
      `server_sources=${serverSources || "none"}`,
      `url=${location.href}`,
      `title=${document.title}`,
      `login_wall=${loginWall ? "yes" : "no"}`,
      `note_textareas=${probe.noteTextareas}`,
      `wn_fields=${probe.workNotesFields}`,
      `wn_readonly=${probe.readonlyWorkNotes}`,
      `stages=${stages.join(",") || "none"}`,
      `composer_btn=${[...new Set(composerBtns)].join(" | ").slice(0, 80) || "none"}`,
      `posted=${pending.length - failedIds.size}/${pending.length}`,
      `after_entries=${afterEntries.length}`,
      `after_sources=${afterSources || "none"}`,
      `marker_in_body=${comments.length ? (document.body?.innerText || "").includes(commentText(comments[0])) ? "yes" : "no" : "?"}`,
    ].join(", ");
    return {
      posted: pending.length - failedIds.size,
      failed: failedIds.size,
      skipped,
      total: comments.length,
      hasFields,
      wnFields: probe.workNotesFields,
      url: location.href,
      loginWall,
      detail,
      mapping,
    };
  };

  return (async () => {
    if (!acquireSyncLock()) {
      return {
        posted: 0,
        failed: 0,
        skipped: comments.length,
        total: comments.length,
        hasFields: false,
        wnFields: -1,
        url: location.href,
        loginWall: false,
        skippedByLock: true,
        detail: "skipped — another frame is handling the posting",
        mapping: [],
      };
    }
    try {
      return await postReport();
    } catch (err) {
      return {
        posted: 0,
        failed: comments.length,
        skipped: 0,
        total: comments.length,
        hasFields: false,
        wnFields: 0,
        url: location.href,
        loginWall: /login\.do|signin|sign\.in|log\s*in/i.test(
          `${location.href} ${document.body?.innerText?.slice(0, 2000) || ""}`,
        ),
        detail: `injected-error=${String((err && err.message) || err || "unknown")}`,
        mapping: [],
      };
    } finally {
      releaseSyncLock();
    }
  })();
}

export function postJiraCommentsInOriginPage({ sysId, comments, mappedIds }) {
  const id = String(sysId || "").trim();

  const userToken =
    (typeof window !== "undefined" && window.g_ck) ||
    document.querySelector('meta[name="X-UserToken"]')?.content ||
    document.querySelector('input[name="X-UserToken"]')?.value ||
    "";
  const headers = { Accept: "application/json" };
  if (userToken) {
    headers["X-UserToken"] = userToken;
  } else {
    headers["Authorization"] = `Basic ${btoa(`__joshub:${Date.now()}`)}`;
  }
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const mappedIdSet = new Set(
    Array.isArray(mappedIds)
      ? mappedIds
      : mappedIds && typeof mappedIds.has === "function"
        ? Array.from(mappedIds)
        : [],
  );

  const commentText = (c) => {
    const body = String(c.body || "").trim();
    if (!body || /^\[(Spark|Octane|Jira comment)\b/i.test(body)) return body;
    const meta = [String(c.author || "").trim(), String(c.created || c.createdAt || "").trim()]
      .filter(Boolean)
      .join(" · ");
    return meta ? `[Jira comment] ${meta}\n\n${body}` : `[Jira comment]\n\n${body}`;
  };

  const syncLockKey = "__jiraSparkSyncPostingLock__";
  const acquireSyncLock = () => {
    try {
      const top = window.top;
      if (!top) return true;
      if (top[syncLockKey]) {
        return false;
      }
      top[syncLockKey] = true;
      return true;
    } catch {
      return true;
    }
  };
  const releaseSyncLock = () => {
    try {
      if (window.top) window.top[syncLockKey] = false;
    } catch {}
  };

  const readJournal = async () => {
    const entries = [];
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_journal_field?sysparm_query=element_id=${encodeURIComponent(id)}^ORDERBYsys_created_on&sysparm_fields=element,value,sys_created_by,sys_created_on,sys_id&sysparm_display_value=true&sysparm_limit=1000`,
        { credentials: "include", headers },
      );
      if (response.ok) {
        const json = await response.json();
        for (const row of Array.isArray(json?.result) ? json.result : []) {
          const text = String(row?.value || "").trim();
          const entryId = String(row?.sys_id || "").trim();
          if (text && entryId) entries.push({ sysId: entryId, text });
        }
      }
    } catch {}
    return entries;
  };

  const postViaPatch = async (text) => {
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/incident/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: jsonHeaders,
          body: JSON.stringify({ work_notes: text }),
        },
      );
      return {
        ok: response.ok,
        status: response.status,
        stage: response.ok ? "api:patch:ok" : `api:patch:error:${response.status}`,
      };
    } catch {
      return { ok: false, status: 0, stage: "api:patch:throw" };
    }
  };

  const postViaJournalTable = async (text) => {
    try {
      const response = await fetch(
        `${location.origin}/api/now/table/sys_journal_field`,
        {
          method: "POST",
          credentials: "include",
          headers: jsonHeaders,
          body: JSON.stringify({ element_id: id, element: "work_notes", value: text }),
        },
      );
      return {
        ok: response.ok,
        status: response.status,
        stage: response.ok ? "api:journal:ok" : `api:journal:error:${response.status}`,
      };
    } catch {
      return { ok: false, status: 0, stage: "api:journal:throw" };
    }
  };

  const postViaForm = async (text) => {
    try {
      const response = await fetch(
        `${location.origin}/incident.do?sys_id=${encodeURIComponent(id)}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            ...headers,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: new URLSearchParams({ work_notes: text }).toString(),
        },
      );
      if (!response.ok) {
        return { ok: false, status: response.status, stage: `api:form:error:${response.status}` };
      }
      const html = await response.text();
      return html.includes(text)
        ? { ok: true, status: response.status, stage: "api:form:ok" }
        : { ok: false, status: response.status, stage: "api:form:unconfirmed" };
    } catch {
      return { ok: false, status: 0, stage: "api:form:throw" };
    }
  };

  const entryMatches = (entry, body) =>
    entry.text === body ||
    (body && body.length > 20 && entry.text.includes(body));

  return (async () => {
    if (!acquireSyncLock()) {
      return {
        posted: 0,
        failed: 0,
        skipped: comments.length,
        total: comments.length,
        hasFields: true,
        wnFields: 1,
        url: location.href,
        loginWall: false,
        skippedByLock: true,
        detail: "skipped — another frame is handling the posting",
        mapping: [],
      };
    }
    try {
      let journal = [];
      try {
        journal = await readJournal();
      } catch {}
      const existing = comments.filter((c) => {
        const body = commentText(c);
        return (
          mappedIdSet.has(c.id) ||
          journal.some((e) => entryMatches(e, body))
        );
      });
      const pending = comments.filter((c) => !existing.includes(c));
      const failedIds = new Set();
      const stages = [];
      let loginWall = false;
      for (const c of pending) {
        const text = commentText(c);
        let res = await postViaPatch(text);
        if (!res.ok) res = await postViaJournalTable(text);
        if (!res.ok) res = await postViaForm(text);
        if (res.status === 401) loginWall = true;
        stages.push(res.stage);
        if (!res.ok) failedIds.add(c.id);
      }

      let afterEntries = [];
      if (pending.length - failedIds.size > 0) {
        try {
          afterEntries = await readJournal();
        } catch {}
        for (const c of pending) {
          if (failedIds.has(c.id)) continue;
          const body = commentText(c);
          if (!afterEntries.some((e) => entryMatches(e, body))) {
            failedIds.add(c.id);
          }
        }
      }

      const mapping = [];
      for (const c of pending) {
        if (failedIds.has(c.id)) continue;
        const body = commentText(c);
        const entry = afterEntries.find((e) => entryMatches(e, body));
        if (entry?.sysId) {
          mapping.push({ jiraCommentId: c.id, sparkEntrySysId: entry.sysId });
        }
      }

      const detail = [
        `token=${userToken ? "yes" : "no"}`,
        `existing=${existing.length}`,
        `journal_entries=${journal.length}`,
        `url=${location.href}`,
        `login_wall=${loginWall ? "yes" : "no"}`,
        `stages=${stages.join(",") || "none"}`,
        `posted=${pending.length - failedIds.size}/${pending.length}`,
        `after_entries=${afterEntries.length}`,
      ].join(", ");
      return {
        posted: pending.length - failedIds.size,
        failed: failedIds.size,
        skipped: comments.length - pending.length,
        total: comments.length,
        hasFields: true,
        wnFields: 1,
        url: location.href,
        loginWall,
        detail,
        mapping,
      };
    } catch (err) {
      return {
        posted: 0,
        failed: comments.length,
        skipped: 0,
        total: comments.length,
        hasFields: true,
        wnFields: 1,
        url: location.href,
        loginWall: false,
        detail: `injected-error=${String((err && err.message) || err || "unknown")}`,
        mapping: [],
      };
    } finally {
      releaseSyncLock();
    }
  })();
}

