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
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Gift, WandSparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/datetime-picker";
import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from "@/components/drawer-layout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { getCurrencyDisplay, getCurrencyLabel } from "@/lib/currency";
import {
  formatQuota,
  getEditableQuotaStep,
  parseQuotaFromDollars,
} from "@/lib/format";
import { handleServerError } from "@/lib/handle-server-error";
import { addTimeToDate } from "@/lib/time";

import { createRedemption, updateRedemption, getRedemption } from "../api";
import {
  REDEMPTION_VALIDATION,
  SUCCESS_MESSAGES,
} from "../constants";
import {
  getRedemptionFormSchema,
  type RedemptionFormValues,
  REDEMPTION_FORM_DEFAULT_VALUES,
  transformFormDataToPayload,
  transformRedemptionToFormDefaults,
} from "../lib";
import { createRegistrationCode } from "@/features/registration-codes/api";
import { SUCCESS_MESSAGES as REGISTRATION_SUCCESS_MESSAGES } from "@/features/registration-codes/constants";
import type { Redemption } from "../types";
import { useRedemptions } from "./redemptions-provider";

type RedemptionsMutateDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRow?: Redemption;
};

export function RedemptionsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: RedemptionsMutateDrawerProps) {
  const { t } = useTranslation();
  const isUpdate = !!currentRow;
  const redemptionId = currentRow?.id;
  const { triggerRefresh, createType, setCreateType } = useRedemptions();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [redemptionLoadState, setRedemptionLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [loadedRedemption, setLoadedRedemption] = useState<Redemption | null>(
    null,
  );
  // In create mode the drawer builds either a redemption code or a
  // registration code; updates are always redemption codes.
  const isRegistrationType = !isUpdate && createType === "registration";

  const form = useForm<RedemptionFormValues>({
    resolver: zodResolver(getRedemptionFormSchema(t)),
    defaultValues: REDEMPTION_FORM_DEFAULT_VALUES,
  });
  const isAirdrop = form.watch("is_airdrop");

  // Load existing data when updating
  useEffect(() => {
    if (!open) {
      setRedemptionLoadState("idle");
      setLoadedRedemption(null);
      return;
    }

    if (!isUpdate || redemptionId === undefined) {
      form.reset(REDEMPTION_FORM_DEFAULT_VALUES);
      setRedemptionLoadState("ready");
      setLoadedRedemption(null);
      return;
    }

    let ignoreResult = false;

    form.reset(REDEMPTION_FORM_DEFAULT_VALUES);
    setRedemptionLoadState("loading");
    setLoadedRedemption(null);

    void getRedemption(redemptionId)
      .then((result) => {
        if (ignoreResult) return;

        if (
          !result.success ||
          !result.data ||
          result.data.id !== redemptionId
        ) {
          setRedemptionLoadState("error");
          toast.error(t("Failed to load"));
          return;
        }

        form.reset(transformRedemptionToFormDefaults(result.data));
        setLoadedRedemption(result.data);
        setRedemptionLoadState("ready");
      })
      .catch((error: unknown) => {
        if (ignoreResult) return;

        setRedemptionLoadState("error");
        handleServerError(error);
      });

    return () => {
      ignoreResult = true;
    };
  }, [open, isUpdate, redemptionId, form, t]);

  const isUpdateReady =
    !isUpdate ||
    (redemptionLoadState === "ready" && loadedRedemption?.id === redemptionId);
  const isLoadingRedemption = redemptionLoadState === "loading";

  const onSubmit = async (data: RedemptionFormValues) => {
    if (isUpdate && (!currentRow || !loadedRedemption || !isUpdateReady)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const basePayload = transformFormDataToPayload(data);

      if (isUpdate && currentRow && loadedRedemption) {
        const quota = form.getFieldState("quota_dollars").isDirty
          ? basePayload.quota
          : loadedRedemption.quota;
        const result = await updateRedemption({
          ...basePayload,
          quota,
          id: currentRow.id,
        });
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.REDEMPTION_UPDATED));
          onOpenChange(false);
          triggerRefresh();
        }
      } else if (isRegistrationType) {
        // Create mode (registration code): no quota, no airdrop fields.
        const result = await createRegistrationCode({
          name: data.name,
          expired_time: data.expired_time
            ? Math.floor(data.expired_time.getTime() / 1000)
            : 0,
          count: data.count || 1,
        });
        if (result.success) {
          const count = result.data?.length || 0;
          toast.success(
            count > 1
              ? t("Successfully created {{count}} registration codes", {
                  count,
                })
              : t(REGISTRATION_SUCCESS_MESSAGES.REGISTRATION_CODE_CREATED),
          );
          onOpenChange(false);
          void queryClient.invalidateQueries({
            queryKey: ["registration-codes"],
          });
        }
      } else {
        // Create mode (redemption code)
        const result = await createRedemption(basePayload);
        if (result.success) {
          const count = result.data?.length || 0;
          toast.success(
            count > 1
              ? t("Successfully created {{count}} redemption codes", {
                  count,
                })
              : t(SUCCESS_MESSAGES.REDEMPTION_CREATED),
          );
          onOpenChange(false);
          triggerRefresh();
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!isUpdate) {
      const name = form.getValues("name");
      if (!name?.trim()) {
        if (isRegistrationType) {
          form.setValue("name", t("Registration code"), {
            shouldValidate: true,
          });
        } else {
          const quota = parseQuotaFromDollars(
            form.getValues("quota_dollars"),
          );
          form.setValue("name", formatQuota(quota), { shouldValidate: true });
        }
      }
    }

    void form.handleSubmit(onSubmit)(event);
  };

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    const newDate = addTimeToDate(months, days, hours);
    form.setValue("expired_time", newDate);
  };

  const handleAirdropToggle = (checked: boolean) => {
    form.setValue("is_airdrop", checked, { shouldDirty: true });
    if (!checked) return;

    if (!form.getValues("airdrop_batch_id")) {
      form.setValue("airdrop_batch_id", crypto.randomUUID(), {
        shouldDirty: true,
      });
    }
    if (!form.getValues("valid_until")) {
      form.setValue("valid_until", addTimeToDate(0, 7, 0), {
        shouldDirty: true,
      });
    }
  };

  const { meta: currencyMeta } = getCurrencyDisplay();
  const currencyLabel = getCurrencyLabel();
  const tokensOnly = currencyMeta.kind === "tokens";
  const quotaStep = getEditableQuotaStep();
  const quotaLabel = t("Quota ({{currency}})", { currency: currencyLabel });
  const quotaPlaceholder = tokensOnly
    ? t("Enter quota in tokens")
    : t("Enter quota in {{currency}}", { currency: currencyLabel });
  let submitButtonLabel = t("Save changes");
  if (isLoadingRedemption) {
    submitButtonLabel = t("Loading...");
  } else if (isSubmitting) {
    submitButtonLabel = t("Saving...");
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          form.reset();
        }
      }}
    >
      <SheetContent className={sideDrawerContentClassName("sm:max-w-[600px]")}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate
              ? t("Update Redemption Code")
              : isRegistrationType
                ? t("Create Registration Code")
                : t("Create Redemption Code")}
          </SheetTitle>
          <SheetDescription>
            {isUpdate
              ? t("Update the redemption code by providing necessary info.")
              : isRegistrationType
                ? t("Add new registration code(s) by providing necessary info.")
                : t(
                    "Add new redemption code(s) by providing necessary info.",
                  )}{" "}
            {t("Click save when you&apos;re done.")}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id="redemption-form"
            onSubmit={handleSubmit}
            className={sideDrawerFormClassName()}
            aria-busy={isLoadingRedemption}
          >
            <fieldset
              disabled={!isUpdateReady || isSubmitting}
              className="contents"
            >
              {!isUpdate && (
                <SideDrawerSection>
                  <div className="space-y-2">
                    <label className="text-sm leading-none font-medium">
                      {t("Code Type")}
                    </label>
                    <ToggleGroup
                      value={[createType]}
                      onValueChange={(value) => {
                        const next = value.find(
                          (item) => item !== createType,
                        );
                        if (
                          next === "redemption" ||
                          next === "registration"
                        ) {
                          setCreateType(next);
                        }
                      }}
                      variant="outline"
                      className="grid w-full grid-cols-2"
                      aria-label={t("Code Type")}
                    >
                      <ToggleGroupItem value="redemption">
                        {t("Redemption Code")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="registration">
                        {t("Registration Code")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </SideDrawerSection>
              )}

              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t("Name")}</FormLabel>
                        <span
                          className="text-muted-foreground text-xs"
                          aria-live="polite"
                        >
                          {t("{{current}} / {{max}}", {
                            current: [...(field.value ?? "")].length,
                            max: REDEMPTION_VALIDATION.NAME_MAX_LENGTH,
                          })}
                        </span>
                      </div>
                      <FormControl>
                        <Input
                          {...field}
                          maxLength={REDEMPTION_VALIDATION.NAME_MAX_LENGTH}
                          placeholder={t("Enter a name")}
                        />
                      </FormControl>
                      <FormDescription>
                        {isRegistrationType
                          ? t(
                              "Name for this registration code ({{min}}-{{max}} characters)",
                              {
                                min: REDEMPTION_VALIDATION.NAME_MIN_LENGTH,
                                max: REDEMPTION_VALIDATION.NAME_MAX_LENGTH,
                              },
                            )
                          : t(
                              "Name for this redemption code ({{min}}-{{max}} characters)",
                              {
                                min: REDEMPTION_VALIDATION.NAME_MIN_LENGTH,
                                max: REDEMPTION_VALIDATION.NAME_MAX_LENGTH,
                              },
                            )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isRegistrationType && (
                  <FormField
                    control={form.control}
                    name="quota_dollars"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{quotaLabel}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step={quotaStep}
                            placeholder={quotaPlaceholder}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {tokensOnly
                            ? t("Enter the quota amount in tokens")
                            : t("Enter the quota amount in {{currency}}", {
                                currency: currencyLabel,
                              })}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                  )}
                />
                )}

                <FormField
                  control={form.control}
                  name="expired_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Expiration Time")}</FormLabel>
                      <div className="flex flex-col gap-2">
                        <FormControl>
                          <DateTimePicker
                            value={field.value}
                            onChange={field.onChange}
                            placeholder={t("Never expires")}
                          />
                        </FormControl>
                        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetExpiry(0, 0, 0)}
                          >
                            {t("Never")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetExpiry(1, 0, 0)}
                          >
                            {t("1M")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetExpiry(0, 7, 0)}
                          >
                            {t("1W")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetExpiry(0, 1, 0)}
                          >
                            {t("1 Day")}
                          </Button>
                        </div>
                      </div>
                      <FormDescription>
                        {t("Leave empty for never expires")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isUpdate && (
                  <FormField
                    control={form.control}
                    name="count"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("Quantity")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="1"
                            max="100"
                            placeholder={t("Number of codes to create")}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 1,
                              )
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            "Create multiple redemption codes at once (1-100)",
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </SideDrawerSection>

              {!isUpdate && !isRegistrationType && (
                <SideDrawerSection>
                  <div className="overflow-hidden rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-background to-violet-500/10">
                    <div className="flex items-start justify-between gap-4 p-4">
                      <div className="flex gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-500 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
                          <Gift className="size-4" aria-hidden="true" />
                        </div>
                        <div>
                          <FormLabel className="text-sm font-semibold">
                            {t("Welfare airdrop codes")}
                          </FormLabel>
                          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            {t(
                              "Put these codes into an airdrop batch for automatic user claims.",
                            )}
                          </p>
                        </div>
                      </div>
                      <FormField
                        control={form.control}
                        name="is_airdrop"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={handleAirdropToggle}
                                aria-label={t("Welfare airdrop codes")}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>

                    {isAirdrop && (
                      <div className="grid gap-4 border-t border-cyan-500/15 bg-black/[0.025] p-4 dark:bg-white/[0.02]">
                        <FormField
                          control={form.control}
                          name="airdrop_batch_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("Airdrop batch ID")}</FormLabel>
                              <div className="flex gap-2">
                                <FormControl>
                                  <Input
                                    {...field}
                                    className="font-mono text-xs"
                                    placeholder={t("Enter airdrop batch ID")}
                                  />
                                </FormControl>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() =>
                                    form.setValue(
                                      "airdrop_batch_id",
                                      crypto.randomUUID(),
                                      {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      },
                                    )
                                  }
                                  aria-label={t("Generate batch ID")}
                                >
                                  <WandSparkles aria-hidden="true" />
                                </Button>
                              </div>
                              <FormDescription>
                                {t(
                                  "Use the same batch ID as the welfare airdrop activity.",
                                )}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="valid_until"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("Airdrop deadline")}</FormLabel>
                              <FormControl>
                                <DateTimePicker
                                  value={field.value}
                                  onChange={field.onChange}
                                  placeholder={t("Select airdrop deadline")}
                                />
                              </FormControl>
                              <FormDescription>
                                {t(
                                  "Claims stop after this time even if codes remain.",
                                )}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </div>
                </SideDrawerSection>
              )}
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant="outline" />}>
            {t("Close")}
          </SheetClose>
          <Button
            form="redemption-form"
            type="submit"
            disabled={isSubmitting || !isUpdateReady}
          >
            {submitButtonLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
