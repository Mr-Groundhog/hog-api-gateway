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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  GALLERY_MAX_ENTRIES,
  GALLERY_RETENTION_DAYS,
  IMAGE_KEY_SOURCES,
  IMAGE_STUDIO_API,
  STORAGE_KEYS,
} from '../constants'
import { parseConfiguredModels } from '../hooks/use-image-models'
import {
  isAbsoluteHttpUrl,
  parseCustomModelList,
  resolveApiBaseUrl,
} from '../lib/custom-endpoint'
import { selectRetained } from '../lib/gallery-retention'
import {
  extractImagesFromChatResponse,
  extractImagesFromImageResponse,
  inferImageExtension,
  isDataUrl,
} from '../lib/images'
import {
  getDisplayOptions,
  getModelCapabilities,
  getModelEndpoint,
  isImageModel,
  normalizeConfigForModel,
} from '../lib/model-capabilities'
import { buildImageRequestBody } from '../lib/request-body'
import {
  DEFAULT_CONFIG,
  DEFAULT_CUSTOM_ENDPOINT,
  loadConfig,
  loadCustomEndpoint,
  saveConfig,
  saveCustomEndpoint,
} from '../lib/storage'
import type { GalleryRecord, ImageStudioConfig } from '../types'

function configWith(overrides: Partial<ImageStudioConfig>): ImageStudioConfig {
  return { ...DEFAULT_CONFIG, model: 'gpt-image-1', ...overrides }
}

describe('workbench relay routes', () => {
  test('uses the quota-enforced image studio endpoints', () => {
    expect(IMAGE_STUDIO_API.GENERATIONS).toBe(
      '/v1/image-studio/images/generations'
    )
    expect(IMAGE_STUDIO_API.CHAT_COMPLETIONS).toBe(
      '/v1/image-studio/chat/completions'
    )
  })
})

