

export const SITES = [
  {
    name: "Octane",

    idSelector: ".entity-form-document-view-header-entity-id-container",
  },
  {
    name: "Spark",

    idSelector: 'input[name="incident.number"]',
    titleSelectors: 'input[name="incident.short_description"]',
    editorSelector: 'textarea[name="incident.description"]',
    attachmentSelector: ".attachment_list_items .content_editable",
  },
];

export function getSite(name) {
  return SITES.find((site) => site.name === name) || null;
}

function detectInPage(sites) {
  const octane = sites.find((s) => s.name === "Octane");
  if (octane && /[?&]p=[^&#/]+\/[^&#]+/.test(location.search || "")) {
    return "Octane";
  }

  const spark = sites.find((s) => s.name === "Spark");
  if (spark) {
    const searchAndHash = (location.search || "") + (location.hash || "");
    const isIncidentUrl = /incident\.do/.test(
      (location.pathname || "") + searchAndHash,
    );
    if (isIncidentUrl && /[?&]sys_id=[^&#]/.test(searchAndHash)) {
      return "Spark";
    }
  }

  return null;
}

export async function detectSiteInTab() {
  const currentTab = await getCurrentTab();

  try {

    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id, allFrames: true },
      func: detectInPage,
      args: [SITES],
    });

    return results.map((r) => r.result).find(Boolean) || null;
  } catch {

    return null;
  }
}

export async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error("No active tab found.");
  return tabs[0];
}
