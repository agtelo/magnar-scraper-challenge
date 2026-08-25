import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient, isGeoBlocked } from "./http";
import {
  findPaginationButtonName,
  findSearchButtonParams,
  snapshotForm,
  toSearchParams,
} from "./jsf";
import { parsePagination, parseResolutions } from "./parse";
import { downloadPdf } from "./pdf";
import { ensureOutput, writeDocuments, writeFailed, writeStats } from "./store";
import type {
  FailedDownload,
  LogEvent,
  PaginationInfo,
  ProbeResult,
  Resolution,
  ScrapeOptions,
  ScrapeResult,
  ScrapeStats,
} from "./types";

export const PJ_INICIO =
  "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml";
export const PJ_RESULTADO =
  "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml";
export const PJ_ORIGIN = "https://jurisprudencia.pj.gob.pe";

const FORM_ID = "formBuscador";

export const DEFAULT_OPTIONS: ScrapeOptions = {
  query: "contrato de trabajo",
  maxPages: 2,
  delayMs: 900,
  downloadPdfs: true,
  outputDir: "output",
  startPage: 1,
};

function nowIso() {
  return new Date().toISOString();
}

export async function probePj(): Promise<ProbeResult> {
  const client = new HttpClient({ delayMs: 0, timeoutMs: 20_000 });
  try {
    const res = await client.get(PJ_INICIO);
    const geoBlocked = isGeoBlocked(res);
    const titleMatch = res.body.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      ok: res.status >= 200 && res.status < 400 && !geoBlocked,
      status: res.status,
      url: res.url,
      geoBlocked,
      title: titleMatch?.[1]?.trim() ?? null,
      detail: geoBlocked
        ? "El Poder Judicial del Perú bloquea IPs fuera del país (WAF 403). Corré el scraper con una VPN de Perú."
        : `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: PJ_INICIO,
      geoBlocked: false,
      title: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScrape(
  partial: Partial<ScrapeOptions>,
  onLog?: (e: LogEvent) => void,
): Promise<ScrapeResult> {
  const options: ScrapeOptions = { ...DEFAULT_OPTIONS, ...partial };
  const logs: LogEvent[] = [];
  const log = (e: LogEvent) => {
    logs.push(e);
    onLog?.(e);
  };

  const startedAt = nowIso();
  const t0 = Date.now();
  const stats: ScrapeStats = {
    pagesVisited: 0,
    documentsFound: 0,
    pdfsDownloaded: 0,
    pdfsFailed: 0,
    retries429: 0,
    startedAt,
    finishedAt: null,
    durationMs: null,
  };

  const forceDemo = partial.forceDemo || process.env.JURIS_FORCE_DEMO === "1";
  if (forceDemo) {
    log({ t: nowIso(), level: "info", message: "Modo demo forzado (fixture local)." });
    const demo = await runDemo(options, log);
    return finish(demo, stats, logs, t0, "demo", true);
  }

  const probe = await probePj();
  if (!probe.ok) {
    log({
      t: nowIso(),
      level: "warn",
      message: probe.geoBlocked
        ? "Sitio geo-bloqueado (403). Ejecutando modo demo con fixture local."
        : `No se pudo alcanzar el sitio: ${probe.detail}`,
    });
    const demo = await runDemo(options, log);
    return finish(demo, stats, logs, t0, "demo", true);
  }

  const paths = await ensureOutput(options.outputDir);
  const client = new HttpClient({
    delayMs: options.delayMs,
    logger: log,
  });

  log({ t: nowIso(), level: "info", message: `GET sesión ${PJ_INICIO}` });
  const inicio = await client.get(PJ_INICIO);
  if (isGeoBlocked(inicio) || inicio.status >= 400) {
    log({ t: nowIso(), level: "error", message: `inicio.xhtml HTTP ${inicio.status}` });
    const demo = await runDemo(options, log);
    return finish(demo, stats, logs, t0, "demo", true);
  }

  const searchParams = findSearchButtonParams(inicio.body);
  const form = snapshotForm(inicio.body, FORM_ID);
  const queryField =
    Object.keys(form).find((k) => k.endsWith("txtBusqueda") || k.includes("txtBusqueda")) ??
    `${FORM_ID}:txtBusqueda`;
  form[queryField] = options.query;
  Object.assign(form, searchParams);

  log({
    t: nowIso(),
    level: "info",
    message: `POST búsqueda GENERAL “${options.query}”`,
  });
  const first = await client.post(PJ_INICIO, toSearchParams(form));
  if (first.status >= 400) {
    throw new Error(`La búsqueda devolvió HTTP ${first.status}`);
  }

  let html = first.body;
  let pagination: PaginationInfo = parsePagination(html);
  log({
    t: nowIso(),
    level: "ok",
    message: `${pagination.totalRecords} resultados · ${pagination.totalPages} páginas`,
  });

  const documents: Resolution[] = [];
  const failed: FailedDownload[] = [];
  const lastPage = Math.min(
    pagination.totalPages,
    options.startPage - 1 + options.maxPages,
  );

  for (let page = options.startPage; page <= lastPage; page++) {
    if (page !== pagination.currentPage) {
      const jump = snapshotForm(html, FORM_ID);
      jump[`${FORM_ID}:spinner`] = String(page);
      const ir = findPaginationButtonName(html);
      jump[ir] = "IR";
      log({ t: nowIso(), level: "info", message: `POST página ${page} (IR)` });
      const postUrl = /resultado\.xhtml/i.test(first.url) ? first.url : PJ_RESULTADO;
      const next = await client.post(postUrl, toSearchParams(jump));
      html = next.body;
      pagination = parsePagination(html);
    }

    const pageDocs = parseResolutions(html, page);
    stats.pagesVisited += 1;
    log({
      t: nowIso(),
      level: "ok",
      message: `Página ${page}/${pagination.totalPages}: ${pageDocs.length} resoluciones`,
    });

    for (const doc of pageDocs) {
      documents.push(doc);
      stats.documentsFound += 1;
      if (!options.downloadPdfs) continue;
      const result = await downloadPdf(client, doc, paths.pdfs, log);
      stats.retries429 += result.retries429;
      if (result.file) {
        doc.pdfFile = result.file;
        stats.pdfsDownloaded += 1;
      } else if (result.failed) {
        failed.push(result.failed);
        stats.pdfsFailed += 1;
      }
    }

    await writeDocuments(paths, documents);
    await writeFailed(paths, failed);
  }

  stats.retries429 += client.getRetries429();
  const finished = finish(
    { documents, failed, pagination, geoBlocked: false },
    stats,
    logs,
    t0,
    "live",
    false,
  );
  await writeStats(paths, finished.stats);
  await writeDocuments(paths, documents);
  await writeFailed(paths, failed);
  log({
    t: nowIso(),
    level: "ok",
    message: `Listo · ${stats.documentsFound} docs · ${stats.pdfsDownloaded} PDFs · ${stats.pdfsFailed} fallidos`,
  });
  return finished;
}

async function runDemo(
  options: ScrapeOptions,
  log: (e: LogEvent) => void,
): Promise<{
  documents: Resolution[];
  failed: FailedDownload[];
  pagination: PaginationInfo | null;
  geoBlocked: boolean;
}> {
  const html = await loadFixture();
  const pagination = parsePagination(html);
  const documents = parseResolutions(html, 1).slice(0, Math.max(1, options.maxPages * 2));
  log({
    t: nowIso(),
    level: "info",
    message: `Demo: parseadas ${documents.length} resoluciones del fixture (sin pegarle al PJ).`,
  });
  return { documents, failed: [], pagination, geoBlocked: true };
}

function finish(
  partial: {
    documents: Resolution[];
    failed: FailedDownload[];
    pagination: PaginationInfo | null;
    geoBlocked: boolean;
  },
  stats: ScrapeStats,
  logs: LogEvent[],
  t0: number,
  mode: "live" | "demo",
  geoBlocked: boolean,
): ScrapeResult {
  stats.documentsFound = partial.documents.length;
  stats.finishedAt = nowIso();
  stats.durationMs = Date.now() - t0;
  if (mode === "demo") stats.pagesVisited = Math.max(stats.pagesVisited, 1);
  return {
    documents: partial.documents,
    failed: partial.failed,
    stats,
    logs,
    pagination: partial.pagination,
    geoBlocked: geoBlocked || partial.geoBlocked,
    mode,
  };
}

export async function loadFixture(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "fixtures/resultado.html"),
    join(process.cwd(), "src/lib/scraper/fixtures/resultado.html"),
    join(process.cwd(), "test/fixtures/resultado.html"),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("No se encontró el fixture resultado.html");
}
