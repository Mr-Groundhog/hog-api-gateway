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
export const IMAGE_STUDIO_API = {
  GENERATIONS: '/v1/images/generations',
  CHAT_COMPLETIONS: '/v1/chat/completions',
  USER_MODELS: '/api/user/models',
} as const

export const STORAGE_KEYS = {
  CONFIG: 'image_studio_config',
} as const

/**
 * Substrings that mark a model as capable of text-to-image generation.
 *
 * The backend exposes no authoritative "can this model draw" flag:
 * `/api/pricing`'s `supported_endpoint_types` only recognises
 * `dall-e-2/3`, `gpt-image-1`, `imagen-*` and `flux*`, and misses models the
 * relay genuinely serves (`gpt-image-1.5`, `qwen-image`, `grok-2-image-1212`,
 * the Gemini image series, ...). So the list below is the frontend's own
 * heuristic, and the page always offers a "show all models" escape hatch.
 */
export const IMAGE_MODEL_KEYWORDS: readonly string[] = [
  'dall-e',
  'gpt-image',
  'chatgpt-image',
  'imagen-',
  'flux',
  'stable-diffusion',
  'sdxl',
  'qwen-image',
  'z-image',
  'wanx',
  'wan2.',
  'grok-2-image',
  'grok-imagine-image',
  'nano-banana',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'seedream',
  'seededit',
  'cogview',
  'hidream',
  'kolors',
  'jimeng',
  'image-01',
]

/**
 * Image models that must be called through `/v1/chat/completions`.
 *
 * The Gemini adaptor's image conversion only accepts an `imagen` prefix and
 * rejects everything else with "only imagen models are supported", so the
 * Gemini image series reaches its image output through chat, where the relay
 * injects `responseModalities: ["TEXT", "IMAGE"]` and returns the picture as a
 * markdown data URL inside the assistant message.
 */
export const CHAT_IMAGE_MODEL_PREFIXES: readonly string[] = [
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'nano-banana',
]

/** Exact model ids served through chat that are not prefix-matched above. */
export const CHAT_IMAGE_MODEL_IDS: readonly string[] = ['gemini-2.0-flash-exp']

/** Size choices offered per model family. */
export const SIZE_PRESETS = {
  dallE2: ['256x256', '512x512', '1024x1024'],
  dallE3: ['1024x1024', '1024x1792', '1792x1024'],
  gptImage: ['auto', '1024x1024', '1536x1024', '1024x1536'],
  generic: ['1024x1024', '1024x1792', '1792x1024'],
} as const

/**
 * Quality choices per model family; an empty list hides the control.
 *
 * Imagen is absent on purpose: its quality parameter is an image size, which
 * the dedicated resolution control expresses directly.
 */
export const QUALITY_PRESETS = {
  dallE3: ['standard', 'hd'],
  gptImage: ['auto', 'high', 'medium', 'low'],
  none: [],
} as const

/** i18n keys for quality values, which are user-visible words. */
export const QUALITY_LABEL_KEYS: Record<string, string> = {
  auto: 'Auto',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  hd: 'HD',
  standard: 'Standard',
}

/** Output resolutions offered for models that size by a resolution literal. */
export const RESOLUTION_OPTIONS: readonly string[] = ['1K', '2K', '4K']

/** Output resolutions offered for models whose resolution is a quality tier. */
export const IMAGEN_RESOLUTIONS: readonly string[] = ['1K', '2K']

/** Aspect ratios offered for models that accept a ratio. */
export const RATIO_OPTIONS: readonly string[] = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
]

/**
 * Aspect ratios MiniMax accepts, in the form it accepts them.
 *
 * The provider rejects any ratio outside this set, so the wider {@link
 * RATIO_OPTIONS} list is not offered for it.
 */
export const MINIMAX_RATIO_OPTIONS: readonly string[] = [
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
]

/**
 * Pixel dimensions used to express a ratio for providers that only accept WxH.
 *
 * Each pair reduces by its greatest common divisor to exactly the keyed ratio,
 * which is how those providers recover the aspect ratio from the dimensions.
 */
export const RATIO_PIXEL_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1200x800',
  '2:3': '800x1200',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '21:9': '1260x540',
}

/** Output formats offered where the provider supports choosing one. */
export const FORMAT_OPTIONS: readonly string[] = ['png', 'jpeg', 'webp']

/**
 * Quality values offered for a model with no quality tiers of its own.
 *
 * Display-only: such a model has no quality parameter, so the chosen value is
 * never transmitted.
 */
export const GENERAL_QUALITY_OPTIONS: readonly string[] = [
  'auto',
  'high',
  'medium',
  'low',
]

/** Longest prompt the page accepts; the relay itself imposes no limit. */
export const PROMPT_MAX_LENGTH = 5000

/** Upper bound offered in the UI for the per-request image count. */
export const MAX_IMAGES_PER_REQUEST = 4

/** Image models that accept only a single image per request. */
export const SINGLE_IMAGE_ONLY_KEYWORDS: readonly string[] = ['dall-e-3']

/** Timeout for a generation; async upstream models are polled server-side. */
export const GENERATION_TIMEOUT_MS = 300_000
