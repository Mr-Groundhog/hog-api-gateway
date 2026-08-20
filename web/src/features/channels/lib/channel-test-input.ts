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

export type ChannelTestInput = {
  category: 'Chat' | 'Embeddings' | 'Image Generation' | 'Rerank'
  label: 'Prompt' | 'Input' | 'Query' | 'Documents'
  value: string
}

const CHAT_TEST_PROMPT =
  'In the most concise way, tell me what month it is now.'
const EMBEDDING_TEST_INPUT = 'What day is it today?'
const IMAGE_TEST_PROMPT = 'a cute cat'
const RERANK_TEST_QUERY = 'What is Deep Learning?'
const RERANK_TEST_DOCUMENTS =
  '1. Deep Learning is a subset of machine learning.\n2. Machine learning is a field of artificial intelligence.'

const CHAT_TEST_INPUT: ChannelTestInput = {
  category: 'Chat',
  label: 'Prompt',
  value: CHAT_TEST_PROMPT,
}

const ENDPOINT_TEST_INPUTS: Record<string, ChannelTestInput[]> = {
  embeddings: [
    { category: 'Embeddings', label: 'Input', value: EMBEDDING_TEST_INPUT },
  ],
  'image-generation': [
    { category: 'Image Generation', label: 'Prompt', value: IMAGE_TEST_PROMPT },
  ],
  'jina-rerank': [
    { category: 'Rerank', label: 'Query', value: RERANK_TEST_QUERY },
    {
      category: 'Rerank',
      label: 'Documents',
      value: RERANK_TEST_DOCUMENTS,
    },
  ],
  anthropic: [CHAT_TEST_INPUT],
  gemini: [CHAT_TEST_INPUT],
  openai: [CHAT_TEST_INPUT],
  'openai-response': [CHAT_TEST_INPUT],
  'openai-response-compact': [CHAT_TEST_INPUT],
}

const AUTO_TEST_INPUTS: ChannelTestInput[] = [
  CHAT_TEST_INPUT,
  { category: 'Embeddings', label: 'Input', value: EMBEDDING_TEST_INPUT },
  { category: 'Image Generation', label: 'Prompt', value: IMAGE_TEST_PROMPT },
  { category: 'Rerank', label: 'Query', value: RERANK_TEST_QUERY },
  {
    category: 'Rerank',
    label: 'Documents',
    value: RERANK_TEST_DOCUMENTS,
  },
]

export function getChannelTestInputs(endpointType: string): ChannelTestInput[] {
  return ENDPOINT_TEST_INPUTS[endpointType] ?? AUTO_TEST_INPUTS
}
