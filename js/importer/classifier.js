/**
 * Classifies a PDF's document type by CONTENT, never by filename - the
 * app must work with any filename the user happens to save a download
 * as. See docs/ARCHITECTURE.md.
 */
async function classifyDocument(pdfDoc) {
  const text = (await BPIPdfReader.extractFullText(pdfDoc)).toUpperCase();
  if (text.includes("CARTEIRA DETALHADA")) return "carteira_detalhada";
  if (text.includes("CARACTER") && text.includes("COMERCIA") && text.includes("COMENT") && text.includes("GESTOR")) {
    return "ficha_mensal";
  }
  return null;
}

window.BPIClassifier = { classifyDocument };
