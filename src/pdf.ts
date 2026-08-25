import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { filenameFromDisposition, pdfFilename } from "./filenames";
import type { HttpClient } from "./http";
import type { FailedDownload, LogEvent, Resolution } from "./types";

const ORIGIN = "https://jurisprudencia.pj.gob.pe";

export function absolutePdfUrl(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("http://")) return href.replace(/^http:\/\//, "https://");
  if (href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${ORIGIN}${href}`;
  return `${ORIGIN}/jurisprudenciaweb/${href}`;
}

export async function downloadPdf(
  client: HttpClient,
  doc: Resolution,
  pdfsDir: string,
  log: (e: LogEvent) => void,
): Promise<{ file: string | null; failed: FailedDownload | null; retries429: number }> {
  const url = absolutePdfUrl(doc.pdfUrl);
  if (!url || !doc.uuid) {
    return {
      file: null,
      failed: {
        uuid: doc.uuid ?? "",
        pdfUrl: doc.pdfUrl ?? "",
        nroExpediente: doc.nroExpediente,
        reason: "Sin UUID / URL de PDF",
        status: null,
        attempts: 0,
        at: new Date().toISOString(),
      },
      retries429: 0,
    };
  }

  const before = client.getRetries429();
  const res = await client.get(url);
  const retries429 = client.getRetries429() - before;

  const looksPdf =
    (res.headers["content-type"] ?? "").includes("pdf") ||
    (res.headers["content-type"] ?? "").includes("octet-stream") ||
    (res.buffer && res.buffer.subarray(0, 5).toString("utf8") === "%PDF-");

  if (res.status !== 200 || !res.buffer || !looksPdf) {
    log({
      t: new Date().toISOString(),
      level: "error",
      message: `PDF falló ${doc.nroExpediente} → HTTP ${res.status}`,
    });
    return {
      file: null,
      failed: {
        uuid: doc.uuid,
        pdfUrl: url,
        nroExpediente: doc.nroExpediente,
        reason: `HTTP ${res.status} / no-pdf`,
        status: res.status,
        attempts: 5,
        at: new Date().toISOString(),
      },
      retries429,
    };
  }

  const fromHeader = filenameFromDisposition(res.headers["content-disposition"]);
  const name = fromHeader?.endsWith(".pdf") ? fromHeader : fromHeader ? `${fromHeader}.pdf` : pdfFilename(doc);
  const dest = join(pdfsDir, name);
  await writeFile(dest, res.buffer);
  log({
    t: new Date().toISOString(),
    level: "ok",
    message: `PDF ${name} (${res.buffer.length} bytes)`,
  });
  return { file: dest, failed: null, retries429 };
}