describe('model capabilities', () => {
  test('recognises image models the built-in endpoint table misses', () => {
    // The backend's own list only knows dall-e/gpt-image-1/imagen/flux, yet the
    // relay serves all of these through the images endpoint.
    expect(isImageModel('gpt-image-1.5')).toBe(true)
    expect(isImageModel('qwen-image')).toBe(true)
    expect(isImageModel('grok-2-image-1212')).toBe(true)
    expect(isImageModel('gemini-2.5-flash-image')).toBe(true)
    expect(isImageModel('wan2.6')).toBe(true)
    expect(isImageModel('agnes-image-2.5-flash')).toBe(true)
  })

  test('does not mistake chat models for image models', () => {
    expect(isImageModel('gpt-4o')).toBe(false)
    expect(isImageModel('grok-4-fast-reasoning')).toBe(false)
    expect(isImageModel('deepseek-chat')).toBe(false)
    expect(isImageModel('')).toBe(false)
  })

  test('routes the Gemini image series through chat and everything else through images', () => {
    // The Gemini adaptor rejects any non-imagen model on the images endpoint,
    // so nano banana and friends must reach their picture over chat.
    expect(getModelEndpoint('gemini-2.5-flash-image')).toBe('chat')
    expect(getModelEndpoint('gemini-3-pro-image-preview')).toBe('chat')
    expect(getModelEndpoint('nano-banana-pro-preview')).toBe('chat')

    expect(getModelEndpoint('imagen-4.0-generate-001')).toBe('images')
    expect(getModelEndpoint('gpt-image-1')).toBe('images')
    expect(getModelEndpoint('dall-e-3')).toBe('images')
    expect(getModelEndpoint('grok-2-image-1212')).toBe('images')
    expect(getModelEndpoint('agnes-image-2.5-flash')).toBe('images')
  })

  test('exposes only the controls each provider can honour', () => {
    const gptImage = getModelCapabilities('gpt-image-1')
    expect(gptImage.sizes).toContain('auto')
    expect(gptImage.formats).toEqual(['png', 'jpeg', 'webp'])
    // gpt-image sizes by pixels only: no ratio or resolution control.
    expect(gptImage.ratios).toEqual([])
    expect(gptImage.resolutions).toEqual([])

    // Imagen expresses shape as a ratio and resolution as an image size.
    const imagen = getModelCapabilities('imagen-4.0-generate-001')
    expect(imagen.ratios).toContain('16:9')
    expect(imagen.resolutions).toEqual(['1K', '2K'])
    expect(imagen.resolutionTarget).toBe('quality')
    expect(imagen.sizes).toEqual([])

    // Tongyi Wanxiang sizes by a resolution literal, up to 4K.
    const wan = getModelCapabilities('qwen-image')
    expect(wan.resolutions).toEqual(['1K', '2K', '4K'])
    expect(wan.resolutionTarget).toBe('size')

    // Agnes takes a size tier plus a ratio of its own, and no pixel size.
    const agnes = getModelCapabilities('agnes-image-2.5-flash')
    expect(agnes.ratios).toEqual([
      '1:1',
      '3:4',
      '4:3',
      '16:9',
      '9:16',
      '2:3',
      '3:2',
      '21:9',
    ])
    expect(agnes.ratioFormat).toBe('ratio-field')
    expect(agnes.resolutions).toEqual(['1K', '2K', '3K', '4K'])
    expect(agnes.resolutionTarget).toBe('size')
    expect(agnes.sizes).toEqual([])
    expect(agnes.formats).toEqual([])
  })

  test('always offers candidates for every control, whatever the model', () => {
    // The panel must never change shape as the model changes: a model the
    // frontend does not recognise still gets a full set of dropdowns.
    for (const model of [
      'gpt-image-1',
      'dall-e-3',
      'qwen-image',
      'mystery-4k',
    ]) {
      const display = getDisplayOptions(model)
      expect(display.sizes.length).toBeGreaterThan(0)
      expect(display.ratios.length).toBeGreaterThan(0)
      expect(display.resolutions.length).toBeGreaterThan(0)
      expect(display.qualities.length).toBeGreaterThan(0)
      expect(display.formats.length).toBeGreaterThan(0)
    }
  })

  test('moves the config onto the displayed options instead of clearing it', () => {
    const config = configWith({
      size: '1536x1024',
      quality: 'high',
      format: 'webp',
    })

    // dall-e-3 has no 1536x1024 size or `high` quality, so each control lands
    // on a value its own dropdown offers. A cleared value would leave the
    // dropdown blank.
    const forDallE3 = normalizeConfigForModel(config, 'dall-e-3')
    expect(forDallE3.size).toBe('1024x1024')
    expect(forDallE3.quality).toBe('standard')
    expect(getDisplayOptions('dall-e-3').formats).toContain(forDallE3.format)
    expect(getDisplayOptions('dall-e-3').ratios).toContain(forDallE3.ratio)
  })

  test('keeps parameters that remain valid after a model switch', () => {
    const config = configWith({
      model: 'dall-e-3',
      size: '1024x1792',
      quality: 'hd',
    })

    const next = normalizeConfigForModel(config, 'dall-e-3')
    expect(next.size).toBe('1024x1792')
    expect(next.quality).toBe('hd')
  })
})

describe('request body mapping', () => {
  const input = {
    model: 'gpt-image-1',
    prompt: 'a cat',
    size: '1536x1024',
    ratio: '1:1',
    resolution: '1K',
    quality: 'high',
    format: 'webp',
  }

  test('sends pixels, quality and format for the OpenAI family', () => {
    const body = buildImageRequestBody(
      input,
      getModelCapabilities('gpt-image-1')
    )

    expect(body).toEqual({
      model: 'gpt-image-1',
      prompt: 'a cat',
      n: 1,
      size: '1536x1024',
      quality: 'high',
      output_format: 'webp',
    })
  })

  test('expresses an Imagen ratio as size and its resolution as quality', () => {
    const body = buildImageRequestBody(
      { ...input, model: 'imagen-4.0-generate-001', ratio: '16:9' },
      getModelCapabilities('imagen-4.0-generate-001')
    )

    expect(body.size).toBe('16:9')
    expect(body.quality).toBe('1K')
    // Imagen has no format parameter, so it must not be sent.
    expect(body.output_format).toBeUndefined()
  })

  test('sends a resolution literal for models that size by resolution', () => {
    const body = buildImageRequestBody(
      { ...input, model: 'qwen-image', resolution: '4K' },
      getModelCapabilities('qwen-image')
    )

    expect(body.size).toBe('4K')
    expect(body.quality).toBeUndefined()
  })

  test('sends a size tier and its own ratio for Agnes', () => {
    // Agnes takes both: the tier in `size` and the shape in `ratio`. The ratio
    // must therefore not be folded into size the way the other families do.
    const body = buildImageRequestBody(
      {
        ...input,
        model: 'agnes-image-2.5-flash',
        resolution: '2K',
        ratio: '16:9',
      },
      getModelCapabilities('agnes-image-2.5-flash')
    )

    expect(body).toEqual({
      model: 'agnes-image-2.5-flash',
      prompt: 'a cat',
      n: 1,
      size: '2K',
      ratio: '16:9',
    })
  })

  test('encodes a MiniMax ratio as dimensions that reduce back to it', () => {
    const body = buildImageRequestBody(
      { ...input, model: 'image-01', ratio: '16:9' },
      getModelCapabilities('image-01')
    )

    // MiniMax recovers the aspect ratio from WxH via gcd reduction, so the
    // dimensions must reduce to exactly the requested ratio.
    expect(body.size).toBe('1280x720')
    const [width, height] = String(body.size).split('x').map(Number)
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    const divisor = gcd(width, height)
    expect(`${width / divisor}:${height / divisor}`).toBe('16:9')
  })

  test('always asks for exactly one image', () => {
    // The workbench offers no image count; every model gets the same request.
    for (const model of ['dall-e-3', 'gpt-image-1', 'qwen-image']) {
      const body = buildImageRequestBody(
        { ...input, model },
        getModelCapabilities(model)
      )
      expect(body.n).toBe(1)
    }
  })

  test('omits every optional field for a model with no known sizing syntax', () => {
    const body = buildImageRequestBody(
      { ...input, model: 'gpt-4o' },
      getModelCapabilities('gpt-4o')
    )

    expect(body).toEqual({ model: 'gpt-4o', prompt: 'a cat', n: 1 })
  })
})

