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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import { ChannelTestInputPanel } from '../channel-test-input-panel'

function TestPanel() {
  const [open, setOpen] = useState(false)
  return (
    <ChannelTestInputPanel
      endpointType='embeddings'
      open={open}
      onOpenChange={setOpen}
    />
  )
}

describe('ChannelTestInputPanel', () => {
  test('stays compact until the user expands the test input details', async () => {
    const user = userEvent.setup()
    render(<TestPanel />)

    const trigger = screen.getByRole('button', { name: /Test input/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('What day is it today?')).not.toBeInTheDocument()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('What day is it today?')).toBeVisible()
  })
})
