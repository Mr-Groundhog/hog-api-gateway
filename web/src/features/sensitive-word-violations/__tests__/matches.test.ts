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
import { describe, expect, test } from 'vitest'

import { findMatchSegments, parseMatchedWords } from '../lib/matches'

describe('parseMatchedWords', () => {
  test('reads the JSON array stored by the backend', () => {
    expect(parseMatchedWords('["secret","炸弹"]')).toEqual(['secret', '炸弹'])
  })

  test('drops duplicates and blank entries', () => {
    expect(parseMatchedWords('["secret","","secret"," "]')).toEqual(['secret'])
  })

  test('falls back to a comma-separated list for legacy rows', () => {
    expect(parseMatchedWords('secret, 炸弹')).toEqual(['secret', '炸弹'])
  })

  test('returns no words for empty or unusable input', () => {
    expect(parseMatchedWords(undefined)).toEqual([])
    expect(parseMatchedWords('   ')).toEqual([])
    expect(parseMatchedWords('[not json')).toEqual(['[not json'])
  })
})

describe('findMatchSegments', () => {
  test('returns no segment for empty content', () => {
    expect(findMatchSegments('', ['secret'])).toEqual([])
  })

  test('returns the whole content as plain text when nothing matches', () => {
    expect(findMatchSegments('hello world', ['secret'])).toEqual([
      { text: 'hello world', matchIndex: null },
    ])
  })

  test('numbers every hit in reading order', () => {
    expect(findMatchSegments('a secret and a secret', ['secret'])).toEqual([
      { text: 'a ', matchIndex: null },
      { text: 'secret', matchIndex: 0 },
      { text: ' and a ', matchIndex: null },
      { text: 'secret', matchIndex: 1 },
    ])
  })

  test('matches case-insensitively and keeps the original casing', () => {
    expect(findMatchSegments('A SECRET plan', ['secret'])).toEqual([
      { text: 'A ', matchIndex: null },
      { text: 'SECRET', matchIndex: 0 },
      { text: ' plan', matchIndex: null },
    ])
  })

  test('highlights Chinese words without word boundaries', () => {
    expect(findMatchSegments('这是炸弹信息', ['炸弹'])).toEqual([
      { text: '这是', matchIndex: null },
      { text: '炸弹', matchIndex: 0 },
      { text: '信息', matchIndex: null },
    ])
  })

  test('skips ASCII words inside longer words like the backend detector', () => {
    expect(findMatchSegments('this hi there', ['hi'])).toEqual([
      { text: 'this ', matchIndex: null },
      { text: 'hi', matchIndex: 0 },
      { text: ' there', matchIndex: null },
    ])
  })

  test('keeps the longest word when two words start at the same offset', () => {
    expect(findMatchSegments('炸弹制作教程', ['炸弹', '炸弹制作'])).toEqual([
      { text: '炸弹制作', matchIndex: 0 },
      { text: '教程', matchIndex: null },
    ])
  })

  test('never overlaps two hits on the same characters', () => {
    expect(findMatchSegments('炸弹弹药', ['炸弹', '弹药'])).toEqual([
      { text: '炸弹', matchIndex: 0 },
      { text: '弹药', matchIndex: 1 },
    ])
  })
})
