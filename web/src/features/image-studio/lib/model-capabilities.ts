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
import {
  AGNES_RATIO_OPTIONS,
  AGNES_RESOLUTIONS,
  CHAT_IMAGE_MODEL_IDS,
  CHAT_IMAGE_MODEL_PREFIXES,
  FORMAT_OPTIONS,
  GENERAL_QUALITY_OPTIONS,
  IMAGE_MODEL_KEYWORDS,
  IMAGEN_RESOLUTIONS,
  MINIMAX_RATIO_OPTIONS,
  QUALITY_PRESETS,
  RATIO_OPTIONS,
  RESOLUTION_OPTIONS,
  SIZE_PRESETS,
} from '../constants'
import type { ImageEndpoint, ImageStudioConfig } from '../types'

/** How an aspect ratio reaches the wire for a given model. */
export type RatioFormat = 'literal' | 'pixels' | 'ratio-field'

/** Which request field carries a resolution choice for a given model. */
export type ResolutionTarget = 'size' | 'quality'

/**
 * What one model actually accepts.
 *
 * The relay exposes a single OpenAI-shaped image body, but the providers behind
 * it disagree about how a picture's shape and size are expressed: OpenAI wants
 * explicit pixels, Gemini wants a ratio plus an image size, MiniMax wants only
 * a fixed set of ratios, Tongyi Wanxiang sizes by a resolution literal, and
 * Agnes takes a size tier plus a ratio of its own. An empty list hides that
 * control for the model instead of sending a value the upstream would reject.
 */
export interface ModelCapabilities {
  sizes: readonly string[]
  ratios: readonly string[]
  ratioFormat: RatioFormat
  resolutions: readonly string[]
  resolutionTarget: ResolutionTarget
  qualities: readonly string[]
  formats: readonly string[]
}

const normalize = (modelName: string): string => modelName.trim().toLowerCase()

const NO_CAPABILITIES: ModelCapabilities = {
  sizes: [],
  ratios: [],
  ratioFormat: 'literal',
  resolutions: [],
  resolutionTarget: 'size',
  qualities: [],
  formats: [],
}

const GPT_IMAGE_CAPABILITIES: ModelCapabilities = {
  sizes: SIZE_PRESETS.gptImage,
  ratios: [],
  ratioFormat: 'literal',
  resolutions: [],
  resolutionTarget: 'size',
  qualities: QUALITY_PRESETS.gptImage,
  formats: FORMAT_OPTIONS,
}

const DALL_E_2_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  sizes: SIZE_PRESETS.dallE2,
}

const DALL_E_3_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  sizes: SIZE_PRESETS.dallE3,
  qualities: QUALITY_PRESETS.dallE3,
}

/** Gemini Imagen: a ratio for the shape, an image size for the resolution. */
const IMAGEN_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  ratios: RATIO_OPTIONS,
  ratioFormat: 'literal',
  resolutions: IMAGEN_RESOLUTIONS,
  resolutionTarget: 'quality',
}

/** Tongyi Wanxiang and friends size by a resolution literal. */
const RESOLUTION_SIZED_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  resolutions: RESOLUTION_OPTIONS,
  resolutionTarget: 'size',
}

/**
 * MiniMax takes a fixed ratio set and no WxH, so a ratio is expressed as
 * dimensions that reduce to exactly that ratio.
 */
const MINIMAX_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  ratios: MINIMAX_RATIO_OPTIONS,
  ratioFormat: 'pixels',
}

/**
 * Agnes: a size tier in `size` and the shape in the provider's own `ratio`
 * parameter, so the two are chosen independently instead of competing for one
 * field. Sizes outside the tiers are normalised upstream, so pixels are not
 * offered; `output_format` is likewise undocumented and stays unset.
 */
const AGNES_CAPABILITIES: ModelCapabilities = {
  ...NO_CAPABILITIES,
  ratios: AGNES_RATIO_OPTIONS,
  ratioFormat: 'ratio-field',
  resolutions: AGNES_RESOLUTIONS,
  resolutionTarget: 'size',
}

/** Whether a model name looks like it can serve text-to-image requests. */
export function isImageModel(modelName: string): boolean {
  const name = normalize(modelName)
  if (!name) {
    return false
  }
  return IMAGE_MODEL_KEYWORDS.some((keyword) => name.includes(keyword))
}

/** Which relay endpoint a model must be called through. */
export function getModelEndpoint(modelName: string): ImageEndpoint {
  const name = normalize(modelName)
  const servedByChat =
    CHAT_IMAGE_MODEL_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    CHAT_IMAGE_MODEL_IDS.includes(name)
  return servedByChat ? 'chat' : 'images'
}

