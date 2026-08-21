const el = (id) => document.getElementById(id);

export let jiraSyncFlowActive = false;

export function setJiraSyncFlowActive(active) {
  jiraSyncFlowActive = Boolean(active);
}

export const statusDiv = el("status");
export const statusText = el("statusText");
export const ticketResult = el("ticketResult");
export const gapArt = el("gapArt");
export const gapArtBulk = el("gapArtBulk");
export const loginBtn = el("openWebsite");
export const bulkLoginBtn = el("bulkLoginBtn");
export const bulkSparkLoginBtn = el("bulkSparkLoginBtn");
export const bulkOctaneLoginBtn = el("bulkOctaneLoginBtn");
export const exportBtn = el("exportBtn");
export const jiraBaseUrlInput = el("jiraBaseUrl");
export const jiraBaseUrlError = el("jiraBaseUrlError");
export const projectKeyInput = el("projectKey");
export const createTicketBtn = el("createTicket");
export const createTicketLabel = el("createTicketLabel");
export const singleAttachments = el("singleAttachments");
export const jiraToSparkSyncBtn = el("jiraToSparkSync");
export const sourceSiteSwitch = el("sourceSiteSwitch");
export const sourceSiteInput = el("sourceSiteInput");
export const sourceSiteLabels = document.querySelectorAll(".site-toggle-label");
export const includeAttachmentsInput = el("includeAttachments");
export const attachmentPicker = el("attachmentPicker");
export const attachmentPickerTitle = el("attachmentPickerTitle");
export const attachmentGroups = el("attachmentGroups");
export const attachmentNote = el("attachmentNote");
export const bulkAttachmentSection = el("bulkAttachmentSection");
export const bulkIncludeAttachments = el("bulkIncludeAttachments");
export const bulkAttachmentPicker = el("bulkAttachmentPicker");
export const bulkAttachmentPickerTitle = el("bulkAttachmentPickerTitle");
export const bulkAttachmentGroups = el("bulkAttachmentGroups");
export const bulkAttachmentNote = el("bulkAttachmentNote");

for (const picker of [attachmentPicker, bulkAttachmentPicker]) {
  const collapseBtn = picker?.querySelector(".attachment-picker-collapse");
  collapseBtn?.addEventListener("click", () => {
    const collapsed = picker.classList.toggle("collapsed");
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));
  });
}
export const projectTagsContainer = el("projectTags");
export const singleView = el("singleView");
export const bulkView = el("bulkView");
export const tabSingle = el("tabSingle");
export const tabBulk = el("tabBulk");
export const fileInput = el("fileInput");
export const fileError = el("fileError");
export const fileSummary = el("fileSummary");
export const previewSection = el("previewSection");
export const previewBody = el("previewBody");
export const previewIdHeader = el("previewIdHeader");
export const previewSourceHeader = el("previewSourceHeader");
export const previewTitle = el("previewTitle");
export const previewCollapseBtn = el("previewCollapseBtn");
export const tableWrap = document.querySelector(".table-wrap");
export const selectAllCheckbox = el("selectAllCheckbox");

export const selectAllLabel = document.querySelector(".select-all");
export const selectionCount = el("selectionCount");
export const importBtn = el("importBtn");
export const listingImportBtn = el("listingImportBtn");
export const listingImportLabel = el("listingImportLabel");
export const dropzone = document.querySelector(".file-dropzone");
export const dropzoneTitle = el("dropzoneTitle");
export const dropzoneHint = el("dropzoneHint");
export const dropzoneIcon = el("dropzoneIcon");
export const clearFileBtn = el("clearFileBtn");
export const progressSection = el("progressSection");
export const progressLabel = el("progressLabel");
export const progressPercent = el("progressPercent");
export const progressBar = el("progressBar");
export const abortImportBtn = el("abortImportBtn");
export const bulkMediaProgress = el("bulkMediaProgress");
export const bulkMediaToggle = el("bulkMediaToggle");
export const bulkMediaProgressList = el("bulkMediaProgressList");
export const bulkMediaProgressCount = el("bulkMediaProgressCount");
export const syncProgressSection = el("syncProgressSection");
export const syncProgressCount = el("syncProgressCount");
export const syncProgressList = el("syncProgressList");
export const syncProgressToggle = el("syncProgressToggle");
export const syncAbortBtn = el("syncAbortBtn");
export const state = {
  bulkRows: [],
  importData: null,
  importExt: null,
  attachmentSelection: null,

  bulkAttachmentSelection: null,
};
let scrollFrame = 0;

function smoothScrollTo(target, duration = 420) {
  const scroller = document.body;
  if (
    !scroller ||
    typeof scroller.scrollTop !== "number" ||
    typeof scroller.scrollHeight !== "number"
  ) {
    return;
  }

  cancelAnimationFrame(scrollFrame);

  const start = scroller.scrollTop;
  const startTime = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const step = (now) => {
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (!(maxScroll > 0)) return;
    const liveTarget = Math.min(Math.max(0, target), maxScroll);
    const progress = Math.min(1, (now - startTime) / duration);
    scroller.scrollTop = start + (liveTarget - start) * easeOutCubic(progress);
    if (progress < 1) scrollFrame = requestAnimationFrame(step);
  };
  scrollFrame = requestAnimationFrame(step);
}

export function smoothScrollToBottom() {
  const scroller = document.body;
  if (!scroller || typeof scroller.scrollTop !== "number") return;
  smoothScrollTo(Infinity);
}

export function frameBulkView() {
  const run = () => {
    if (bulkView.hidden) return;
    smoothScrollToBottom();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    run();
  }
}

export function revealStatus() {
  const run = () => smoothScrollToBottom();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    run();
  }
}
