export const MAX_AMOUNT = 10000000;

// Positive number with at most 2 decimals, or null
export const parseAmount = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
};