describe('ratio and resolution sizing', () => {
  const input = {
    model: 'gpt-image-2',
    prompt: 'a future city',
    // Deliberately stale: the pair decides the size, not this field.
    size: '1024x1024',
    ratio: '16:9',
    resolution: '2K',
    quality: 'high',
    format: 'png',
  }

  test('derives the pixel size from the chosen ratio and resolution', () => {
    const body = buildImageRequestBody(
      input,
      getModelCapabilities('gpt-image-2')
    )

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'a future city',
      n: 1,
      size: '2048x1152',
      quality: 'high',
      output_format: 'png',
    })
  })

  test('derives a portrait size from the same pair the other way round', () => {
    const body = buildImageRequestBody(
      { ...input, ratio: '9:16', resolution: '4K' },
      getModelCapabilities('gpt-image-2')
    )

    expect(body.size).toBe('2160x3840')
  })

  test('offers the ratio list and the tiers each ratio can produce', () => {
    const square = getDisplayOptions('gpt-image-2', '1:1')

    expect(square.derivesSize).toBe(true)
    expect(square.ratios).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4'])
    // A 4K square would exceed the model's pixel limit, so it is not offered.
    expect(square.resolutions).toEqual(['1K', '2K'])
    expect(getDisplayOptions('gpt-image-2', '16:9').resolutions).toEqual([
      '1K',
      '2K',
      '4K',
    ])
  })

  test('steps a tier the ratio cannot produce down to the highest it can', () => {
    const config = configWith({
      model: 'gpt-image-2',
      ratio: '1:1',
      resolution: '4K',
    })

    const next = normalizeConfigForModel(config, 'gpt-image-2')
    expect(next.resolution).toBe('2K')
    expect(next.size).toBe('2048x2048')
  })

  test('keeps the size in step with the pair that produced it', () => {
    const config = configWith({
      model: 'gpt-image-2',
      ratio: '4:3',
      resolution: '2K',
    })

    expect(normalizeConfigForModel(config, 'gpt-image-2').size).toBe('2048x1536')
  })

  test('keeps the pixel picker for models that take a fixed size list', () => {
    // gpt-image-1 and dall-e-3 accept only their own dimensions, so the pair
    // must not replace their size list.
    const display = getDisplayOptions('gpt-image-1')

    expect(display.derivesSize).toBe(false)
    expect(display.sizes).toContain('auto')
    expect(display.ratios).toEqual([])
  })
})

