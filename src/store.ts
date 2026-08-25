import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FailedDownload, Resolution, ScrapeStats } from "./types";

export type OutputPaths = {
  dir: string;
  json: string;
  csv: string;
  failed: string;
  stats: string;
  pdfs: string;
};

export function outputPaths(dir: string): OutputPaths {
  return {
    dir,
    json: join(dir, "documentos.json"),
    csv: join(dir, "documentos.csv"),
    failed: join(dir, "failed.json"),
    stats: join(dir, "stats.json"),
    pdfs: join(dir, "pdfs"),
  };
}

export async function ensureOutput(dir: string): Promise<OutputPaths> {
  const paths = outputPaths(dir);
  await mkdir(paths.pdfs, { recursive: true });
  return paths;
}

export async function writeDocuments(paths: OutputPaths, docs: Resolution[]) {
  await writeFile(paths.json, JSON.stringify(docs, null, 2), "utf8");
  await writeFile(paths.csv, toCsv(docs), "utf8");
}

export async function writeFailed(paths: OutputPaths, failed: FailedDownload[]) {
  await writeFile(paths.failed, JSON.stringify(failed, null, 2), "utf8");
}

export async function writeStats(paths: OutputPaths, stats: ScrapeStats) {
  await writeFile(paths.stats, JSON.stringify(stats, null, 2), "utf8");
}

export async function readFailed(paths: OutputPaths): Promise<FailedDownload[]> {
  try {
    const raw = await readFile(paths.failed, "utf8");
    return JSON.parse(raw) as FailedDownload[];
  } catch {
    return [];
  }
}

const CSV_COLUMNS: (keyof Resolution)[] = [
  "uuid",
  "nroExpediente",
  "recurso",
  "pretension",
  "tipoResolucion",
  "fechaResolucion",
  "sala",
  "normaDI",
  "sumilla",
  "palabrasClave",
  "page",
  "pdfUrl",
  "pdfFile",
];

function toCsv(docs: Resolution[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = docs.map((doc) =>
    CSV_COLUMNS.map((col) => csvCell(doc[col])).join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
