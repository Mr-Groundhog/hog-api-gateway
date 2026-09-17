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
import axios from 'axios'

import { getServerErrorMessage } from '@/lib/server-error-message'

import { GENERATION_TIMEOUT_MS, IMAGE_STUDIO_API } from './constants'
import {
  extractImagesFromChatResponse,
  extractImagesFromImageResponse,
} from './lib/images'
import {
  getModelCapabilities,
  getModelEndpoint,
} from './lib/model-capabilities'
import {
  buildImageRequestBody,
  type ImageGenerationInput,
} from './lib/request-body'
import type {
  ChatCompletionResponse,
  ChatGenerationRequest,
  GeneratedImage,
  ImageEndpointResponse,
} from './types'

/**
 * Deliberately NOT the shared `api` instance: its request interceptor rewrites
 * `Authorization` with the dashboard session token, which would overwrite the
 * user's API key that these relay calls must present. This client carries no
 * interceptors at all and every call passes its own header.
 */
const relayClient = axios.create({
  baseURL: '',
  timeout: GENERATION_TIMEOUT_MS,
})

export type GenerateImagesParams = ImageGenerationInput & {
  apiKey: string
}

async function generateViaImagesEndpoint(
  params: GenerateImagesParams,
  signal?: AbortSignal
): Promise<GeneratedImage[]> {
  const body = buildImageRequestBody(params, getModelCapabilities(params.model))
  const response = await relayClient.post<ImageEndpointResponse>(
    IMAGE_STUDIO_API.GENERATIONS,
    body,
    {
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal,
    }
  )
  return extractImagesFromImageResponse(response.data)
}

async function generateViaChatEndpoint(
  params: GenerateImagesParams,
  signal?: AbortSignal
): Promise<GeneratedImage[]> {
  const body: ChatGenerationRequest = {
    model: params.model,
    messages: [{ role: 'user', content: params.prompt }],
    stream: false,
  }
  const response = await relayClient.post<ChatCompletionResponse>(
    IMAGE_STUDIO_API.CHAT_COMPLETIONS,
    body,
    {
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal,
    }
  )
  return extractImagesFromChatResponse(response.data)
}

/**
 * Generate images with the user's own API key, dispatching to whichever relay
 * endpoint the chosen model is served by. Failures are rethrown with the
 * upstream message so the caller can surface it verbatim.
 */
export async function generateImages(
  params: GenerateImagesParams,
  signal?: AbortSignal
): Promise<GeneratedImage[]> {
  try {
    if (getModelEndpoint(params.model) === 'chat') {
      return await generateViaChatEndpoint(params, signal)
    }
    return await generateViaImagesEndpoint(params, signal)
  } catch (error) {
    if (axios.isCancel(error)) {
      throw error
    }
    throw new Error(getServerErrorMessage(error, 'Failed to generate image'), {
      cause: error,
    })
  }
}
