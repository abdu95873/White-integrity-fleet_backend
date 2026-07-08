/** Calendar date from a DB/API date value (UTC date parts — matches upload period fields). */
export function toDateOnlyString(value) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateOnly(value) {
  if (!value) return new Date();
  const s =
    typeof value === "string"
      ? value.slice(0, 10)
      : value instanceof Date
        ? toDateOnlyString(value)
        : toDateOnlyString(new Date(value));
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
