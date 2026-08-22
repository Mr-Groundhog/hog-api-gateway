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
import { RegistrationCodesDeleteDialog } from './registration-codes-delete-dialog'
import { RegistrationCodesMutateDrawer } from './registration-codes-mutate-drawer'
import { useRegistrationCodes } from './registration-codes-provider'

// Creation happens in the shared redemption drawer (with a code-type
// switch); this dialog set only handles update/delete of registration codes.
export function RegistrationCodesDialogs() {
  const { open, setOpen, currentRow } = useRegistrationCodes()
  const isUpdate = open === 'update'

  return (
    <>
      <RegistrationCodesMutateDrawer
        open={isUpdate}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={isUpdate ? currentRow || undefined : undefined}
      />
      <RegistrationCodesDeleteDialog />
    </>
  )
}
