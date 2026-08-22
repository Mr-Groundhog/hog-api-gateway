/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

/** A slice of the request content; `matchIndex` is the ordinal of the hit, or null for plain text. */
export type ContentSegment = {
  text: string
  matchIndex: number | null
}

const ASCII_WORD_PATTERN = /^[a-zA-Z0-9_]+$/

function isAsciiWordChar(char: string | undefined): boolean {
  return char !== undefined && ASCII_WORD_PATTERN.test(char)
}

/**
 * parseMatchedWords reads the `matched_words` column, stored as a JSON string array,
 * and falls back to a comma-separated list for legacy rows.
 */
export function parseMatchedWords(raw: string | undefined): string[] {
  const trimmed = raw?.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const words = parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
        return [...new Set(words)]
      }
    } catch {
      // Not valid JSON, fall through to the comma-separated form below.
    }
  }

  const words = trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return [...new Set(words)]
}

/**
 * findMatchSegments splits the request content into plain and matched slices so the UI can
 * highlight every hit and scroll to it. Matching mirrors the backend detector
 * (`service.SensitiveWordContains`): the comparison is case-insensitive, and pure ASCII words
 * only match on word boundaries so that "hi" does not light up inside "this".
 */
export function findMatchSegments(
  content: string,
  words: string[]
): ContentSegment[] {
  if (!content) return []

  // Lowercasing a few locale-specific characters changes the string length, which would shift
  // every offset; fall back to a case-sensitive scan in that rare case.
  const lowered = content.toLowerCase()
  const foldCase = lowered.length === content.length
  const haystack = foldCase ? lowered : content

  const ranges: Array<{ start: number; end: number }> = []
  for (const word of words) {
    const needle = foldCase ? word.toLowerCase() : word
    if (!needle) continue
    const wholeWordOnly = ASCII_WORD_PATTERN.test(needle)
    let from = 0
    while (from <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, from)
      if (start < 0) break
      const end = start + needle.length
      const onBoundary =
        !isAsciiWordChar(haystack[start - 1]) && !isAsciiWordChar(haystack[end])
      if (!wholeWordOnly || onBoundary) ranges.push({ start, end })
      from = start + 1
    }
  }

  // Longest hit wins when several words start at the same offset, and overlapping hits are
  // dropped so each character belongs to exactly one segment.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)

  const segments: ContentSegment[] = []
  let cursor = 0
  let matchIndex = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    if (range.start > cursor) {
      segments.push({ text: content.slice(cursor, range.start), matchIndex: null })
    }
    segments.push({ text: content.slice(range.start, range.end), matchIndex })
    matchIndex += 1
    cursor = range.end
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), matchIndex: null })
  }
  return segments
}
