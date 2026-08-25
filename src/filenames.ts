export function sanitizeFilename(raw: string, max = 80): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "documento").slice(0, max);
}

export function pdfFilename(doc: {
  nroExpediente: string;
  recurso: string;
  fechaResolucion: string;
  uuid: string | null;
}): string {
  const parts = [
    doc.nroExpediente || "sin-expediente",
    doc.recurso,
    doc.fechaResolucion.replace(/\//g, "-"),
    doc.uuid ? doc.uuid.slice(0, 8) : "",
  ]
    .map((p) => sanitizeFilename(p, 40))
    .filter(Boolean);
  return `${parts.join("_")}.pdf`;
}

export function filenameFromDisposition(header: string | undefined): string | null {
  if (!header) return null;
  const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) return sanitizeFilename(decodeURIComponent(utf[1]));
  const plain = header.match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) return sanitizeFilename(plain[1]);
  return null;
}