/** What the selected model accepts, across every adjustable dimension. */
export function getModelCapabilities(modelName: string): ModelCapabilities {
  const name = normalize(modelName)
  if (!name) {
    return NO_CAPABILITIES
  }

  if (name.includes('gpt-image') || name.includes('chatgpt-image')) {
    return GPT_IMAGE_CAPABILITIES
  }
  if (name.startsWith('dall-e-2') || name === 'dall-e') {
    return DALL_E_2_CAPABILITIES
  }
  if (name.startsWith('dall-e-3')) {
    return DALL_E_3_CAPABILITIES
  }
  if (name.startsWith('imagen')) {
    return IMAGEN_CAPABILITIES
  }
  if (name.includes('minimax') || name.includes('image-01')) {
    return MINIMAX_CAPABILITIES
  }
  if (
    name.includes('qwen-image') ||
    name.includes('z-image') ||
    name.includes('wan')
  ) {
    return RESOLUTION_SIZED_CAPABILITIES
  }
  if (name.startsWith('agnes-image')) {
    return AGNES_CAPABILITIES
  }
  if (isImageModel(name)) {
    // A model the relay serves but whose sizing syntax is unknown: pixel
    // dimensions are the safest common denominator.
    return { ...NO_CAPABILITIES, sizes: SIZE_PRESETS.generic }
  }
  return NO_CAPABILITIES
}

/**
 * Every advanced control is always shown, so a model that has nothing specific
 * to say about a dimension still needs candidate values for it. These are the
 * general lists used when {@link getModelCapabilities} has no opinion.
 */
const DISPLAY_FALLBACKS = {
  sizes: SIZE_PRESETS.generic,
  ratios: RATIO_OPTIONS,
  resolutions: RESOLUTION_OPTIONS,
  qualities: GENERAL_QUALITY_OPTIONS,
  formats: FORMAT_OPTIONS,
} as const

/** The options one control offers for a model, never empty. */
export interface DisplayOptions {
  sizes: readonly string[]
  ratios: readonly string[]
  resolutions: readonly string[]
  qualities: readonly string[]
  formats: readonly string[]
}

/**
 * Option lists for the advanced settings panel.
 *
 * Deliberately separate from {@link getModelCapabilities}: the panel always
 * shows every control, so a dimension the model says nothing about falls back
 * to a general list rather than leaving the control empty. What actually
 * reaches the wire is still decided by the model's real capabilities in
 * `buildImageRequestBody`.
 */
export function getDisplayOptions(modelName: string): DisplayOptions {
  const capabilities = getModelCapabilities(modelName)
  return {
    sizes: capabilities.sizes.length
      ? capabilities.sizes
      : DISPLAY_FALLBACKS.sizes,
    ratios: capabilities.ratios.length
      ? capabilities.ratios
      : DISPLAY_FALLBACKS.ratios,
    resolutions: capabilities.resolutions.length
      ? capabilities.resolutions
      : DISPLAY_FALLBACKS.resolutions,
    qualities: capabilities.qualities.length
      ? capabilities.qualities
      : DISPLAY_FALLBACKS.qualities,
    formats: capabilities.formats.length
      ? capabilities.formats
      : DISPLAY_FALLBACKS.formats,
  }
}

function firstSupported(candidate: string, options: readonly string[]): string {
  if (options.length === 0) {
    return ''
  }
  return options.includes(candidate) ? candidate : (options[0] ?? '')
}

/**
 * Move the config onto values the newly selected model's controls offer.
 *
 * The panel always renders every control, so this picks a valid option from
 * each displayed list instead of clearing a value to nothing — a cleared value
 * would leave its dropdown blank. Values the model cannot express stay in the
 * config for display and are simply not transmitted.
 */
export function normalizeConfigForModel(
  config: ImageStudioConfig,
  modelName: string
): ImageStudioConfig {
  const display = getDisplayOptions(modelName)

  const next: ImageStudioConfig = {
    ...config,
    size: firstSupported(config.size, display.sizes),
    ratio: firstSupported(config.ratio, display.ratios),
    resolution: firstSupported(config.resolution, display.resolutions),
    quality: firstSupported(config.quality, display.qualities),
    format: firstSupported(config.format, display.formats),
  }

  const unchanged =
    next.size === config.size &&
    next.ratio === config.ratio &&
    next.resolution === config.resolution &&
    next.quality === config.quality &&
    next.format === config.format
  return unchanged ? config : next
}
