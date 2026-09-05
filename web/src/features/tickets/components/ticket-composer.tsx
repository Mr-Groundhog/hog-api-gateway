/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { TICKET_VALIDATION } from '../constants'
import { normalizeTicketContent, runeLength } from '../lib/ticket-form'

type TicketComposerProps = {
  disabled?: boolean
  disabledReason?: string
  submitting?: boolean
  label: string
  submitLabel: string
  onSubmit: (content: string) => void
}

/**
 * 纯文本回复输入框 + 字数计数，用户追问与管理员回复共用；
 * 差异只是提交的 API 与成功后失效的 queryKey，通过 props 传入。
 */
export function TicketComposer(props: TicketComposerProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const disabled = props.disabled ?? false

  const handleSubmit = () => {
    const normalized = normalizeTicketContent(content).trim()
    if (!normalized || disabled || props.submitting) {
      return
    }
    props.onSubmit(normalized)
    setContent('')
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>{props.label}</span>
        <span
          className='text-muted-foreground text-xs'
          aria-live='polite'
        >
          {t('{{current}} / {{max}}', {
            current: runeLength(content),
            max: TICKET_VALIDATION.CONTENT_MAX_LENGTH,
          })}
        </span>
      </div>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        maxLength={TICKET_VALIDATION.CONTENT_MAX_LENGTH}
        rows={4}
        disabled={disabled}
        aria-label={props.label}
        placeholder={
          props.disabled && props.disabledReason
            ? props.disabledReason
            : t('Add a note…')
        }
      />
      {disabled && props.disabledReason ? (
        <p className='text-muted-foreground text-xs'>{props.disabledReason}</p>
      ) : null}
      <div className='flex justify-end'>
        <Button
          type='button'
          size='sm'
          disabled={disabled || props.submitting || !content.trim()}
          onClick={handleSubmit}
        >
          {props.submitLabel}
        </Button>
      </div>
    </div>
  )
}
