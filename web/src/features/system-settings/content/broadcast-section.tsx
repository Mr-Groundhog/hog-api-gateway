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
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Pin, PinOff, Plus, Trash2, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { SettingsSwitchField } from '../components/settings-form-layout'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type BroadcastItem = {
  id: number
  content: string
  type: 'default' | 'ongoing' | 'success' | 'warning' | 'error'
  extra?: string
  pinned?: boolean
}

type BroadcastSectionProps = {
  enabled: boolean
  data: string
}

const broadcastSchema = z.object({
  content: z
    .string()
    .min(1, 'Content is required')
    .max(500, 'Content must be less than 500 characters'),
  type: z.enum(['default', 'ongoing', 'success', 'warning', 'error']),
  pinned: z.boolean(),
  extra: z
    .string()
    .max(200, 'Extra must be less than 200 characters')
    .optional(),
})

type BroadcastFormValues = z.infer<typeof broadcastSchema>

const BROADCAST_FORM_ID = 'broadcast-form'

const typeOptions = [
  {
    value: 'default',
    label: 'Default',
    color: 'bg-gray-500',
    badgeVariant: 'neutral' as const,
  },
  {
    value: 'ongoing',
    label: 'Ongoing',
    color: 'bg-blue-500',
    badgeVariant: 'info' as const,
  },
  {
    value: 'success',
    label: 'Success',
    color: 'bg-green-500',
    badgeVariant: 'success' as const,
  },
  {
    value: 'warning',
    label: 'Warning',
    color: 'bg-orange-500',
    badgeVariant: 'warning' as const,
  },
  {
    value: 'error',
    label: 'Error',
    color: 'bg-red-500',
    badgeVariant: 'danger' as const,
  },
]

