import { HttpClient } from "./http";
import { downloadPdf } from "./pdf";
import { ensureOutput, readFailed, writeFailed } from "./store";
import type { FailedDownload, LogEvent, Resolution } from "./types";

export async function retryFailedDownloads(
  outputDir: string,
  delayMs: number,
  log: (e: LogEvent) => void,
): Promise<{ recovered: number; stillFailed: FailedDownload[] }> {
  const paths = await ensureOutput(outputDir);
  const previous = await readFailed(paths);
  if (previous.length === 0) {
    log({ t: new Date().toISOString(), level: "info", message: "No hay fallidos en failed.json" });
    return { recovered: 0, stillFailed: [] };
  }

  const client = new HttpClient({ delayMs, logger: log });
  const stillFailed: FailedDownload[] = [];
  let recovered = 0;

  for (const item of previous) {
    const stub: Resolution = {
      uuid: item.uuid,
      pdfUrl: item.pdfUrl,
      recurso: "",
      nroExpediente: item.nroExpediente,
      pretension: "",
      tipoResolucion: "",
      fechaResolucion: "",
      sala: "",
      normaDI: "",
      sumilla: "",
      palabrasClave: "",
      page: 0,
      pdfFile: null,
    };
    log({
      t: new Date().toISOString(),
      level: "info",
      message: `Reintento PDF ${item.nroExpediente} (${item.uuid})`,
    });
    const result = await downloadPdf(client, stub, paths.pdfs, log);
    if (result.file) recovered += 1;
    else if (result.failed) stillFailed.push(result.failed);
  }

  await writeFailed(paths, stillFailed);
  log({
    t: new Date().toISOString(),
    level: "ok",
    message: `Retry listo · recuperados ${recovered} · siguen fallando ${stillFailed.length}`,
  });
  return { recovered, stillFailed };
}
