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
import { Input } from "@plane/ui";

type Props = {
  isOpen: boolean;
  user: IInstanceUser | null;
  handleClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const instanceService = new InstanceService();

export function AccountModal(props: Props) {
  const { isOpen, user, handleClose, onSuccess } = props;
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setEmail(user.email);
    setDisplayName(user.display_name);
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setIsLoading(false);
  }, [isOpen, user]);

  const handleSubmit = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      await instanceService.updateUser(user.id, {
        email: email.trim(),
        display_name: displayName.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      await onSuccess();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Готово", message: "Учётная запись обновлена" });
      handleClose();
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось обновить учётную запись",
        message: error?.error || "Проверьте введённые данные",
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
              <Dialog.Panel className="relative w-full transform rounded-lg bg-surface-1 p-5 text-left shadow-raised-200 transition-all sm:max-w-xl">
                <Dialog.Title className="text-16 font-medium text-primary">Редактировать учётную запись</Dialog.Title>
                <div className="grid gap-4 pt-6 sm:grid-cols-2">
                  <label
                    htmlFor="instance_user_email"
                    className="flex flex-col gap-1 text-13 text-tertiary sm:col-span-2"
                  >
                    Email
                    <Input
                      id="instance_user_email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full"
                    />
                  </label>
                  <label
                    htmlFor="instance_user_display_name"
                    className="flex flex-col gap-1 text-13 text-tertiary sm:col-span-2"
                  >
                    Отображаемое имя
                    <Input
                      id="instance_user_display_name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="w-full"
                    />
                  </label>
                  <label htmlFor="instance_user_first_name" className="flex flex-col gap-1 text-13 text-tertiary">
                    Имя
                    <Input
                      id="instance_user_first_name"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      className="w-full"
                    />
                  </label>
                  <label htmlFor="instance_user_last_name" className="flex flex-col gap-1 text-13 text-tertiary">
                    Фамилия
                    <Input
                      id="instance_user_last_name"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      className="w-full"
                    />
                  </label>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" size="lg" onClick={handleClose}>
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    loading={isLoading}
                    disabled={!email.trim()}
                    onClick={() => void handleSubmit()}
                  >
                    Сохранить
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
