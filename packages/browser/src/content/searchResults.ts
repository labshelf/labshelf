// Content script of search result pages: picks the page adapter for the current page and watches its results.
import { GOOGLE_PAGE } from "./googlePage";
import { isGoogleSearchUrl } from "./googleParse";
import { watchResults } from "./searchHitScan";
import { SCHOLAR_PAGE } from "./scholarPage";
import { isScholarUrl } from "./scholarParse";

if (isScholarUrl(location.href)) watchResults(SCHOLAR_PAGE);
else if (isGoogleSearchUrl(location.href)) watchResults(GOOGLE_PAGE);
