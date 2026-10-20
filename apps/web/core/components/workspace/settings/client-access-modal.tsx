/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { clientAccessService } from "@/services/client-access.service";
import type { ClientResource } from "@/services/client-access.service";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  clientId: string;
  clientName: string;
  /** Limits everything (the shown access and the pickable resources) to one project, e.g. in project settings. */
  fixedProjectId?: string;
  onChanged?: () => void;
};

export function ClientAccessModal({
  isOpen,
  onClose,
  workspaceSlug,
  clientId,
  clientName,
  fixedProjectId,
  onChanged,
}: Props) {
  const [type, setType] = useState<"issue" | "page">("issue");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const projectId = fixedProjectId ?? selectedProjectId;
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    isOpen ? ["CLIENT_ACCESS", workspaceSlug, clientId, type, search, projectId, page] : null,
    () => clientAccessService.getAccess(workspaceSlug, clientId, { type, search, project_id: projectId, page }),
    { shouldRetryOnError: false }
  );

  const updateAccess = async (resource: ClientResource, grantId?: string) => {
    setBusy(true);
    try {
      if (grantId) await clientAccessService.revoke(workspaceSlug, clientId, grantId);
      else await clientAccessService.grant(workspaceSlug, clientId, resource);
      await mutate();
      onChanged?.();
    } catch (operationError: unknown) {
      console.error("Failed to update client access", operationError);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось изменить доступ", message: "Попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.XXL}>
      <div className="flex max-h-[85vh] flex-col gap-5 overflow-y-auto p-6">
        <div>
          <h2 className="text-20 font-semibold">Доступ клиента: {clientName}</h2>
          <p className="mt-2 text-13 text-secondary">
            Выберите отдельные задачи и страницы{fixedProjectId ? " этого проекта" : ""}. Клиент сможет только
            просматривать их. Остальное содержимое проектов останется скрытым.
          </p>
        </div>
        <section className="space-y-2">
          <h3 className="text-14 font-medium">Доступ предоставлен</h3>
          {data?.grants.length === 0 && <p className="text-13 text-secondary">Пока ничего не открыто.</p>}
          {data?.grants.map((grant) => (
            <div
              key={grant.id}
              className="flex items-center justify-between gap-3 rounded border border-subtle p-2 text-13"
            >
              <div>
                <span className="text-secondary">
                  {grant.resource_type === "issue" ? "Задача" : "Страница"} · {grant.project_name}
                </span>
                <div>
                  {grant.identifier} {grant.name}
                </div>
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => updateAccess(grant, grant.id)}>
                Закрыть доступ
              </Button>
            </div>
          ))}
        </section>
        <section className="space-y-3">
          <h3 className="text-14 font-medium">Предоставить доступ</h3>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput);
            }}
          >
            <select
              aria-label="Тип материала"
              value={type}
              onChange={(event) => {
                setType(event.target.value as "issue" | "page");
                setPage(1);
              }}
              className="rounded border border-subtle bg-surface-1 p-2 text-13"
            >
              <option value="issue">Задачи</option>
              <option value="page">Страницы</option>
            </select>
            {!fixedProjectId && (
              <select
                aria-label="Проект"
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setPage(1);
                }}
                className="max-w-48 rounded border border-subtle bg-surface-1 p-2 text-13"
              >
                <option value="">Все проекты</option>
                {data?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label="Поиск по названию"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Название задачи или страницы"
              className="min-w-40 flex-1 rounded border border-subtle bg-surface-1 p-2 text-13"
            />
            <Button type="submit" variant="secondary">
              Найти
            </Button>
          </form>
          {isLoading && <p className="text-13 text-secondary">Загрузка…</p>}
          {error && (
            <p role="alert" className="text-13 text-danger-primary">
              Не удалось загрузить материалы.{" "}
              <button type="button" onClick={() => void mutate()}>
                Повторить
              </button>
            </p>
          )}
          {data?.resources.length === 0 && <p className="text-13 text-secondary">Ничего не найдено.</p>}
          {data?.resources.map((resource) => {
            const granted = data.grants.some(
              (grant) =>
                grant.project_id === resource.project_id &&
                grant.resource_type === resource.resource_type &&
                grant.resource_id === resource.resource_id
            );
            return (
              <div
                key={`${resource.project_id}/${resource.resource_id}`}
                className="flex items-center justify-between gap-3 border-b border-subtle py-2 text-13"
              >
                <div>
                  <div className="text-secondary">{resource.project_name}</div>
                  {resource.name}
                </div>
                <Button variant="secondary" disabled={busy || granted} onClick={() => updateAccess(resource)}>
                  {granted ? "Доступ открыт" : "Открыть доступ"}
                </Button>
              </div>
            );
          })}
          <div className="flex justify-between">
            <Button variant="ghost" disabled={page === 1 || isLoading} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <Button variant="ghost" disabled={!data?.has_more || isLoading} onClick={() => setPage(page + 1)}>
              Далее
            </Button>
          </div>
        </section>
        <Button variant="secondary" onClick={onClose}>
          Готово
        </Button>
      </div>
    </ModalCore>
  );
}
