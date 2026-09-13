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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ApplicationFormDialog } from '../components/application-form-dialog'
import type { CooperationMethodOption } from '../constants'
import { CooperationPromotion } from '../index'
import type { CooperationApplication } from '../types'

const createApplicationMock = vi.fn()
const myApplicationsMock = vi.fn()

vi.mock('../api', () => ({
  cooperationQueryKeys: {
    myApplications: ['cooperation', 'my-applications'],
    adminList: ['cooperation', 'adminList'],
    adminStats: ['cooperation', 'adminStats'],
  },
  createCooperationApplication: (...args: unknown[]) =>
    createApplicationMock(...args),
  getMyCooperationApplications: () => myApplicationsMock(),
}))

vi.mock('@/hooks/use-sidebar-config', () => ({
  useIsAdminSidebarModuleVisible: () => true,
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: null, loading: false, error: null }),
}))

const createdApplication: CooperationApplication = {
  id: 7,
  user_id: 1,
  username: 'alice',
  site_name: '示例站点',
  site_url: 'https://example.com',
  site_banner: '',
  site_type: 'blog',
  description: '一个关于 AI 的技术博客',
  audience: '日活约 1000',
  methods: '["token","invite"]',
  contact: 'admin@example.com',
  notes: '',
  status: 1,
  review_note: '',
  reviewer_id: 0,
  review_time: 0,
  created_time: 100,
  updated_time: 100,
}

function renderDialog(
  onOpenChange = vi.fn(),
  enabledMethods: CooperationMethodOption[] = [
    { id: 'token', labelKey: 'Token Support' },
    { id: 'invite', labelKey: 'User Invitations' },
    { id: 'content', labelKey: 'Content Creation' },
    { id: 'sponsor', labelKey: 'Sponsorship' },
  ]
) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ApplicationFormDialog
        open
        onOpenChange={onOpenChange}
        enabledMethods={enabledMethods}
      />
    </QueryClientProvider>
  )
}

function fillField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  })
}

async function fillValidForm(except: 'siteUrl' | 'methods') {
  fillField('Site Name', '示例站点')
  fillField('Site Description', '一个关于 AI 的技术博客')
  fillField('Audience Size', '日活约 1000')
  fillField('Contact Information', 'admin@example.com')
  if (except !== 'siteUrl') {
    fillField('Site URL', 'https://example.com')
  }
  if (except !== 'methods') {
    await clickMethod('Token Support')
  }
}

async function clickMethod(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('checkbox', { name: label }))
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
}

describe('application form dialog validation', () => {
  beforeEach(() => {
    createApplicationMock.mockReset()
    createApplicationMock.mockResolvedValue(createdApplication)
    myApplicationsMock.mockReset()
    myApplicationsMock.mockResolvedValue([])
  })

  test('blocks submission with field errors and no API call when empty', async () => {
    renderDialog()
    submit()

    await waitFor(() => {
      expect(
        screen.getByText('Please select at least one cooperation method')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText('Site URL must be a valid http(s) link')
    ).toBeInTheDocument()
    expect(createApplicationMock).not.toHaveBeenCalled()
  })

  test('rejects a bare domain as site URL', async () => {
    renderDialog()
    await fillValidForm('siteUrl')
    fillField('Site URL', 'example.com')
    submit()

    await waitFor(() => {
      expect(
        screen.getByText('Site URL must be a valid http(s) link')
      ).toBeInTheDocument()
    })
    expect(createApplicationMock).not.toHaveBeenCalled()
  })

  test('toggling a cooperation method checkbox satisfies the requirement', async () => {
    renderDialog()
    await fillValidForm('methods')
    submit()

    await waitFor(() => {
      expect(
        screen.getByText('Please select at least one cooperation method')
      ).toBeInTheDocument()
    })

    await clickMethod('User Invitations')
    submit()

    // 站点类型未选择仍应拦截提交，但合作方式错误已消失
    await waitFor(() => {
      expect(screen.getByText('Invalid site type')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('Please select at least one cooperation method')
    ).not.toBeInTheDocument()
    expect(createApplicationMock).not.toHaveBeenCalled()
  })

  // 管理员收窄 CooperationMethodsAdmin 后，表单只渲染开放的合作方式
  test('only enabled cooperation methods are rendered', () => {
    renderDialog(vi.fn(), [{ id: 'token', labelKey: 'Token Support' }])

    expect(
      screen.getByRole('checkbox', { name: 'Token Support' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'User Invitations' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Sponsorship' })
    ).not.toBeInTheDocument()
  })

  // 自定义合作方式：管理员定义的名称直接渲染，且可勾选提交
  test('custom cooperation method renders with its admin-defined name', async () => {
    renderDialog(vi.fn(), [
      { id: 'token', labelKey: 'Token Support' },
      { id: 'custom_ab12', label: 'API 赞助' },
    ])

    const checkbox = screen.getByRole('checkbox', { name: 'API 赞助' })
    expect(checkbox).toBeInTheDocument()
    await userEvent.setup().click(checkbox)
    expect(checkbox).toBeChecked()
  })

  // 封面图 URL 输入后立即出现预览图（alt 为空的装饰性图片按 src 查询）
  test('site banner input shows an immediate preview', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Site Banner URL'), {
      target: { value: 'https://example.com/banner.png' },
    })

    await waitFor(() => {
      const preview = document.querySelector(
        'img[src="https://example.com/banner.png"]'
      )
      expect(preview).not.toBeNull()
    })
  })
})

describe('cooperation page dialog mounting', () => {
  // 回归：弹窗曾被放在 SectionPageLayout 直接子节点位置而被静默丢弃，
  // 点击按钮后 state 变了但弹窗不渲染（规范见 web/AGENTS.md 3.3 组件）
  test('clicking the submit button opens the dialog on the page', async () => {
    myApplicationsMock.mockResolvedValue([])
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CooperationPromotion />
      </QueryClientProvider>
    )

    const button = await screen.findByRole('button', {
      name: 'Submit Cooperation Application',
    })
    await userEvent.setup().click(button)

    expect(
      await screen.findByRole('button', { name: /^Submit$/ })
    ).toBeInTheDocument()
  })
})
