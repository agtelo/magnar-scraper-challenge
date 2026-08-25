# JurisScrape

Scraper HTTP en **TypeScript** para el desafío de Magnar.

Sitio objetivo:

`https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml`

Sin Puppeteer, Playwright ni Selenium. Solo `axios` + `cheerio`.

> Magnar ya posee esta información. El scraper existe únicamente como desafío.

## Qué hace

1. Abre sesión JSF en `inicio.xhtml` (`JSESSIONID` + `javax.faces.ViewState`).
2. Dispara la búsqueda GENERAL (el botón se descubre leyendo `mojarra.jsfcljs`, sin hardcodear `j_idtNN`).
3. Pagina con el spinner + botón **IR** (salto absoluto a cualquier página).
4. Extrae de cada resolución: recurso, expediente, pretensión, tipo, fecha, sala, norma, sumilla, palabras clave y UUID del PDF.
5. Descarga `ServletDescarga?uuid=…` con nombre descriptivo.
6. Ante **429 / 5xx**: reintentos con backoff exponencial + jitter, respeta `Retry-After`, sigue con el siguiente documento y deja `output/failed.json` para `npm run retry`.

## Restricción geográfica

El PJ responde **403** desde IPs fuera de Perú (WAF). Corré el scraper con una VPN peruana para la corrida live.

Sin VPN:

```bash
npm run demo
```

Parsea un fixture realista de `resultado.xhtml` y demuestra extracción, paginación y el resto del pipeline.

## Setup

```bash
git clone https://github.com/agtelo/magnar-scraper-challenge.git
cd magnar-scraper-challenge
npm install
```

Node 22+.

## Uso

```bash
# 2 páginas de “contrato de trabajo”, con PDFs
npm run scrape -- --query "contrato de trabajo" --max-pages 2

# Solo metadatos
npm run scrape -- --query casacion --max-pages 5 --no-pdf --delay 1200

# Reanudar desde la página 10
npm run scrape -- --start-page 10 --max-pages 3 --out ./output

# Reintentar PDFs que cayeron por 429
npm run retry -- --out ./output

# Fixture local (sin pegarle al PJ)
npm run demo
```

Salida:

```
output/
  documentos.json
  documentos.csv
  failed.json
  stats.json
  pdfs/
    020788-2024_Casacion_01-06-2026_ed05892f.pdf
```

## Arquitectura

```
src/
  index.ts      CLI
  http.ts       axios + cookie jar + delay + rewrite http→https
  jsf.ts        ViewState, snapshot del form, botones dinámicos
  parse.ts      resoluciones y paginación
  pdf.ts        descarga con backoff
  scrape.ts     orquestación
  retry.ts      reprocesa failed.json
  backoff.ts    429 / 5xx
```

El HTML de resultados es un **postback completo** (no el binario AJAX de RichFaces). Por eso cheerio alcanza.

## Tests

```bash
npm test
```

Cubre parseo del fixture, números en formato ES, nombres de archivo, backoff y helpers JSF.

## Criterios del desafío

| Requisito | Dónde |
| --- | --- |
| TypeScript | todo `src/` |
| Sin browser automation | `package.json` — solo axios y cheerio |
| Navegar páginas | `scrape.ts` + spinner/IR |
| Extraer cada documento | `parse.ts` |
| Descargar PDFs | `pdf.ts` |
| 429 + backoff exponencial | `http.ts` / `backoff.ts` |
| Seguir si persiste el error | `scrape.ts` no aborta el lote |
| Log de fallidos + retry | `output/failed.json`, `npm run retry` |
