/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useNavigate, useParams } from "react-router";
import { LogOut } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IProject } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { useUserPermissions } from "@/hooks/store/user";

export interface ILeaveProjectModal {
  project: IProject;
  isOpen: boolean;
  onClose: () => void;
}

export const LeaveProjectModal = observer(function LeaveProjectModal({ project, isOpen, onClose }: ILeaveProjectModal) {
  const navigate = useNavigate();
  const { workspaceSlug } = useParams();
  const { leaveProject } = useUserPermissions();
  const [isLeaving, setIsLeaving] = useState(false);

  const handleLeave = async () => {
    if (!workspaceSlug || isLeaving) return;
    setIsLeaving(true);
    try {
      await leaveProject(workspaceSlug, project.id);
      onClose();
      navigate(`/${workspaceSlug}/projects`);
    } catch (error: unknown) {
      console.error("Failed to leave project", error);
      const serverMessage = error && typeof error === "object" && "error" in error ? error.error : undefined;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось выйти из проекта",
        message: typeof serverMessage === "string" ? serverMessage : "Проверьте соединение и попробуйте ещё раз.",
      });
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={() => {
        if (!isLeaving) onClose();
      }}
      position={EModalPosition.CENTER}
      width={EModalWidth.LG}
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-3">
          <LogOut className="size-5 text-secondary" />
          <h3 className="text-18 font-medium">Покинуть проект</h3>
        </div>
        <p className="text-13 leading-6 text-secondary">
          Выйти из проекта <span className="font-medium text-primary">«{project.name}»</span>? Для повторного вступления
          потребуется новое приглашение. Администраторы пространства и инстанса сохраняют доступ.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={isLeaving} onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={isLeaving} disabled={isLeaving} onClick={handleLeave}>
            {isLeaving ? "Выход..." : "Покинуть проект"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
