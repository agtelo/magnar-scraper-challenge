import * as cheerio from "cheerio";

const SKIP_INPUT_TYPES = new Set(["submit", "image", "button", "reset", "checkbox", "radio", "file"]);

/**
 * Snapshot of a JSF form as a browser would resend it on a full postback.
 * Submit/image buttons are omitted so the caller can add back only the one
 * it is "clicking". Checkboxes are skipped — echoing tooltip examples
 * back to this site can 500 the postback.
 */
export function snapshotForm(html: string, formId: string): Record<string, string> {
  const $ = cheerio.load(html);
  const form = $(`form#${cssEscape(formId)}`).first();
  const snap: Record<string, string> = {};
  if (!form.length) return snap;

  form.find("input").each((_, el) => {
    const node = $(el);
    const name = node.attr("name");
    if (!name) return;
    const type = (node.attr("type") || "text").toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return;
    snap[name] = node.attr("value") ?? "";
  });

  form.find("select").each((_, el) => {
    const node = $(el);
    const name = node.attr("name");
    if (!name) return;
    const selected = node.find("option[selected]").first();
    const chosen = selected.length ? selected : node.find("option").first();
    snap[name] = chosen.attr("value") ?? chosen.text().trim();
  });

  form.find("textarea").each((_, el) => {
    const node = $(el);
    const name = node.attr("name");
    if (name) snap[name] = node.text();
  });

  return snap;
}

export function extractViewState(html: string): string | null {
  const $ = cheerio.load(html);
  return $('input[name="javax.faces.ViewState"]').attr("value") ?? null;
}

/** Parse `{ 'a':'b', 'c':'d' }` pairs out of a mojarra.jsfcljs onclick. */
export function parseMojarraParams(onclick: string): Record<string, string> {
  const normalized = onclick.replace(/\\'/g, "'");
  const match = normalized.match(/mojarra\.jsfcljs\([^,]+,\s*\{([^}]*)\}/);
  if (!match?.[1]) return {};
  const params: Record<string, string> = {};
  const pairRe = /'([^']+)'\s*:\s*'([^']*)'/g;
  let pair: RegExpExecArray | null;
  while ((pair = pairRe.exec(match[1])) !== null) {
    params[pair[1]] = pair[2];
  }
  return params;
}

/**
 * Find the GENERAL search button. RichFaces/Mojarra generate j_idtNN ids
 * that shift between deploys, so we read the onclick instead of hardcoding.
 */
export function findSearchButtonParams(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const buttons = $('input[type="image"], input[type="submit"], a[onclick], button[onclick]');
  let fallback: Record<string, string> | null = null;

  buttons.each((_, el) => {
    const onclick = $(el).attr("onclick") ?? "";
    if (!onclick.includes("mojarra.jsfcljs") && !onclick.includes("forward=buscar")) return;
    const params = parseMojarraParams(onclick);
    if (Object.keys(params).length === 0) {
      const name = $(el).attr("name");
      if (name) fallback = { [name]: $(el).attr("value") ?? name };
      return;
    }
    const joined = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(" ");
    const isSearch = joined.includes("forward=buscar") || onclick.includes("forward=buscar");
    const isPrincipal = joined.includes("Principal") || params.busqueda === "especializada" || true;
    if (isSearch && isPrincipal) {
      fallback = params;
      return false;
    }
    if (isSearch) fallback = params;
  });

  if (fallback) return fallback;
  throw new Error("No se encontró el botón de búsqueda (mojarra.jsfcljs / forward=buscar).");
}

export function findPaginationButtonName(html: string): string {
  const $ = cheerio.load(html);
  const spinner = $('input[name="formBuscador:spinner"]').first();
  const scope = spinner.length ? spinner.closest("tr, table, form") : $("form#formBuscador");
  const button = scope.find('input[type="submit"][value="IR"]').first();
  const name = button.attr("name");
  if (!name) {
    const any = $('input[type="submit"][value="IR"]').first().attr("name");
    if (any) return any;
    throw new Error("No se encontró el botón IR de paginación.");
  }
  return name;
}

export function toSearchParams(fields: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.append(k, v);
  return params;
}

function cssEscape(id: string): string {
  return id.replace(/:/g, "\\:");
}