export function BroadcastSection({ enabled, data }: BroadcastSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([])
  const [isEnabled, setIsEnabled] = useState(enabled)
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showDialog, setShowDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingBroadcast, setEditingBroadcast] =
    useState<BroadcastItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<'single' | 'batch'>('single')

  const form = useForm<BroadcastFormValues>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: {
      content: '',
      type: 'default',
      pinned: false,
      extra: '',
    },
  })

  useEffect(() => {
    try {
      const parsed = JSON.parse(data || '[]')
      if (Array.isArray(parsed)) {
        setBroadcasts(
          parsed.map((item, idx) => ({
            ...item,
            id: item.id || idx + 1,
            pinned: item.pinned === true,
          }))
        )
      }
    } catch {
      setBroadcasts([])
    }
  }, [data])

  useEffect(() => {
    setIsEnabled(enabled)
  }, [enabled])

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.broadcast_enabled',
        value: checked,
      })
      setIsEnabled(checked)
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  const handleAdd = () => {
    setEditingBroadcast(null)
    form.reset({ content: '', type: 'default', pinned: false, extra: '' })
    setShowDialog(true)
  }

  const handleEdit = (broadcast: BroadcastItem) => {
    setEditingBroadcast(broadcast)
    form.reset({
      content: broadcast.content,
      type: broadcast.type,
      pinned: broadcast.pinned === true,
      extra: broadcast.extra || '',
    })
    setShowDialog(true)
  }

  const handleDelete = (broadcast: BroadcastItem) => {
    setEditingBroadcast(broadcast)
    setDeleteTarget('single')
    setShowDeleteDialog(true)
  }

  const handleTogglePin = (broadcast: BroadcastItem) => {
    const nextPinned = !broadcast.pinned
    setBroadcasts((prev) =>
      prev.map((item) =>
        item.id === broadcast.id ? { ...item, pinned: nextPinned } : item
      )
    )
    setHasChanges(true)
    toast.success(
      nextPinned
        ? t('Broadcast pinned. Click "Save Settings" to apply.')
        : t('Broadcast unpinned. Click "Save Settings" to apply.')
    )
  }

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) {
      toast.error(t('Please select items to delete'))
      return
    }
    setDeleteTarget('batch')
    setShowDeleteDialog(true)
  }

  const confirmDelete = () => {
    if (deleteTarget === 'single' && editingBroadcast) {
      setBroadcasts((prev) =>
        prev.filter((item) => item.id !== editingBroadcast.id)
      )
      setHasChanges(true)
      toast.success(t('Broadcast deleted. Click "Save Settings" to apply.'))
    } else if (deleteTarget === 'batch') {
      setBroadcasts((prev) =>
        prev.filter((item) => !selectedIds.includes(item.id))
      )
      setSelectedIds([])
      setHasChanges(true)
      toast.success(
        t('{{count}} broadcasts deleted. Click "Save Settings" to apply.', {
          count: selectedIds.length,
        })
      )
    }
    setShowDeleteDialog(false)
    setEditingBroadcast(null)
  }

  const handleSubmitForm = (values: BroadcastFormValues) => {
    if (editingBroadcast) {
      setBroadcasts((prev) =>
        prev.map((item) =>
          item.id === editingBroadcast.id ? { ...item, ...values } : item
        )
      )
      toast.success(t('Broadcast updated. Click "Save Settings" to apply.'))
    } else {
      const newId = Math.max(...broadcasts.map((item) => item.id), 0) + 1
      setBroadcasts((prev) => [{ id: newId, ...values }, ...prev])
      toast.success(t('Broadcast added. Click "Save Settings" to apply.'))
    }
    setHasChanges(true)
    setShowDialog(false)
  }

  const handleSaveAll = async () => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.broadcasts',
        value: JSON.stringify(broadcasts),
      })
      setHasChanges(false)
      toast.success(t('Broadcasts saved successfully'))
    } catch {
      toast.error(t('Failed to save broadcasts'))
    }
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? broadcasts.map((item) => item.id) : [])
  }

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    )
  }

  return (
    <SettingsSection title={t('Global Broadcast')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Broadcasts are shown as a scrolling marquee on the right side of the logo in the page header. Clicking a broadcast opens a popup with its details. Hidden on mobile.'
        )}
      </p>
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button onClick={handleAdd} size='sm'>
              <Plus className='mr-2 h-4 w-4' />
              {t('Add Broadcast')}
            </Button>
            <Button
              onClick={handleBatchDelete}
              size='sm'
              variant='destructive'
              disabled={selectedIds.length === 0}
            >
              <Trash2 className='mr-2 h-4 w-4' />
              {t('Delete (')}
              {selectedIds.length})
            </Button>
            <Button
              onClick={handleSaveAll}
              size='sm'
              variant='secondary'
              disabled={!hasChanges || updateOption.isPending}
            >
              <Save className='mr-2 h-4 w-4' />
              {updateOption.isPending ? t('Saving...') : t('Save Settings')}
            </Button>
          </div>
          <SettingsSwitchField
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            label={t('Enabled')}
            className='py-0'
          />
        </div>

        <StaticDataTable
          data={broadcasts}
          getRowKey={(broadcast) => broadcast.id}
          emptyContent={t('No broadcasts yet. Click "Add Broadcast" to create one.')}
          columns={[
            {
              id: 'select',
              header: (
                <Checkbox
                  checked={
                    selectedIds.length === broadcasts.length &&
                    broadcasts.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
              ),
              className: 'w-12',
              cell: (broadcast) => (
                <Checkbox
                  checked={selectedIds.includes(broadcast.id)}
                  onCheckedChange={(checked) =>
                    toggleSelectOne(broadcast.id, checked as boolean)
                  }
                />
              ),
            },
            {
              id: 'content',
              header: t('Content'),
              cellClassName: 'max-w-xs',
              cell: (broadcast) => (
                <div className='flex items-center gap-1.5'>
                  {broadcast.pinned && (
                    <Pin
                      className='text-primary h-3.5 w-3.5 shrink-0 fill-current'
                      aria-label={t('Pinned')}
                    />
                  )}
                  <span className='truncate'>{broadcast.content}</span>
                </div>
              ),
            },
            {
              id: 'type',
              header: t('Type'),
              cell: (broadcast) => (
                <StatusBadge
                  label={
                    typeOptions.find((opt) => opt.value === broadcast.type)
                      ?.label
                  }
                  variant={
                    typeOptions.find((opt) => opt.value === broadcast.type)
                      ?.badgeVariant ?? 'neutral'
                  }
                  copyable={false}
                />
              ),
            },
            {
              id: 'extra',
              header: t('Details'),
              cellClassName: 'text-muted-foreground max-w-xs truncate',
              cell: (broadcast) => broadcast.extra || '-',
            },
            {
              id: 'actions',
              header: t('Actions'),
              className: 'text-right',
              cellClassName: 'text-right',
              cell: (broadcast) => (
                <div className='flex justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => handleTogglePin(broadcast)}
                    aria-label={
                      broadcast.pinned ? t('Unpin') : t('Pin to top')
                    }
                    title={broadcast.pinned ? t('Unpin') : t('Pin to top')}
                  >
                    {broadcast.pinned ? (
                      <PinOff className='text-muted-foreground' />
                    ) : (
                      <Pin className='text-primary' />
                    )}
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => handleEdit(broadcast)}
                    aria-label={t('Edit')}
                    title={t('Edit')}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => handleDelete(broadcast)}
                    aria-label={t('Delete')}
                    title={t('Delete')}
                    className='text-destructive hover:text-destructive'
                  >
                    <Trash2 />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={setShowDialog}
        title={editingBroadcast ? t('Edit Broadcast') : t('Add Broadcast')}
        description={t('创建或更新一条全局播报')}
        contentClassName='max-w-2xl'
        contentHeight='auto'
        bodyClassName='space-y-4'
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              onClick={() => setShowDialog(false)}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' form={BROADCAST_FORM_ID}>
              {editingBroadcast ? t('Update') : t('Add')}
            </Button>
          </>
        }
      >
        <Form {...form}>
          <form
            id={BROADCAST_FORM_ID}
            onSubmit={form.handleSubmit(handleSubmitForm)}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Content')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t(
                        'Enter broadcast content (supports Markdown/HTML)'
                      )}
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Maximum 500 characters. Supports Markdown and HTML.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Type')}</FormLabel>
                  <Select
                    items={typeOptions.map((option) => ({
                      value: option.value,
                      label: (
                        <div className='flex items-center gap-2'>
                          <div
                            className={`h-3 w-3 rounded-full ${option.color}`}
                          />
                          {option.label}
                        </div>
                      ),
                    }))}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('Select broadcast type')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {typeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <div className='flex items-center gap-2'>
                              <div
                                className={`h-3 w-3 rounded-full ${option.color}`}
                              />
                              {option.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='pinned'
              render={({ field }) => (
                <FormItem className='flex flex-row items-center gap-3 rounded-md border border-border p-3'>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <FormLabel className='font-normal'>
                    {t('Priority (Default)')}
                  </FormLabel>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='extra'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Details (Optional)')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('Additional information shown in popup')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Optional supplementary information (max 200 characters), shown when the broadcast popup is opened'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Are you sure?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === 'single'
                ? t('This broadcast will be removed from the list.')
                : t('{{count}} broadcasts will be removed from the list.', {
                    count: selectedIds.length,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={confirmDelete}>
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
