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
import type { TFunction } from "i18next";
import { z } from "zod";

import {
  parseQuotaFromDollars,
  quotaUnitsToEditableAmount,
} from "@/lib/format";

import {
  REDEMPTION_VALIDATION,
  getRedemptionFormErrorMessages,
} from "../constants";
import type { RedemptionFormData, Redemption } from "../types";

// ============================================================================
// Form Schema (use getRedemptionFormSchema(t) in components for i18n messages)
// ============================================================================

export function getRedemptionFormSchema(t: TFunction) {
  const msg = getRedemptionFormErrorMessages(t);
  return z
    .object({
      name: z
        .string()
        .min(REDEMPTION_VALIDATION.NAME_MIN_LENGTH, msg.NAME_LENGTH_INVALID)
        .max(REDEMPTION_VALIDATION.NAME_MAX_LENGTH, msg.NAME_LENGTH_INVALID),
      quota_dollars: z.number().min(0, t("Quota must be a positive number")),
      expired_time: z.date().optional(),
      count: z
        .number()
        .min(REDEMPTION_VALIDATION.COUNT_MIN, msg.COUNT_INVALID)
        .max(REDEMPTION_VALIDATION.COUNT_MAX, msg.COUNT_INVALID)
        .optional(),
      is_airdrop: z.boolean(),
      airdrop_batch_id: z
        .string()
        .max(64, t("Batch ID must be 64 characters or fewer")),
      valid_until: z.date().optional(),
    })
    .superRefine((data, context) => {
      if (!data.is_airdrop) return;

      if (!data.airdrop_batch_id.trim()) {
        context.addIssue({
          code: "custom",
          path: ["airdrop_batch_id"],
          message: t("Airdrop batch ID is required"),
        });
      }
      if (!data.valid_until || data.valid_until.getTime() <= Date.now()) {
        context.addIssue({
          code: "custom",
          path: ["valid_until"],
          message: t("Airdrop deadline must be in the future"),
        });
      }
    });
}

export type RedemptionFormValues = {
  name: string;
  quota_dollars: number;
  expired_time?: Date;
  count?: number;
  is_airdrop: boolean;
  airdrop_batch_id: string;
  valid_until?: Date;
};

// ============================================================================
// Form Defaults
// ============================================================================

export const REDEMPTION_FORM_DEFAULT_VALUES: RedemptionFormValues = {
  name: "",
  quota_dollars: 10,
  expired_time: undefined,
  count: 1,
  is_airdrop: false,
  airdrop_batch_id: "",
  valid_until: undefined,
};

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: RedemptionFormValues,
): RedemptionFormData {
  return {
    name: data.name,
    quota: parseQuotaFromDollars(data.quota_dollars),
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : 0,
    is_airdrop: data.is_airdrop,
    airdrop_batch_id: data.is_airdrop ? data.airdrop_batch_id.trim() : "",
    valid_until:
      data.is_airdrop && data.valid_until
        ? Math.floor(data.valid_until.getTime() / 1000)
        : 0,
    count: data.count || 1,
  };
}

/**
 * Transform redemption data to form defaults
 */
export function transformRedemptionToFormDefaults(
  redemption: Redemption,
): RedemptionFormValues {
  return {
    name: redemption.name,
    quota_dollars: quotaUnitsToEditableAmount(redemption.quota),
    expired_time:
      redemption.expired_time > 0
        ? new Date(redemption.expired_time * 1000)
        : undefined,
    count: 1,
    is_airdrop: redemption.is_airdrop,
    airdrop_batch_id: redemption.airdrop_batch_id,
    valid_until:
      redemption.valid_until > 0
        ? new Date(redemption.valid_until * 1000)
        : undefined,
  };
}
