import { retryFailedDownloads } from "./retry";
import { runScrape, type ScrapeOptions } from "./scrape";

function arg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

function printHelp() {
  process.stdout.write(`JurisScrape — scraper HTTP de jurisprudencia.pj.gob.pe

Uso:
  npm run scrape -- --query "contrato de trabajo" --max-pages 2
  npm run scrape -- --demo
  npm run scrape -- --retry --out ./output
  npm run scrape -- --no-pdf --delay 1200 --out ./output

Flags:
  --query <texto>     Búsqueda GENERAL (default: contrato de trabajo)
  --max-pages <n>     Páginas a recorrer (default: 2)
  --start-page <n>    Página inicial, 1-indexed (default: 1)
  --delay <ms>        Pausa entre requests (default: 900)
  --out <dir>         Carpeta de salida (default: ./output)
  --no-pdf            Solo metadatos, no descarga PDFs
  --demo              Parsea el fixture local (sin pegarle al PJ)
  --retry             Reintenta los PDFs de output/failed.json
  --help              Esta ayuda

El sitio del PJ está geo-restringido a IPs peruanas. Sin VPN el scraper
cae a modo demo y deja el pipeline listo para cuando haya salida en PE.
`);
}

async function main() {
  if (has("--help") || has("-h")) {
    printHelp();
    return;
  }

  const delayMs = Number(arg("--delay", "900"));
  const outputDir = arg("--out", "output") ?? "output";

  if (has("--retry")) {
    const result = await retryFailedDownloads(outputDir, delayMs, (e) => {
      process.stdout.write(`[${e.level.toUpperCase().padEnd(5)}] ${e.message}\n`);
    });
    process.stdout.write(`recovered=${result.recovered} stillFailed=${result.stillFailed.length}\n`);
    return;
  }

  const options: Partial<ScrapeOptions> = {
    query: arg("--query", "contrato de trabajo"),
    maxPages: Number(arg("--max-pages", "2")),
    startPage: Number(arg("--start-page", "1")),
    delayMs,
    outputDir,
    downloadPdfs: !has("--no-pdf") && !has("--demo"),
    forceDemo: has("--demo"),
  };

  const result = await runScrape(options, (e) => {
    const tag = e.level.toUpperCase().padEnd(5);
    process.stdout.write(`[${tag}] ${e.message}\n`);
  });

  process.stdout.write(
    `\nmode=${result.mode} docs=${result.documents.length} pdfs=${result.stats.pdfsDownloaded} failed=${result.failed.length} 429s=${result.stats.retries429}\n`,
  );
  if (result.geoBlocked && result.mode === "demo") {
    process.stdout.write("geo-blocked: usá una VPN de Perú para la corrida live.\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