describe('image extraction', () => {
  test('turns base64 results into inline data URLs', () => {
    const images = extractImagesFromImageResponse({
      data: [{ b64_json: 'QUJD', revised_prompt: 'a cat' }],
    })

    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('data:image/png;base64,QUJD')
    expect(images[0].revisedPrompt).toBe('a cat')
  })

  test('keeps hosted URLs and skips entries carrying neither form', () => {
    const images = extractImagesFromImageResponse({
      data: [{ url: 'https://example.com/a.png' }, {}, { b64_json: 'QQ==' }],
    })

    expect(images).toHaveLength(2)
    expect(images[0].src).toBe('https://example.com/a.png')
    expect(images[1].src).toBe('data:image/png;base64,QQ==')
  })

  test('reads the markdown data URL the relay emits for chat image models', () => {
    const images = extractImagesFromChatResponse({
      choices: [
        {
          message: {
            content: 'Here you go\n![image](data:image/png;base64,QUJD)\n',
          },
        },
      ],
    })

    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('data:image/png;base64,QUJD')
  })

  test('ignores chat answers that carry no image', () => {
    const images = extractImagesFromChatResponse({
      choices: [{ message: { content: 'I cannot draw that.' } }],
    })

    expect(images).toHaveLength(0)
  })

  test('derives the saved file extension from the data URL mime type', () => {
    expect(isDataUrl('data:image/png;base64,QQ==')).toBe(true)
    expect(isDataUrl('https://example.com/a.png')).toBe(false)
    expect(inferImageExtension('data:image/jpeg;base64,QQ==')).toBe('jpg')
    expect(inferImageExtension('data:image/webp;base64,QQ==')).toBe('webp')
    expect(inferImageExtension('https://example.com/a.png')).toBe('png')
  })
})

describe('admin-configured model list', () => {
  test('reads the model list drawing settings publish through status', () => {
    expect(parseConfiguredModels('["gpt-image-1","dall-e-3"]')).toEqual([
      'gpt-image-1',
      'dall-e-3',
    ])
  })

  test('treats an unset or corrupted list as "not configured"', () => {
    // Falling back to the user's own group is the only safe reading of a value
    // the admin never set, or one that no longer parses.
    expect(parseConfiguredModels(undefined)).toEqual([])
    expect(parseConfiguredModels('')).toEqual([])
    expect(parseConfiguredModels('[]')).toEqual([])
    expect(parseConfiguredModels('not json')).toEqual([])
    expect(parseConfiguredModels('{"a":1}')).toEqual([])
    expect(parseConfiguredModels(['gpt-image-1'])).toEqual([])
  })

  test('drops non-string entries instead of surfacing them as models', () => {
    expect(parseConfiguredModels('["gpt-image-1",42,null]')).toEqual([
      'gpt-image-1',
    ])
  })
})

describe('gallery retention', () => {
  const NOW = Date.UTC(2026, 0, 10, 12, 0, 0)
  const DAY = 24 * 60 * 60 * 1000

  const record = (id: string, ageDays: number): GalleryRecord => ({
    id,
    createdAt: NOW - ageDays * DAY,
    prompt: 'a cat',
    model: 'gpt-image-1',
    src: 'data:image/png;base64,QUJD',
    fileName: `${id}.png`,
  })

  test('keeps the last three days and returns them newest first', () => {
    const { kept, droppedIds } = selectRetained(
      [record('old', 4), record('today', 0), record('yesterday', 1)],
      NOW
    )

    expect(kept.map((entry) => entry.id)).toEqual(['today', 'yesterday'])
    expect(droppedIds).toEqual(['old'])
  })

  test('keeps an entry right at the edge of the window', () => {
    // The notice says three days, so exactly three days must survive.
    const { kept, droppedIds } = selectRetained(
      [record('edge', GALLERY_RETENTION_DAYS)],
      NOW
    )

    expect(kept.map((entry) => entry.id)).toEqual(['edge'])
    expect(droppedIds).toEqual([])
  })

  test('caps the gallery, evicting the oldest first', () => {
    const records = Array.from(
      { length: GALLERY_MAX_ENTRIES + 3 },
      (_, index) => record(`entry-${index}`, index * 0.01)
    )

    const { kept, droppedIds } = selectRetained(records, NOW)
    expect(kept).toHaveLength(GALLERY_MAX_ENTRIES)
    expect(droppedIds).toHaveLength(3)
    // The three that fall out are the oldest, not an arbitrary set.
    expect(kept.map((entry) => entry.id)).not.toContain(
      `entry-${GALLERY_MAX_ENTRIES + 2}`
    )
  })

  test('drops nothing when every entry is current', () => {
    const { kept, droppedIds } = selectRetained([record('a', 0)], NOW)
    expect(kept).toHaveLength(1)
    expect(droppedIds).toEqual([])
  })
})

