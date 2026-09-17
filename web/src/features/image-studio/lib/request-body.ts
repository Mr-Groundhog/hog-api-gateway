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
import { RATIO_PIXEL_SIZES } from '../constants'
import type { ImageRequestFields } from '../types'
import type { ModelCapabilities } from './model-capabilities'

/** Everything the page collected for one generation. */
export interface ImageGenerationInput {
  model: string
  prompt: string
  size: string
  ratio: string
  resolution: string
  quality: string
  format: string
}

/** One image per request is the only shape the workbench offers. */
const IMAGES_PER_REQUEST = 1

/**
 * Translate the page's controls into the single OpenAI-shaped image body the
 * relay expects.
 *
 * The provider decides how shape and size are expressed, so the same three
 * controls land in different fields: a ratio becomes the `size` value verbatim
 * where the provider reads ratios, or dimensions reducing to that ratio where
 * it only reads WxH; a resolution becomes `size` for providers that size by a
 * literal, or `quality` where the resolution is the image size. Anything the
 * model cannot express is left out entirely rather than sent and rejected.
 */
export function buildImageRequestBody(
  input: ImageGenerationInput,
  capabilities: ModelCapabilities
): ImageRequestFields {
  const body: ImageRequestFields = {
    model: input.model,
    prompt: input.prompt,
    n: IMAGES_PER_REQUEST,
  }

  if (capabilities.ratios.length > 0 && input.ratio) {
    body.size =
      capabilities.ratioFormat === 'pixels'
        ? (RATIO_PIXEL_SIZES[input.ratio] ?? input.ratio)
        : input.ratio
  } else if (
    capabilities.resolutions.length > 0 &&
    capabilities.resolutionTarget === 'size' &&
    input.resolution
  ) {
    body.size = input.resolution
  } else if (capabilities.sizes.length > 0 && input.size) {
    body.size = input.size
  }

  if (capabilities.qualities.length > 0 && input.quality) {
    body.quality = input.quality
  } else if (
    capabilities.resolutions.length > 0 &&
    capabilities.resolutionTarget === 'quality' &&
    input.resolution
  ) {
    body.quality = input.resolution
  }

  if (capabilities.formats.length > 0 && input.format) {
    body.output_format = input.format
  }

  return body
}
