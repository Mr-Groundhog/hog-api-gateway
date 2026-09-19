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
import type { ImageKeySource } from './types'

export const IMAGE_STUDIO_API = {
  GENERATIONS: '/v1/image-studio/images/generations',
  CHAT_COMPLETIONS: '/v1/image-studio/chat/completions',
  USER_MODELS: '/api/user/models',
} as const

export const STORAGE_KEYS = {
  CONFIG: 'image_studio_config',
  VIEW: 'image_studio_view',
  /** The user's own endpoint. Kept apart from the config: it holds a secret. */
  CUSTOM_ENDPOINT: 'image_studio_custom_endpoint',
} as const

/**
 * Credentials the workbench can draw with.
 *
 * `System` is a key issued by this site and billed here; `Custom` is the user's
 * own endpoint, called directly from the browser.
 */
export const IMAGE_KEY_SOURCES = {
  SYSTEM: 'system',
  CUSTOM: 'custom',
} as const satisfies Record<string, ImageKeySource>

/** Longest the custom endpoint's model list may take; it is a metadata call. */
export const CUSTOM_MODELS_TIMEOUT_MS = 30_000

/** Example API root shown in the custom endpoint field. */
export const CUSTOM_ENDPOINT_PLACEHOLDER = 'https://api.openai.com/v1'

/**
 * Paths appended to a custom API root.
 *
 * A root that already ends in a version segment is used verbatim, so a typed
 * `https://host/v1` and a typed `https://host` produce the same URLs.
 */
export const CUSTOM_ENDPOINT_PATHS = {
  MODELS: 'models',
  GENERATIONS: 'images/generations',
  CHAT_COMPLETIONS: 'chat/completions',
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
  'agnes-image',
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

/**
 * Pixel sizes the models with a fixed set of dimensions can produce.
 *
 * Each table lists the shapes that model can draw and, per shape, every size the
 * official API defines for it, so no value a model accepts is lost while the
 * page still offers the same ratio-and-resolution controls everywhere. A model
 * with more than one size per shape — GPT Image 2 and newer — is described by
 * {@link RATIO_RESOLUTION_SIZES} instead.
 *
 * GPT Image 1 and its siblings draw three shapes, one size each. `auto` is the
 * API's own "let the model decide" value; it settles both the shape and the
 * size, so it is listed as a shape of its own rather than as a size of some
 * ratio.
 */
export const GPT_IMAGE_SIZES: Record<string, Record<string, string>> = {
  auto: { '1K': 'auto' },
  '1:1': { '1K': '1024x1024' },
  '3:2': { '1K': '1536x1024' },
  '2:3': { '1K': '1024x1536' },
}

/**
 * The three shapes DALL·E 3 draws.
 *
 * Also the dimensions an image model of unknown sizing is offered: an
 * OpenAI-compatible image endpoint is most likely to accept these.
 */
export const STANDARD_IMAGE_SIZES: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024x1024' },
  '16:9': { '1K': '1792x1024' },
  '9:16': { '1K': '1024x1792' },
}

/**
 * DALL·E 2 draws squares only, in three sizes.
 *
 * The sizes differ in resolution alone, so a ratio cannot express them: they
 * are the tiers of the one shape it draws, under their official values.
 */
export const DALL_E_2_SIZES: Record<string, Record<string, string>> = {
  '1:1': {
    '256x256': '256x256',
    '512x512': '512x512',
    '1024x1024': '1024x1024',
  },
}

/** i18n keys for ratio values that are words rather than dimensions. */
export const RATIO_LABEL_KEYS: Record<string, string> = {
  auto: 'Auto',
}

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

/**
 * Output size tiers offered for the Agnes image models.
 *
 * The provider also accepts explicit pixel sizes, but its documentation
 * recommends the tier form and normalises exact sizes it does not support, so
 * only the tiers are offered.
 */
export const AGNES_RESOLUTIONS: readonly string[] = ['1K', '2K', '3K', '4K']

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
 * Aspect ratios the Agnes image models accept, in the documented order.
 *
 * Sent in its own `ratio` parameter next to the size tier, unlike every other
 * family on this page, where the ratio has to be folded into `size`.
 */
export const AGNES_RATIO_OPTIONS: readonly string[] = [
  '1:1',
  '3:4',
  '4:3',
  '16:9',
  '9:16',
  '2:3',
  '3:2',
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

/**
 * Pixel sizes a ratio-sized model produces, indexed by ratio and resolution.
 *
 * The model takes explicit dimensions but accepts a wide, ratio-shaped range of
 * them, so the workbench offers the pair users actually think in and derives the
 * size from it. A missing tier is a combination the model cannot express: a 4K
 * square would exceed GPT Image 2's total pixel limit, so 1:1 stops at 2K.
 */
export const RATIO_RESOLUTION_SIZES: Record<
  string,
  Record<string, string>
> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048' },
  '16:9': { '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' },
  '4:3': { '1K': '1536x1152', '2K': '2048x1536', '4K': '2880x2160' },
  '3:4': { '1K': '1152x1536', '2K': '1536x2048', '4K': '2160x2880' },
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

/**
 * How long the local gallery keeps a generation.
 *
 * The gallery lives in this browser only — the relay stores no generated
 * images — so this window is what the retention notice refers to.
 */
export const GALLERY_RETENTION_DAYS = 3

export const GALLERY_RETENTION_MS = GALLERY_RETENTION_DAYS * 24 * 60 * 60 * 1000

/** Hard cap on stored generations, so the browser quota cannot fill up. */
export const GALLERY_MAX_ENTRIES = 60

/** Top-level views the page switches between. */
export const STUDIO_VIEWS = {
  WORKBENCH: 'workbench',
  GALLERY: 'gallery',
} as const

export type StudioView = (typeof STUDIO_VIEWS)[keyof typeof STUDIO_VIEWS]

/** Timeout for a generation; async upstream models are polled server-side. */
export const GENERATION_TIMEOUT_MS = 300_000
