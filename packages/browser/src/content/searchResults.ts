// Content script of search result pages: picks the page adapter for the current page and watches its results.
import { GOOGLE_PAGE, isGoogleSearchUrl } from "./google";
import { watchResults } from "./resultButton";
import { SCHOLAR_PAGE, isScholarUrl } from "./scholar";

if (isScholarUrl(location.href)) watchResults(SCHOLAR_PAGE);
else if (isGoogleSearchUrl(location.href)) watchResults(GOOGLE_PAGE);
