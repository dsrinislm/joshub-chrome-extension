export { getSite, detectSiteInTab, getCurrentTab } from "./scrape-detect.js";
export {
  scrapeInPage,
  listTicketAttachmentsInPage,
  listTicketAttachmentsInTab,
} from "./scrape-ticket.js";
export {
  listListingAttachmentsInPage,
  listListingAttachmentsInTab,
  scrapeTab,
  getPageData,
  scrapeSelectedListingInPage,
  scrapeSelectedListingInTab,
  detectListingInPage,
  detectTabState,
  scrapeSelectedSparkListingInPage,
  scrapeSelectedSparkListingInTab,
} from "./scrape-listing.js";
export {
  fetchListingDetailsInPage,
  fetchListingDetailsInTab,
} from "./scrape-listing-details.js";
export {
  fetchSparkCommentsInPage,
  fetchSparkAttachmentsInPage,
  listSparkAttachmentNamesInPage,
  listSparkAttachmentItemsInPage,
  uploadSparkAttachmentsInPage,
  fetchSparkCommentsInTab,
} from "./scrape-spark.js";
export {
  postJiraCommentsInSparkPage,
  postJiraCommentsInOriginPage,
} from "./scrape-spark-post.js";
export {
  fetchOctaneCommentsInPage,
  fetchOctaneCommentsInTab,
  postOctaneCommentsInPage,
  uploadOctaneAttachmentInPage,
} from "./scrape-octane.js";
