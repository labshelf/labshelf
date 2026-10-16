/** A browser language tag maps to one of the three email languages, English when unsupported. */
import { isRequestLanguage, requestLanguageFrom } from "../../../src/library-ui";

describe("requestLanguageFrom", () => {
  it.each([["pt-BR", "pt"], ["pt", "pt"], ["es-MX", "es"], ["ES", "es"], ["en-GB", "en"], ["fr-FR", "en"], ["", "en"], [undefined, "en"]])("maps %p to %s", (tag, lang) => {
    expect(requestLanguageFrom(tag)).toBe(lang);
  });
});

describe("isRequestLanguage", () => {
  it("accepts the three languages and nothing else", () => {
    for (const v of ["en", "pt", "es"]) expect(isRequestLanguage(v)).toBe(true);
    for (const v of ["fr", "EN", "", null, undefined, 1]) expect(isRequestLanguage(v)).toBe(false);
  });
});
