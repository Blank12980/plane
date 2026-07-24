/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService } from "@plane/services";
import type { IInstanceUser } from "@plane/types";
import { TextArea } from "@plane/ui";

type Props = {
  isOpen: boolean;
  user: IInstanceUser | null;
  handleClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const instanceService = new InstanceService();

export function BanModal(props: Props) {
  const { isOpen, user, handleClose, onSuccess } = props;
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason(user?.banned_reason ?? "");
    setIsLoading(false);
  }, [isOpen, user]);

  const isUnban = Boolean(user?.is_banned);

  const handleSubmit = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      await instanceService.updateUser(user.id, {
        is_banned: !isUnban,
        banned_reason: isUnban ? "" : reason.trim(),
      });
      await onSuccess();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Готово",
        message: isUnban ? "Пользователь разблокирован" : "Пользователь заблокирован",
      });
      handleClose();
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: isUnban ? "Не удалось разблокировать пользователя" : "Не удалось заблокировать пользователя",
        message: error?.error || "Попробуйте ещё раз",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-20" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-backdrop transition-opacity" />
        </Transition.Child>
        <div className="fixed inset-0 z-20 overflow-y-auto">
          <div className="my-10 flex justify-center p-4 text-center sm:p-0 md:my-20">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full transform rounded-lg bg-surface-1 p-5 text-left shadow-raised-200 transition-all sm:max-w-lg">
                <Dialog.Title className="text-16 font-medium text-primary">
                  {isUnban ? "Разблокировать пользователя" : "Заблокировать пользователя"}
                </Dialog.Title>
                <p className="mt-1 text-13 text-tertiary">{user?.email}</p>
                {!isUnban && (
                  <label htmlFor="instance_user_ban_reason" className="mt-6 flex flex-col gap-1 text-13 text-tertiary">
                    Причина блокировки
                    <TextArea
                      id="instance_user_ban_reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Необязательно"
                      className="min-h-24 w-full"
                      maxLength={2000}
                    />
                  </label>
                )}
                <p className="mt-4 text-13 text-secondary">
                  {isUnban
                    ? "Пользователь снова сможет входить в Plane."
                    : "Все активные сессии пользователя будут отозваны, а вход в Plane станет недоступен."}
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" size="lg" onClick={handleClose}>
                    Отмена
                  </Button>
                  <Button
                    variant={isUnban ? "primary" : "error-fill"}
                    size="lg"
                    loading={isLoading}
                    onClick={() => void handleSubmit()}
                  >
                    {isUnban ? "Разблокировать" : "Заблокировать"}
                  </Button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
