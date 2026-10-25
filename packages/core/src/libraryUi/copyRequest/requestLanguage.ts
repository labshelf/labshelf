// Names the languages a request-a-copy email is written in and picks one from a browser language tag.
export const REQUEST_LANGUAGES = ["en", "pt", "es"] as const;
export type RequestLanguage = (typeof REQUEST_LANGUAGES)[number];

export const REQUEST_LANGUAGE_NAME: Record<RequestLanguage, string> = { en: "English", pt: "Português", es: "Español" };

export function isRequestLanguage(value: unknown): value is RequestLanguage {
  return (REQUEST_LANGUAGES as readonly unknown[]).includes(value);
}

/** @returns the email language for a tag such as "pt-BR" or "es"; English when the tag is missing or unsupported */
export function deriveRequestLanguage(tag: string | undefined): RequestLanguage {
  const base = tag?.toLowerCase().split(/[-_]/)[0];
  return isRequestLanguage(base) ? base : "en";
}
