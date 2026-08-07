/**
 * PDF -> words -> rows, on top of PDF.js.
 *
 * Mirrors the (already validated against real BPI documents) Python
 * reference implementation's approach: read every word with its bounding
 * box, group words into visual ROWS by y-proximity with a TOLERANCE (not
 * exact float equality - word baselines carry sub-pixel jitter that will
 * silently scramble left-to-right order if you sort on it directly),
 * then reason about structure from indentation/content, never from fixed
 * page coordinates.
 *
 * Word coordinates use the same convention as the Python reference
 * (top-down, "top"/"bottom" measured from the page's top edge) even
 * though PDF.js's native coordinate space is bottom-up - converted once
 * here so every downstream module speaks one consistent coordinate
 * system.
 */

/** Load a PDF from an ArrayBuffer. Returns a pdf.js PDFDocumentProxy. */
async function loadPdf(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}

/**
 * Words for one 1-indexed page. Each: {text, x0, x1, top, bottom, page}.
 * PDF.js text items are often sub-word fragments or multi-word runs
 * depending on the source PDF's internal text-run structure; we split on
 * internal whitespace and allocate x-position proportionally by
 * character count, which is an approximation but is only ever used for
 * ROW clustering and RELATIVE ordering, not pixel-exact layout.
 */
async function getPageWords(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const textContent = await page.getTextContent();

  const words = [];
  for (const item of textContent.items) {
    const str = item.str;
    if (!str || !str.trim()) continue;

    const x0Full = item.transform[4];
    const yBaseline = item.transform[5];
    const height = item.height || Math.abs(item.transform[3]) || 10;
    const width = item.width || 0;

    // Convert PDF's bottom-up y to top-down "distance from page top",
    // matching the Python reference's coordinate convention.
    const bottomFull = pageHeight - yBaseline;
    const topFull = bottomFull - height;

    const parts = str.split(/(\s+)/).filter((p) => p.length > 0);
    const totalChars = str.length || 1;
    let charOffset = 0;
    for (const part of parts) {
      const partWidth = width * (part.length / totalChars);
      const partX0 = x0Full + width * (charOffset / totalChars);
      charOffset += part.length;
      if (!part.trim()) continue; // whitespace-only fragment, skip
      words.push({
        text: part,
        x0: partX0,
        x1: partX0 + partWidth,
        top: topFull,
        bottom: bottomFull,
        page: pageNumber,
      });
    }
  }
  return words;
}

/** Cluster words into visual rows by y-proximity only (no column
 * splitting), each row's words sorted left-to-right. */
function clusterRows(words, yTolerance = 2.5) {
  const sorted = [...words].sort((a, b) => a.top - b.top);
  const rows = [];
  let rowRefTop = null;
  for (const word of sorted) {
    if (rowRefTop === null || Math.abs(word.top - rowRefTop) > yTolerance) {
      rows.push([]);
      rowRefTop = word.top;
    }
    rows[rows.length - 1].push(word);
  }
  for (const row of rows) row.sort((a, b) => a.x0 - b.x0);
  return rows;
}

/**
 * Row-cluster words, then split each row into separate "lines" wherever
 * a horizontal gap exceeds columnGap. Used for tables/sections where two
 * genuinely independent things share one visual row (see
 * ARCHITECTURE.md). Returns [{page, top, words: [...], text}].
 */
function extractLines(wordsByPage, yTolerance = 2.5, columnGap = 45) {
  const lines = [];
  for (const [pageNumber, words] of wordsByPage) {
    const rows = clusterRows(words, yTolerance);
    for (const rowWords of rows) {
      let current = null;
      let prevX1 = null;
      for (const word of rowWords) {
        const newColumn = current !== null && prevX1 !== null && (word.x0 - prevX1) > columnGap;
        if (current === null || newColumn) {
          current = { page: pageNumber, top: word.top, words: [] };
          lines.push(current);
        }
        current.words.push(word);
        prevX1 = word.x1;
      }
    }
  }
  for (const line of lines) {
    line.text = line.words.map((w) => w.text).join(" ");
    line.x0 = line.words.length ? line.words[0].x0 : 0;
  }
  return lines;
}

/** All pages' words as a Map<pageNumber, words[]>, plus a flat array. */
async function getAllWords(pdfDoc) {
  const byPage = new Map();
  const flat = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const words = await getPageWords(pdfDoc, p);
    byPage.set(p, words);
    flat.push(...words);
  }
  return { byPage, flat };
}

async function extractFullText(pdfDoc) {
  const { flat } = await getAllWords(pdfDoc);
  return clusterRows(flat).map((r) => r.map((w) => w.text).join(" ")).join("\n");
}

window.BPIPdfReader = {
  loadPdf, getPageWords, clusterRows, extractLines, getAllWords, extractFullText,
};
