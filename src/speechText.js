const { compactResponse } = require('./responsePolicy');
const MAX_SPEECH_CHARS = 1500;
const MAX_CHUNK_CHARS = 280;

function speechText(text) {
  return String(text).replace(/https?:\/\/\S+/g, '').replace(/[*_`#<>]/g, '').replace(/\s+/g, ' ').trim();
}

function speechChunks(text) {
  let remaining = compactResponse(speechText(text), MAX_SPEECH_CHARS);
  const chunks = [];
  while (remaining) {
    if (remaining.length <= MAX_CHUNK_CHARS) { chunks.push(remaining); break; }
    const prefix = remaining.slice(0, MAX_CHUNK_CHARS);
    const sentences = [...prefix.matchAll(/[.!?](?=\s|$)/g)];
    let end = sentences.at(-1)?.index;
    end = end === undefined ? prefix.lastIndexOf(' ') : end + 1;
    if (end <= 0) end = MAX_CHUNK_CHARS;
    // A long unbroken word may span chunks; never split a Unicode surrogate pair.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end])) end--;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trimStart();
  }
  return chunks;
}

module.exports = { speechText, speechChunks, MAX_CHUNK_CHARS, MAX_SPEECH_CHARS };
