// Masks sensitive data before it reaches the model or any log.
// Order matters: IBANs and cards first, so their digits aren't mistaken for phone numbers.

const PATTERNS = [
  { type: 'IBAN', regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, valid: isIban },
  { type: 'CARD', regex: /\b\d(?:[ -]?\d){12,18}\b/g, valid: isCard },
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'PHONE', regex: /(?<![\w+])\+?\d[\d ()-]{7,17}\d\b/g, valid: isPhone },
];

export function redact(text) {
  const counts = {};
  let out = String(text);
  for (const { type, regex, valid } of PATTERNS) {
    out = out.replace(regex, (match) => {
      if (valid && !valid(match)) return match;
      counts[type] = (counts[type] || 0) + 1;
      return `[${type}]`;
    });
  }
  return { text: out, counts };
}

// Luhn checksum, so order numbers and timestamps aren't masked as cards.
function isCard(match) {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// ISO 13616 mod-97 check.
function isIban(match) {
  const iban = match.replace(/ /g, '');
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const val = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of val) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

// Dates and times like 2026-10-27, 27-10-2026 or 2026 10 27 are not phone numbers.
const DATE_LIKE = /^((19|20)\d{2}[-/. ](0?[1-9]|1[0-2])[-/. ](0?[1-9]|[12]\d|3[01])|(0?[1-9]|[12]\d|3[01])[-/. ](0?[1-9]|1[0-2])[-/. ](19|20)\d{2})(?!\d)/;

function isPhone(match) {
  const digits = match.replace(/\D/g, '');
  if (DATE_LIKE.test(match.replace(/^\+/, ''))) return false;
  return digits.length >= 8 && digits.length <= 15;
}
