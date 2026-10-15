export const MAX_TAGS = 10;
// 1-20 chars: letters/numbers, then also spaces, &, ', - (any language).
// \p{M} matters: Hindi vowel signs (matras) are marks, not letters.
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} &'-]{0,19}$/u;

export const normalizeTag = (tag) =>
  typeof tag === "string" ? tag.trim().replace(/\s+/g, " ").toLowerCase() : "";

export const isValidTag = (tag) => TAG_RE.test(tag);

// Clean a user-supplied tag list: trimmed, lower-case, de-duplicated.
// Returns { tags } or { error }.
export function normalizeTags(input) {
  if (!Array.isArray(input)) return { error: "Tags must be a list." };
  const tags = [...new Set(input.map(normalizeTag).filter(Boolean))];
  if (tags.length > MAX_TAGS) {
    return { error: `Use at most ${MAX_TAGS} tags.` };
  }
  const bad = tags.find((t) => !isValidTag(t));
  if (bad) {
    return {
      error: `"${bad.slice(0, 30)}" isn't a valid tag: 1-20 letters, numbers, spaces, & ' or -.`,
    };
  }
  return { tags };
}
