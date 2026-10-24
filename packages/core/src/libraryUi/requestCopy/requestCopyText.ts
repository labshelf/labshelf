// Holds the wording of the request-a-copy email in each language and lays out its subject and body.
import type { RequestLanguage } from "./requestLanguage.js";

interface Wording {
  subject: string;
  greeting: string;
  intro: string;
  ask: string;
  thanks: string;
}

const WORDING: Record<RequestLanguage, Wording> = {
  en: {
    subject: "Request for a copy of",
    greeting: "Dear author,",
    intro: "I came across your paper and would like to read it, but I do not have access to the full text:",
    ask: "Could you please send me a copy? It is for my personal research.",
    thanks: "Thank you very much,",
  },
  pt: {
    subject: "Pedido de cópia de",
    greeting: "Prezado(a) autor(a),",
    intro: "Encontrei o seu artigo e gostaria de lê-lo, mas não tenho acesso ao texto completo:",
    ask: "Poderia me enviar uma cópia? É para a minha pesquisa pessoal.",
    thanks: "Muito obrigado(a),",
  },
  es: {
    subject: "Solicitud de una copia de",
    greeting: "Estimado/a autor/a,",
    intro: "He encontrado su artículo y me gustaría leerlo, pero no tengo acceso al texto completo:",
    ask: "¿Podría enviarme una copia? Es para mi investigación personal.",
    thanks: "Muchas gracias,",
  },
};

export function subjectText(lang: RequestLanguage, title: string): string {
  return `${WORDING[lang].subject} "${title}"`;
}

export interface BodyParts {
  citation: string;
  /** The DOI resolver address, when the paper has a DOI. */
  link: string | undefined;
  name: string;
  affiliation: string;
}

/** @returns the email body, lines separated by CRLF as RFC 6068 asks; the name and affiliation lines are left out when empty */
export function bodyText(lang: RequestLanguage, parts: BodyParts): string {
  const w = WORDING[lang];
  const lines = [w.greeting, "", w.intro, "", parts.citation];
  if (parts.link) { lines.push(parts.link); }
  lines.push("", w.ask, "", w.thanks);
  if (parts.name) { lines.push(parts.name); }
  if (parts.affiliation) { lines.push(parts.affiliation); }
  return lines.join("\r\n");
}
