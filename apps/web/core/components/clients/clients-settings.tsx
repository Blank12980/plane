/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader } from "@plane/ui";
import { getFileURL } from "@plane/utils";
// components
import { ClientAccessModal } from "@/components/workspace/settings/client-access-modal";
import { AddProjectClientModal } from "./add-project-client-modal";
// services
import type { ClientSummary } from "@/services/client-access.service";
import { clientAccessService } from "@/services/client-access.service";

type Props = {
  workspaceSlug: string;
  /** When set the list is limited to this project: counts and the access dialog only cover it. */
  projectId?: string;
};

const pluralize = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
  return `${count} ${many}`;
};

/**
 * Lists the clients and lets an administrator choose what each of them can see: individual work items and pages.
 * In the workspace settings it covers every project; in the project settings only the project at hand.
 */
export function ClientsSettings({ workspaceSlug, projectId }: Props) {
  const [selected, setSelected] = useState<ClientSummary | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    ["CLIENT_LIST", workspaceSlug, projectId ?? "workspace"],
    () => clientAccessService.listClients(workspaceSlug, projectId),
    { shouldRetryOnError: false }
  );

  if (isLoading) {
    return (
      <Loader className="space-y-3">
        <Loader.Item height="48px" />
        <Loader.Item height="48px" />
      </Loader>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить клиентов.{" "}
        <button type="button" className="underline" onClick={() => void mutate()}>
          Повторить
        </button>
      </p>
    );
  }
  const addButton = projectId ? (
    <Button variant="primary" size="sm" onClick={() => setIsAddOpen(true)}>
      Добавить клиента
    </Button>
  ) : null;
  const addModal = projectId ? (
    <AddProjectClientModal
      isOpen={isAddOpen}
      onClose={() => setIsAddOpen(false)}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      onAdded={() => void mutate()}
    />
  ) : null;

  const removeFromProject = async (client: ClientSummary) => {
    if (!projectId) return;
    const name = client.display_name || client.email;
    if (
      !window.confirm(`Убрать клиента ${name} из проекта? Открытые для него задачи и страницы проекта будут закрыты.`)
    ) {
      return;
    }
    try {
      await clientAccessService.removeFromProject(workspaceSlug, projectId, client.id);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Клиент убран из проекта" });
      await mutate();
    } catch (operationError: unknown) {
      console.error("Failed to remove the client", operationError);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось убрать клиента", message: "Попробуйте ещё раз." });
    }
  };

  if (!data || data.clients.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-subtle p-6 text-center text-13 text-secondary">
        <p className="font-medium text-primary">{projectId ? "В проекте пока нет клиентов" : "Клиентов пока нет"}</p>
        <p className="mt-1">
          {projectId
            ? "Добавьте клиента в проект, затем откройте ему нужные задачи и страницы."
            : "Назначьте роль «Клиент» участнику в настройках участников пространства, и он появится здесь. Для каждого клиента вы выберете задачи и страницы, которые он увидит."}
        </p>
        {addButton && <div className="mt-3">{addButton}</div>}
        {addModal}
      </div>
    );
  }

  return (
    <div>
      {addModal}
      {addButton && <div className="mb-3 flex justify-end">{addButton}</div>}
      <p className="mb-4 text-13 text-secondary">
        {projectId
          ? "Клиенты, добавленные в проект. Клиент видит только те задачи и страницы проекта, которые вы откроете. Доступ к другим проектам настраивают их администраторы."
          : "Клиент видит только те задачи и страницы, которые вы откроете. Остальное содержимое проектов скрыто."}
      </p>
      <ul className="divide-y divide-subtle rounded-lg border border-subtle">
        {data.clients.map((client) => {
          const name = client.display_name || client.email;
          return (
            <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                {client.avatar_url ? (
                  <img
                    src={getFileURL(client.avatar_url)}
                    alt={name}
                    className="size-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-layer-3 text-12 text-tertiary uppercase">
                    {name[0]}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-13 font-medium text-primary">{name}</p>
                  <p className="truncate text-12 text-tertiary">{client.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-12 text-secondary">
                <span>{pluralize(client.issue_count, "задача", "задачи", "задач")}</span>
                <span>{pluralize(client.page_count, "страница", "страницы", "страниц")}</span>
                <Button variant="secondary" size="sm" onClick={() => setSelected(client)}>
                  Настроить доступ
                </Button>
                {projectId && (
                  <Button variant="ghost" size="sm" onClick={() => void removeFromProject(client)}>
                    Убрать из проекта
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {selected && (
        <ClientAccessModal
          isOpen
          onClose={() => setSelected(null)}
          workspaceSlug={workspaceSlug}
          clientId={selected.id}
          clientName={selected.display_name || selected.email}
          fixedProjectId={projectId}
          onChanged={() => void mutate()}
        />
      )}
    </div>
  );
}
