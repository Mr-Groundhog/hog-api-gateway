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
import type {
  ChatCompletionResponse,
  GeneratedImage,
  ImageEndpointResponse,
} from '../types'

/**
 * Markdown image emitted by the relay when a Gemini image model answers over
 * chat: the adaptor flattens `inlineData` into `![image](data:...;base64,...)`.
 * Base64 never contains a closing parenthesis, so the match is unambiguous.
 */
const MARKDOWN_DATA_IMAGE =
  /!\[[^\]]*\]\((data:image\/[^;)]+;base64,[A-Za-z0-9+/=]+)\)/g

const BASE64_IMAGE_TYPE = /^data:image\/([a-z0-9.+-]+);base64,/i

let imageSequence = 0

function nextImageId(): string {
  imageSequence += 1
  return `image-${Date.now().toString(36)}-${imageSequence}`
}

/** Whether a src is an inline data URL rather than a remote address. */
export function isDataUrl(src: string): boolean {
  return src.startsWith('data:')
}

/** File extension for a src, derived from the data URL mime type. */
export function inferImageExtension(src: string): string {
  const match = BASE64_IMAGE_TYPE.exec(src)
  if (!match) {
    return 'png'
  }
  const subtype = match[1]?.toLowerCase()
  return subtype === 'jpeg' ? 'jpg' : (subtype ?? 'png')
}

function toB64DataUrl(b64Json: string): string {
  return `data:image/png;base64,${b64Json}`
}

/** Normalise an OpenAI images response into displayable images. */
export function extractImagesFromImageResponse(
  response: ImageEndpointResponse
): GeneratedImage[] {
  const items = response.data ?? []
  const images: GeneratedImage[] = []

  for (const item of items) {
    const src = item.b64_json ? toB64DataUrl(item.b64_json) : (item.url ?? '')
    if (!src) {
      continue
    }
    images.push({
      id: nextImageId(),
      src,
      fileName: `image-${images.length + 1}.${inferImageExtension(src)}`,
      revisedPrompt: item.revised_prompt,
    })
  }

  return images
}

/** Normalise a chat completion response into displayable images. */
export function extractImagesFromChatResponse(
  response: ChatCompletionResponse
): GeneratedImage[] {
  const images: GeneratedImage[] = []

  for (const choice of response.choices ?? []) {
    const content = choice.message?.content
    if (!content) {
      continue
    }
    for (const match of content.matchAll(MARKDOWN_DATA_IMAGE)) {
      const src = match[1]
      if (!src) {
        continue
      }
      images.push({
        id: nextImageId(),
        src,
        fileName: `image-${images.length + 1}.${inferImageExtension(src)}`,
      })
    }
  }

  return images
}

/**
 * Save a generated image to disk.
 *
 * Inline data URLs are converted to a blob so the download carries a real file
 * name. Remote URLs (dall-e returns hosted links) go through a plain anchor,
 * because fetching them would require CORS permission from the image host.
 */
export async function downloadImage(image: GeneratedImage): Promise<void> {
  if (isDataUrl(image.src)) {
    const blob = await fetch(image.src).then((response) => response.blob())
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = image.fileName
    anchor.click()
    URL.revokeObjectURL(objectUrl)
    return
  }

  const anchor = document.createElement('a')
  anchor.href = image.src
  anchor.download = image.fileName
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}
