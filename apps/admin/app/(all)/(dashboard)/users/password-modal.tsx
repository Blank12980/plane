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
};

const instanceService = new InstanceService();

export function PasswordModal(props: Props) {
  const { isOpen, user, handleClose } = props;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPassword("");
    setConfirmation("");
    setIsLoading(false);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      await instanceService.changeUserPassword(user.id, password);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Пароль изменён",
        message: `Новый пароль установлен для ${user.email}`,
      });
      handleClose();
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось изменить пароль",
        message: error?.error || "Используйте более сложный пароль",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const passwordsMatch = password === confirmation;

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
                <Dialog.Title className="text-16 font-medium text-primary">Изменить пароль</Dialog.Title>
                <p className="mt-1 text-13 text-tertiary">{user?.email}</p>
                <div className="flex flex-col gap-4 pt-6">
                  <label htmlFor="instance_user_password" className="flex flex-col gap-1 text-13 text-tertiary">
                    Новый пароль
                    <Input
                      id="instance_user_password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full"
                      maxLength={128}
                    />
                  </label>
                  <label
                    htmlFor="instance_user_password_confirmation"
                    className="flex flex-col gap-1 text-13 text-tertiary"
                  >
                    Повторите пароль
                    <Input
                      id="instance_user_password_confirmation"
                      type="password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="w-full"
                      maxLength={128}
                    />
                  </label>
                  {confirmation && !passwordsMatch && (
                    <p className="text-11 text-danger-primary">Пароли не совпадают</p>
                  )}
                  <p className="text-11 text-tertiary">
                    Минимум 8 символов. Используйте сложный пароль, который не встречается в словарях.
                  </p>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" size="lg" onClick={handleClose}>
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    loading={isLoading}
                    disabled={password.length < 8 || !passwordsMatch}
                    onClick={() => void handleSubmit()}
                  >
                    Изменить пароль
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
