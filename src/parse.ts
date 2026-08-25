import * as cheerio from "cheerio";
import type { PaginationInfo, Resolution } from "./types";

const SERVLET_RE = /ServletDescarga\?uuid=([0-9a-fA-F-]+)/i;

const LABEL_MAP: Record<string, keyof Pick<
  Resolution,
  "pretension" | "tipoResolucion" | "fechaResolucion" | "sala" | "normaDI" | "sumilla" | "palabrasClave"
>> = {
  "pretensión/delito": "pretension",
  "pretension/delito": "pretension",
  "tipo resolución": "tipoResolucion",
  "tipo resolucion": "tipoResolucion",
  "fecha resolución": "fechaResolucion",
  "fecha resolucion": "fechaResolucion",
  "sala suprema": "sala",
  "órgano jurisdiccional": "sala",
  "organo jurisdiccional": "sala",
  "norma de derecho interno": "normaDI",
  sumilla: "sumilla",
  "palabras clave": "palabrasClave",
};

export function parseEsNumber(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  if (/\.\d{3}(?:\.\d{3})*$/.test(t) && !t.includes(",")) {
    return Number(t.replace(/\./g, "")) || 0;
  }
  if (/,\d{3}(?:,\d{3})*$/.test(t) && !t.includes(".")) {
    return Number(t.replace(/,/g, "")) || 0;
  }
  return Number(t.replace(/[^\d]/g, "")) || 0;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseResolutions(html: string, page: number): Resolution[] {
  const $ = cheerio.load(html);
  const docs: Resolution[] = [];
  const seen = new Set<string>();

  $('a[href*="ServletDescarga"]').each((_, link) => {
    const href = $(link).attr("href") ?? "";
    const uuid = href.match(SERVLET_RE)?.[1] ?? null;
    const panel = $(link).closest("div.rf-p");
    if (!panel.length) return;

    const key = uuid ?? `${page}:${docs.length}`;
    if (seen.has(key)) return;
    seen.add(key);

    const header = panel.find("div.rf-p-hdr").first();
    const bolds = header.find('span[style*="bold"], span.txtbold, strong');
    const recurso = tidy(bolds.eq(0).text());
    const nroExpediente = tidy(bolds.eq(1).text());

    const doc: Resolution = {
      uuid,
      pdfUrl: href || null,
      recurso,
      nroExpediente,
      pretension: "",
      tipoResolucion: "",
      fechaResolucion: "",
      sala: "",
      normaDI: "",
      sumilla: "",
      palabrasClave: "",
      page,
      pdfFile: null,
    };

    panel.find(".txtbold").each((_, lab) => {
      const label = tidy($(lab).text())
        .replace(/:\s*$/, "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const mapped = LABEL_MAP[label] ?? LABEL_MAP[tidy($(lab).text()).replace(/:\s*$/, "").toLowerCase()];
      if (!mapped) return;
      const valueNode = $(lab).nextAll("div").first().length
        ? $(lab).nextAll("div").first()
        : $(lab).parent().find("div").not(".txtbold").first();
      const value = tidy(valueNode.text());
      doc[mapped] = value;
    });

    doc.sumilla = doc.sumilla.replace(/^sumilla:\s*/i, "");
    docs.push(doc);
  });

  return docs;
}

export function parsePagination(html: string): PaginationInfo {
  const $ = cheerio.load(html);
  const resultText =
    $("#formBuscador\\:optResultado").text() ||
    html.match(/se obtuvieron[\s\S]{0,40}resultados/i)?.[0] ||
    "";

  const totalRecords = parseEsNumber(
    resultText.match(/se obtuvieron\s+([\d.,]+)\s+resultados/i)?.[1] ?? "0",
  );

  const spinnerValue = $('input[name="formBuscador:spinner"]').attr("value");
  const currentFromSpinner = spinnerValue ? Number(spinnerValue) : NaN;
  const currentFromScript = Number(html.match(/"currentPage"\s*:\s*(\d+)/)?.[1] ?? "1");
  const currentPage = Number.isFinite(currentFromSpinner) && currentFromSpinner > 0
    ? currentFromSpinner
    : currentFromScript || 1;

  const maxFromSpinner = Number(html.match(/maxValue:\s*(\d+)/)?.[1] ?? "0");
  const perPage = 10;
  const totalPages = maxFromSpinner || Math.max(1, Math.ceil(totalRecords / perPage));

  return { currentPage, totalPages, totalRecords };
}
