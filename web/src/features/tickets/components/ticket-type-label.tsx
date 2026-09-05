/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useTranslation } from 'react-i18next'

import { TICKET_TYPES } from '../constants'

type TicketTypeLabelProps = {
  type: number
}

export function TicketTypeLabel(props: TicketTypeLabelProps) {
  const { t } = useTranslation()
  const config = TICKET_TYPES[props.type]
  if (!config) {
    return <span className='text-muted-foreground text-sm'>-</span>
  }
  return <span className='text-muted-foreground text-sm'>{t(config.labelKey)}</span>
}
