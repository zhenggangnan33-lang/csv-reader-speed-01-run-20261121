// Fast drop-in for make.fun's csv-reader 1.0.0.
// Spec: see BUILD_NOTES.md (competition description, program/v1).
// Semantics implemented:
//  - U+FEFF at the very start is dropped. A record ends at LF or CRLF; a line
//    left with no characters is no record. Outside quotes a CR not followed by
//    LF is dropped (stray_cr). A field opening with a quote runs to the next
//    non-doubled quote ("" inside is one quote; CRLF / lone CR inside reads
//    as LF); junk after the closing quote up to the next comma or line break
//    is appended as it stands (quote_junk, when the field ends); a quote that
//    never closes is a literal character and the text after it is read again
//    as unquoted (unterminated_quote). A quote inside an unquoted field is
//    literal. Fields stay strings, never trimmed or converted.
//  - columns is the first record when header is true, else null; rows are the
//    records after it (every record when header is false), each padded with
//    "" (short_row) or cut (long_row) to the first record's width.
//  - Each error is {code, line, row} in the order met; short_row also carries
//    `fields` (its field count) and long_row also carries `extra` (the cut
//    fields). line is the 1-based line its record starts on (counting every
//    LF, CRLF and lone CR inside quotes); row is its record's index in rows,
//    null for the header record. short_row / long_row are emitted when the
//    record ends, after any intra-record errors of that record.
//
// Speed design: records whose line has no '"' and no stray CR take a fast
// path (one slice + split(',') in C++). Anything with quotes or CRs takes a
// single-pass charCodeAt loop with slice-based field extraction (no per-char
// string building except where escapes / dropped CRs force it).

