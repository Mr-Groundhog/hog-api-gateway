import { createFileRoute, redirect } from '@tanstack/react-router'

import { SensitiveWordViolations } from '@/features/sensitive-word-violations'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/sensitive-word-violations/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) throw redirect({ to: '/403' })
  },
  component: SensitiveWordViolations,
})
