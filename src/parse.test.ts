import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { delayForAttempt, parseRetryAfter, isRetryableStatus } from "./backoff";
import { parseMojarraParams, snapshotForm, findPaginationButtonName } from "./jsf";
import { parseEsNumber, parsePagination, parseResolutions } from "./parse";
import { pdfFilename, sanitizeFilename } from "./filenames";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/resultado.html"),
  "utf8",
);

describe("parseResolutions", () => {
  it("extracts both resolutions from the fixture", () => {
    const docs = parseResolutions(fixture, 1);
    assert.equal(docs.length, 2);
    assert.equal(docs[0]?.recurso, "Casación");
    assert.equal(docs[0]?.nroExpediente, "020788-2024");
    assert.match(docs[0]?.pretension ?? "", /Beneficios Sociales/);
    assert.equal(docs[0]?.tipoResolucion, "Ejecutoria Suprema");
    assert.equal(docs[0]?.fechaResolucion, "01/06/2026");
    assert.equal(docs[0]?.uuid, "ed05892f-6952-4c79-ac3d-8c4614818d59");
    assert.equal(docs[1]?.recurso, "Apelación");
    assert.equal(docs[1]?.uuid, "87870594-c568-4529-bfab-b262dc92a684");
    assert.equal(docs[1]?.sumilla, "");
  });
});

describe("parsePagination", () => {
  it("reads spinner max, current page and total records", () => {
    const p = parsePagination(fixture);
    assert.equal(p.currentPage, 1);
    assert.equal(p.totalPages, 1767);
    assert.equal(p.totalRecords, 17667);
  });
});

describe("jsf helpers", () => {
  it("snapshots the search form without submit buttons", () => {
    const snap = snapshotForm(fixture, "formBuscador");
    assert.equal(snap["javax.faces.ViewState"], "11:22");
    assert.equal(snap["formBuscador:txtBusqueda"], "contrato de trabajo");
    assert.equal(snap["formBuscador:j_idt447"], undefined);
  });

  it("finds the IR pagination button relative to the spinner", () => {
    assert.equal(findPaginationButtonName(fixture), "formBuscador:j_idt447");
  });

  it("parses mojarra.jsfcljs params", () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('formBuscador'),{'forward':'buscar','busqueda':'especializada','formBuscador:j_idt21':'21'},'');";
    const params = parseMojarraParams(onclick);
    assert.equal(params.forward, "buscar");
    assert.equal(params.busqueda, "especializada");
  });
});

describe("numbers and filenames", () => {
  it("parses Spanish thousand separators", () => {
    assert.equal(parseEsNumber("17.667"), 17667);
    assert.equal(parseEsNumber("17,667"), 17667);
    assert.equal(parseEsNumber("17667"), 17667);
  });

  it("builds a descriptive pdf name", () => {
    const name = pdfFilename({
      nroExpediente: "020788-2024",
      recurso: "Casación",
      fechaResolucion: "01/06/2026",
      uuid: "ed05892f-6952-4c79-ac3d-8c4614818d59",
    });
    assert.match(name, /020788-2024/);
    assert.match(name, /Casacion/);
    assert.match(name, /\.pdf$/);
    assert.equal(sanitizeFilename('a<>:"/b'), "a_b");
  });
});

describe("backoff", () => {
  it("treats 429 and 5xx as retryable", () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(200), false);
    assert.equal(isRetryableStatus(404), false);
  });

  it("parses Retry-After seconds", () => {
    assert.equal(parseRetryAfter("12"), 12000);
  });

  it("grows exponentially and respects cap", () => {
    const d0 = delayForAttempt(0, { baseMs: 1000, capMs: 10_000, jitter: 0 });
    const d3 = delayForAttempt(3, { baseMs: 1000, capMs: 10_000, jitter: 0 });
    assert.equal(d0, 1000);
    assert.equal(d3, 8000);
    const capped = delayForAttempt(8, { baseMs: 1000, capMs: 10_000, jitter: 0 });
    assert.equal(capped, 10_000);
  });
});
