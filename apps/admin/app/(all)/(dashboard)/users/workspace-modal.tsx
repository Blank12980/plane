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
import { InstanceWorkspaceService } from "@plane/services";
import type { IInstanceUser, IWorkspace } from "@plane/types";
import { CustomSelect } from "@plane/ui";

type Props = {
  isOpen: boolean;
  user: IInstanceUser | null;
  workspaces: IWorkspace[];
  handleClose: () => void;
  onSuccess: () => Promise<void> | void;
};

const workspaceService = new InstanceWorkspaceService();
const roleLabels: Record<number, string> = {
  5: "Гость",
  15: "Участник",
  20: "Администратор пространства",
};

export function WorkspaceModal(props: Props) {
  const { isOpen, user, workspaces, handleClose, onSuccess } = props;
  const [workspaceId, setWorkspaceId] = useState("");
  const [role, setRole] = useState(15);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setWorkspaceId(workspaces[0]?.id ?? "");
    setRole(15);
    setIsLoading(false);
  }, [isOpen, workspaces]);

  const handleSubmit = async () => {
    if (!user || !workspaceId) return;
    setIsLoading(true);
    try {
      await workspaceService.addMember(workspaceId, user.email, role);
      await onSuccess();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Пользователь добавлен",
        message: `${user.email} получил доступ к пространству`,
      });
      handleClose();
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось добавить пользователя",
        message: error?.error || "Возможно, пользователь уже состоит в этом пространстве",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

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
                <Dialog.Title className="text-16 font-medium text-primary">Добавить в пространство</Dialog.Title>
                <p className="mt-1 text-13 text-tertiary">{user?.email}</p>
                <div className="flex flex-col gap-4 pt-6">
                  <label className="flex flex-col gap-1 text-13 text-tertiary">
                    Пространство
                    <CustomSelect
                      value={workspaceId}
                      onChange={setWorkspaceId}
                      label={selectedWorkspace?.name || "Выберите пространство"}
                      input
                      className="w-full"
                      buttonClassName="w-full"
                    >
                      {workspaces.map((workspace) => (
                        <CustomSelect.Option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </CustomSelect.Option>
                      ))}
                    </CustomSelect>
                  </label>
                  <label className="flex flex-col gap-1 text-13 text-tertiary">
                    Роль в пространстве
                    <CustomSelect
                      value={role}
                      onChange={setRole}
                      label={roleLabels[role]}
                      input
                      className="w-full"
                      buttonClassName="w-full"
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <CustomSelect.Option key={value} value={Number(value)}>
                          {label}
                        </CustomSelect.Option>
                      ))}
                    </CustomSelect>
                  </label>
                  {!workspaces.length && (
                    <p className="text-13 text-danger-primary">На экземпляре пока нет доступных пространств.</p>
                  )}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" size="lg" onClick={handleClose}>
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    loading={isLoading}
                    disabled={!workspaceId}
                    onClick={() => void handleSubmit()}
                  >
                    Добавить
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
