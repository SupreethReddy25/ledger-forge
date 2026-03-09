const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUUID(value) {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value.trim());
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeText(value, maxLength = 250) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function isValidDateString(value) {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

module.exports = {
  isUUID,
  toPositiveNumber,
  normalizeText,
  clampInteger,
  isValidDateString
};
