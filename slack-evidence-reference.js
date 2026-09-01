"use strict";

function extractSlackEvidenceReference(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (/^F[A-Z0-9]+$/.test(String(value.id || ""))) {
    return {
      fileId: value.id,
      permalink: typeof value.permalink === "string" ? value.permalink : null,
    };
  }
  for (const key of ["file", "files"]) {
    const nested = value[key];
    const entries = Array.isArray(nested) ? nested : [nested];
    for (const entry of entries) {
      const reference = extractSlackEvidenceReference(entry, seen);
      if (reference) return reference;
    }
  }
  return null;
}

module.exports = { extractSlackEvidenceReference };
