/**
 * Uniform 'field' wrapper: every leaf value in parser output has the
 * same shape {value, confidence}, so a null value is never dressed up
 * with a false sense of certainty.
 */
function field(value, confidence = "high", extra = {}) {
  const out = { value, confidence: value === null || value === undefined ? "none" : confidence };
  Object.assign(out, extra);
  return out;
}

window.BPIField = { field };