export function run(input) {
  const raw = input == null ? null : input.text;
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const header = input != null && input.header === true;
  const n = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let recordsSeen = 0; // records finished, header included
  let line = 1; // 1-based line number at the current position

  // Row index (in `rows`) of the record currently being parsed, null for header.
  const curRow = () =>
    header ? (recordsSeen === 0 ? null : recordsSeen - 1) : recordsSeen;

  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  // Monotonic caches for the next '"' / '\r' at or after i. indexOf() scans
  // are amortised: each cache is only re-scanned after the slow path has
  // consumed past the cached position, so total scanning stays O(n).
  let nextQuote = -1;
  let quoteDone = false;
  let nextCR = -1;
  let crDone = false;
  const quotePos = () => {
    if (!quoteDone && nextQuote < i) {
      nextQuote = text.indexOf('"', i);
      if (nextQuote === -1) quoteDone = true;
    }
    return nextQuote;
  };
  const crPos = () => {
    if (!crDone && nextCR < i) {
      nextCR = text.indexOf('\r', i);
      if (nextCR === -1) crDone = true;
    }
    return nextCR;
  };

  while (i < n) {
    const recordLine = line;
    let c = text.charCodeAt(i);

    // Empty lines are no record.
    if (c === 10) {
      i++;
      line++;
      continue;
    }
    if (c === 13) {
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        i += 2;
        line++;
        continue;
      }
      // Lone CR at record start: do NOT consume it here. Per the oracle it
      // belongs to the record's first (unquoted) field: the CR is dropped
      // with stray_cr inside that field, and a '"' after it is a literal
      // character in that field, not a quoted-field opener. Fall through to
      // the slow path, which handles the CR inside the field; a record left
      // holding only stray CRs is discarded there (see below).
    }

    // ---- Fast path: this record is exactly one line with no quotes / stray CR.
    // A quote or CR inside this line (other than a CRLF line ending) forces
    // the slow path; a quote / CR further ahead does not.
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? n : nl;
    const q = quotePos();
    const cr = crPos();
    const hasQuoteInLine = q !== -1 && q < lineEnd;
    const hasStrayCRInLine =
      cr !== -1 && cr < lineEnd && !(nl !== -1 && cr === nl - 1);
    if (!hasQuoteInLine && !hasStrayCRInLine) {
      let segEnd = lineEnd;
      if (nl !== -1 && segEnd > i && text.charCodeAt(segEnd - 1) === 13) segEnd--; // CRLF
      if (segEnd > i) {
        finishRecord(text.slice(i, segEnd).split(','), recordLine);
        i = nl === -1 ? n : nl + 1;
        if (nl !== -1) line++;
        continue;
      }
      // Line with no characters: advance past the terminator.
      i = nl === -1 ? n : nl + 1;
      if (nl !== -1) line++;
      continue;
    }

    // ---- Slow path: one record, single-pass char loop.
    const fields = [];
    let recDone = false;
    let lastQuoted = false; // whether the last field parsed started with '"'
    while (!recDone) {
      if (i >= n) {
        // Trailing empty field after a comma at EOF.
        lastQuoted = false;
        fields.push('');
        recDone = true;
        break;
      }
      lastQuoted = text.charCodeAt(i) === 34;

      if (text.charCodeAt(i) === 34) {
        // Quoted field: find the closing quote ("" is one escaped quote).
        let j = i + 1;
        let close = -1;
        let hasEsc = false;
        let lineDelta = 0;
        while (j < n) {
          const cc = text.charCodeAt(j);
          if (cc === 34) {
            if (j + 1 < n && text.charCodeAt(j + 1) === 34) {
              hasEsc = true;
              j += 2;
              continue;
            }
            close = j;
            break;
          }
          if (cc === 10) {
            lineDelta++;
            j++;
          } else if (cc === 13) {
            lineDelta++;
            j += j + 1 < n && text.charCodeAt(j + 1) === 10 ? 2 : 1;
          } else {
            j++;
          }
        }

        if (close === -1) {
          // Unterminated quote: it is a literal character; re-read the text
          // after it as unquoted. The scan above counted no lines (the breaks
          // it saw are record terminators in the re-read, counted there).
          errors.push({ code: 'unterminated_quote', line: recordLine, row: curRow() });
          // Fall through to the unquoted parse starting at i.
        } else {
          line += lineDelta;
          let val;
          if (!hasEsc && lineDelta === 0) {
            val = text.slice(i + 1, close);
          } else {
            // Build with "" -> " and CRLF / lone CR -> LF.
            const parts = [];
            let s = i + 1;
            let k = i + 1;
            while (k < close) {
              const cc = text.charCodeAt(k);
              if (cc === 34) {
                parts.push(text.slice(s, k));
                parts.push('"');
                k += 2;
                s = k;
              } else if (cc === 13) {
                parts.push(text.slice(s, k));
                parts.push('\n');
                k += k + 1 < close && text.charCodeAt(k + 1) === 10 ? 2 : 1;
                s = k;
              } else {
                k++;
              }
            }
            parts.push(text.slice(s, close));
            val = parts.join('');
          }
          i = close + 1;
          // Junk after the closing quote, up to comma / line break, appended
          // as it stands. A lone CR inside junk is dropped (stray_cr) and is
          // not itself junk: quote_junk fires only if a real junk character
          // was appended.
          let hasJunk = false;
          const junkParts = [];
          let segStart = i;
          while (i < n) {
            const cc = text.charCodeAt(i);
            if (cc === 44 || cc === 10) break;
            if (cc === 13) {
              if (i + 1 < n && text.charCodeAt(i + 1) === 10) break; // CRLF ends
              errors.push({ code: 'stray_cr', line: recordLine, row: curRow() });
              junkParts.push(text.slice(segStart, i));
              i++;
              segStart = i;
              continue;
            }
            hasJunk = true;
            i++;
          }
          if (hasJunk) {
            junkParts.push(text.slice(segStart, i));
            val += junkParts.join('');
            errors.push({ code: 'quote_junk', line: recordLine, row: curRow() });
          }
          fields.push(val);
          // Fall through to terminator handling below.
          if (i >= n) {
            recDone = true;
          } else {
            const cc = text.charCodeAt(i);
            if (cc === 44) {
              i++;
              if (i >= n) {
                fields.push('');
                recDone = true;
              }
            } else if (cc === 10) {
              i++;
              line++;
              recDone = true;
            } else if (cc === 13) {
              i += 2;
              line++;
              recDone = true;
            } else {
              recDone = true; // unreachable; defensive
            }
          }
          continue;
        }
      }

      // Unquoted field (also the re-read after an unterminated quote).
      // Quotes inside are literal; a lone CR is dropped (stray_cr).
      {
        const start = i;
        let parts = null;
        let segStart = i;
        while (i < n) {
          const cc = text.charCodeAt(i);
          if (cc === 44 || cc === 10) break;
          if (cc === 13) {
            if (i + 1 < n && text.charCodeAt(i + 1) === 10) break; // CRLF ends
            errors.push({ code: 'stray_cr', line: recordLine, row: curRow() });
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, i));
            i++;
            segStart = i;
            continue;
          }
          i++;
        }
        let val;
        if (parts !== null) {
          parts.push(text.slice(segStart, i));
          val = parts.join('');
        } else {
          val = text.slice(start, i);
        }
        fields.push(val);
        if (i >= n) {
          recDone = true;
        } else {
          const cc = text.charCodeAt(i);
          if (cc === 44) {
            i++;
            if (i >= n) {
              fields.push('');
              recDone = true;
            }
          } else if (cc === 10) {
            i++;
            line++;
            recDone = true;
          } else if (cc === 13) {
            i += 2;
            line++;
            recDone = true;
          } else {
            recDone = true; // unreachable; defensive
          }
        }
      }
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay). Oracle: a single unquoted empty field is
    // discarded; a single quoted empty field ('""') is a real record.
    if (!(fields.length === 1 && fields[0] === '' && !lastQuoted)) {
      finishRecord(fields, recordLine);
    }
  }

  function finishRecord(fields, recordLine) {
    const row = header ? (recordsSeen === 0 ? null : recordsSeen - 1) : recordsSeen;
    if (width === -1) {
      width = fields.length;
      if (header) {
        columns = fields;
      } else {
        rows.push(fields);
      }
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row, fields: fields.length });
      const padded = fields.slice();
      while (padded.length < width) padded.push('');
      rows.push(padded);
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row, extra: fields.slice(width) });
      rows.push(fields.slice(0, width));
    } else {
      rows.push(fields);
    }
    recordsSeen++;
  }

  // Oracle: header with no records at all returns columns [] (not null).
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
