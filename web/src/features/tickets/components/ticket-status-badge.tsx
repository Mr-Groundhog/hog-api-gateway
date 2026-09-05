/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/

import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'

import { TICKET_STATUSES } from '../constants'
import { TICKET_STATUS } from '../types'

type TicketStatusBadgeProps = {
  status: number
}

export function TicketStatusBadge(props: TicketStatusBadgeProps) {
  const { t } = useTranslation()
  const config = TICKET_STATUSES[props.status]
  if (!config) {
    return null
  }
  return (
    <StatusBadge
      variant={config.variant}
      label={t(config.labelKey)}
      copyable={false}
      className={
        props.status === TICKET_STATUS.PENDING
          ? 'bg-destructive text-white'
          : undefined
      }
    />
  )
}
