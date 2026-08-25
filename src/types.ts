export type Resolution = {
  uuid: string | null;
  pdfUrl: string | null;
  recurso: string;
  nroExpediente: string;
  pretension: string;
  tipoResolucion: string;
  fechaResolucion: string;
  sala: string;
  normaDI: string;
  sumilla: string;
  palabrasClave: string;
  page: number;
  pdfFile: string | null;
};

export type PaginationInfo = {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
};

export type FailedDownload = {
  uuid: string;
  pdfUrl: string;
  nroExpediente: string;
  reason: string;
  status: number | null;
  attempts: number;
  at: string;
};

export type ScrapeStats = {
  pagesVisited: number;
  documentsFound: number;
  pdfsDownloaded: number;
  pdfsFailed: number;
  retries429: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

export type LogLevel = "info" | "warn" | "error" | "ok";

export type LogEvent = {
  t: string;
  level: LogLevel;
  message: string;
};

export type ProbeResult = {
  ok: boolean;
  status: number;
  url: string;
  geoBlocked: boolean;
  title: string | null;
  detail: string;
};

export type ScrapeOptions = {
  query: string;
  maxPages: number;
  delayMs: number;
  downloadPdfs: boolean;
  outputDir: string;
  startPage: number;
  forceDemo?: boolean;
};

export type ScrapeResult = {
  documents: Resolution[];
  failed: FailedDownload[];
  stats: ScrapeStats;
  logs: LogEvent[];
  pagination: PaginationInfo | null;
  geoBlocked: boolean;
  mode: "live" | "demo";
};

export type HttpResponse = {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  buffer: Buffer | null;
};
