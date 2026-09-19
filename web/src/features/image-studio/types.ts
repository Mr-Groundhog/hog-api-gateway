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
/** Which relay endpoint a given model must be called through. */
export type ImageEndpoint = 'images' | 'chat'

/** Request body for `POST /v1/images/generations`. */
export interface ImageRequestFields {
  model: string
  prompt: string
  n?: number
  size?: string
  /** Aspect ratio, for providers that take one alongside a size tier. */
  ratio?: string
  quality?: string
  output_format?: string
}

/** Request body for the `POST /v1/chat/completions` image path. */
export interface ChatGenerationRequest {
  model: string
  messages: { role: 'user'; content: string }[]
  stream: false
}

/** One generated image as returned by the OpenAI images endpoint. */
export interface ImageEndpointItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

/** Response body of the OpenAI images endpoint. */
export interface ImageEndpointResponse {
  created?: number
  data?: ImageEndpointItem[]
}

/** The subset of an OpenAI chat completion the chat image path reads. */
export interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string
    }
  }[]
}

/** A generated image normalised to a single display-ready shape. */
export interface GeneratedImage {
  id: string
  /** Displayable source: an inline data URL or a hosted image URL. */
  src: string
  /** Suggested file name when saving the image. */
  fileName: string
  revisedPrompt?: string
}

/** Result of one successful generation, including the prompt that produced it. */
export interface GenerationResult {
  prompt: string
  model: string
  images: GeneratedImage[]
}

/** One image handed to the local gallery for safekeeping. */
export interface GalleryEntry {
  id: string
  prompt: string
  model: string
  src: string
  fileName: string
}

/** A generation as stored in the local gallery. */
export interface GalleryRecord extends GalleryEntry {
  /** Epoch milliseconds; the retention key and the sort order. */
  createdAt: number
}

/** Form state that is worth persisting across visits. */
export interface ImageStudioConfig {
  model: string
  /** Explicit pixel dimensions, for models that size by WxH. */
  size: string
  /** Aspect ratio, for models that size by ratio. */
  ratio: string
  /** Resolution tier, for models that size by a resolution or image size. */
  resolution: string
  quality: string
  /** Output file format, where the provider lets it be chosen. */
  format: string
  showAllModels: boolean
}
