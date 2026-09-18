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
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isServerErrorCancelled } from '@/lib/server-error-message'

import { generateImages, type GenerateImagesParams } from '../api'
import type { GenerationResult } from '../types'

interface GenerationOutcome {
  result: GenerationResult
}

/**
 * Drive one generation at a time, exposing progress time and allowing the
 * caller to abort.
 *
 * Async upstream image models (several Tongyi Wanxiang variants) are polled by
 * the relay before it answers, so a request can legitimately run for minutes;
 * the elapsed counter is what tells the user the page has not stalled. An
 * aborted run is reported as "no error" rather than as a failed generation.
 */
export function useImageGeneration(onSettled?: () => void) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const mutation = useMutation<GenerationOutcome, Error, GenerateImagesParams>({
    mutationFn: async (params) => {
      const controller = new AbortController()
      abortRef.current = controller
      const images = await generateImages(params, controller.signal)
      return {
        result: {
          prompt: params.prompt,
          model: params.model,
          images,
        },
      }
    },
    onSettled,
  })

  const isGenerating = mutation.isPending
  const { mutate, reset } = mutation

  useEffect(() => {
    if (!isGenerating) {
      return
    }
    setElapsedSeconds(0)
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1)
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [isGenerating])

  const generate = useCallback(
    (params: GenerateImagesParams): void => {
      abortRef.current?.abort()
      mutate(params)
    },
    [mutate]
  )

  const cancel = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const rawError = mutation.error
  const error = rawError && !isServerErrorCancelled(rawError) ? rawError : null

  return {
    result: mutation.data?.result ?? null,
    isGenerating,
    elapsedSeconds,
    error,
    generate,
    cancel,
    clear: reset,
  }
}
