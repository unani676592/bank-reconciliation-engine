// ============================================================
// Tiny CSV parser - NO npm dependencies.
// Used ONLY by tests and the PowerShell smoke script to turn the
// reference CSV files into arrays of row objects. The production
// API accepts JSON arrays directly and never touches this file.
//
// Handles: header row, quoted fields, commas inside quotes,
// escaped double-quotes ("") inside quotes, and CRLF or LF.
// ============================================================

function parseCsv(text) {
  const rows = parseRows(String(text));
  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i];
    // Skip fully blank trailing lines.
    if (fields.length === 1 && fields[0].trim() === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = fields[c] !== undefined ? fields[c] : '';
    }
    out.push(obj);
  }
  return out;
}

// Splits raw CSV text into an array of rows, each an array of field strings.
function parseRows(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue; // handled by the \n branch
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }

  // Flush the final field/row if the file did not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

module.exports = { parseCsv };
