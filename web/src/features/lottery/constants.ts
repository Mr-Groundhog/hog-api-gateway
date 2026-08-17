/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License.
*/

export const lotteryQueryKeys = {
  records: ['lottery', 'today-records'] as const,
  status: ['lottery', 'status'] as const,
  prizes: ['lottery', 'prizes'] as const,
  myRecords: ['lottery', 'my-records'] as const,
}
