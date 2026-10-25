// Tells whether a URL is a search page the result buttons run on, so the background accepts its messages.
import { isGoogleSearchUrl } from "./googleParse";
import { isScholarUrl } from "./scholarParse";

export function isSearchPageUrl(url: string | undefined): boolean {
  return isScholarUrl(url) || isGoogleSearchUrl(url);
}
