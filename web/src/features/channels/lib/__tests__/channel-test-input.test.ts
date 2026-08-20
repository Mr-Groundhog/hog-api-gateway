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

import { getChannelTestInputs } from '../channel-test-input'

describe('getChannelTestInputs', () => {
  test('returns the exact chat prompt used by chat endpoint tests', () => {
    expect(getChannelTestInputs('openai')).toEqual([
      {
        category: 'Chat',
        label: 'Prompt',
        value: 'In the most concise way, tell me what month it is now.',
      },
    ])
  })

  test('returns endpoint-specific inputs', () => {
    expect(getChannelTestInputs('embeddings')).toEqual([
      {
        category: 'Embeddings',
        label: 'Input',
        value: 'What day is it today?',
      },
    ])
    expect(getChannelTestInputs('image-generation')).toEqual([
      {
        category: 'Image Generation',
        label: 'Prompt',
        value: 'a cute cat',
      },
    ])
    expect(getChannelTestInputs('jina-rerank')).toEqual([
      {
        category: 'Rerank',
        label: 'Query',
        value: 'What is Deep Learning?',
      },
      {
        category: 'Rerank',
        label: 'Documents',
        value:
          '1. Deep Learning is a subset of machine learning.\n2. Machine learning is a field of artificial intelligence.',
      },
    ])
  })

  test('shows all possible inputs when endpoint detection is automatic', () => {
    expect(getChannelTestInputs('auto')).toHaveLength(5)
  })
})