describe('config storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('round-trips the config', () => {
    const config = configWith({
      model: 'dall-e-3',
      size: '1024x1792',
      quality: 'hd',
    })

    saveConfig(config)
    expect(loadConfig()).toEqual(config)
  })

  test('defaults the resolution to 1K', () => {
    expect(DEFAULT_CONFIG.resolution).toBe('1K')
  })

  test("defaults to a key of this site and remembers the user's choice", () => {
    expect(DEFAULT_CONFIG.keySource).toBe(IMAGE_KEY_SOURCES.SYSTEM)

    saveConfig(configWith({ keySource: IMAGE_KEY_SOURCES.CUSTOM }))
    expect(loadConfig().keySource).toBe(IMAGE_KEY_SOURCES.CUSTOM)
  })

  test('keeps a config that was saved before the source control existed', () => {
    // Configs written by the previous release carry no key source. Treating
    // that as invalid would silently reset the user's model and parameters.
    localStorage.setItem(
      STORAGE_KEYS.CONFIG,
      JSON.stringify({
        version: 1,
        data: {
          model: 'dall-e-3',
          size: '1024x1792',
          ratio: '1:1',
          resolution: '1K',
          quality: 'hd',
          format: 'png',
          showAllModels: true,
        },
      })
    )

    const loaded = loadConfig()
    expect(loaded.keySource).toBe(IMAGE_KEY_SOURCES.SYSTEM)
    expect(loaded.model).toBe('dall-e-3')
    expect(loaded.size).toBe('1024x1792')
  })

  test('falls back to defaults for a missing, legacy or invalid entry', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)

    // A value persisted before the resolution/ratio/format controls existed
    // must not half-apply.
    localStorage.setItem(
      STORAGE_KEYS.CONFIG,
      JSON.stringify({
        version: 1,
        data: { model: 'dall-e-3', size: '1024x1024', n: 1 },
      })
    )
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)

    // An unparsable entry is reported before the fallback so a corrupted value
    // is diagnosable rather than silently ignored.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEYS.CONFIG, 'not json')
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('custom endpoint', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('normalises a typed address into an OpenAI-compatible API root', () => {
    expect(resolveApiBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    )
    // Both forms name the same endpoint, so the host alone gets a version.
    expect(resolveApiBaseUrl('https://api.openai.com')).toBe(
      'https://api.openai.com/v1'
    )
    expect(resolveApiBaseUrl('  https://api.openai.com/v1/  ')).toBe(
      'https://api.openai.com/v1'
    )
    expect(resolveApiBaseUrl('http://127.0.0.1:8080')).toBe(
      'http://127.0.0.1:8080/v1'
    )
    // A version segment that is already there belongs to the user's address.
    expect(resolveApiBaseUrl('https://host/openai/v1beta')).toBe(
      'https://host/openai/v1beta'
    )
  })

  test('rejects addresses a browser could not call', () => {
    expect(resolveApiBaseUrl('')).toBe('')
    expect(resolveApiBaseUrl('api.openai.com')).toBe('')
    expect(resolveApiBaseUrl('ftp://api.openai.com')).toBe('')

    expect(isAbsoluteHttpUrl('https://api.openai.com/v1')).toBe(true)
    expect(isAbsoluteHttpUrl('javascript:alert(1)')).toBe(false)
  })

  test('reads a model list in whichever shape the endpoint answers with', () => {
    expect(parseCustomModelList({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual([
      'a',
      'b',
    ])
    expect(parseCustomModelList({ data: ['b', 'a', 'b'] })).toEqual(['a', 'b'])
    expect(
      parseCustomModelList([{ id: ' x ' }, 'x', { object: 'model' }, null, 7])
    ).toEqual(['x'])
    expect(parseCustomModelList({ error: 'no list here' })).toEqual([])
  })

  test("round-trips the user's own endpoint in this browser only", () => {
    expect(loadCustomEndpoint()).toEqual(DEFAULT_CUSTOM_ENDPOINT)

    const endpoint = {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-custom',
    }
    saveCustomEndpoint(endpoint)

    expect(loadCustomEndpoint()).toEqual(endpoint)
    // The endpoint is a credential: it lives in its own entry, not in the
    // config that the workbench loads and rewrites.
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIG) ?? 'null')
    ).toBe(null)
  })
})
