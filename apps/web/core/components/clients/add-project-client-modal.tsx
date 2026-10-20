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
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// services
import type { ClientCandidate } from "@/services/client-access.service";
import { clientAccessService } from "@/services/client-access.service";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  onAdded: () => void;
};

const toggleId = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

const roleName = (role: number) => (role === 5 ? "гость" : "участник");

function Person({ person, checked, onToggle }: { person: ClientCandidate; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-layer-1">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13 text-primary">{person.display_name || person.email}</span>
        <span className="block truncate text-12 text-tertiary">{person.email}</span>
      </span>
    </label>
  );
}

/**
 * Adds clients to a project: clients that already exist in the workspace and, for workspace administrators, members
 * that become clients. Being added gives a client no access by itself; what they see is chosen afterwards.
 */
export function AddProjectClientModal({ isOpen, onClose, workspaceSlug, projectId, onAdded }: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [promoteIds, setPromoteIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    isOpen ? ["CLIENT_CANDIDATES", workspaceSlug, projectId, search] : null,
    () => clientAccessService.candidates(workspaceSlug, projectId, search),
    { shouldRetryOnError: false }
  );

  const close = () => {
    setClientIds([]);
    setPromoteIds([]);
    setSearchInput("");
    setSearch("");
    onClose();
  };

  const submit = async () => {
    setIsSaving(true);
    try {
      await clientAccessService.addToProject(workspaceSlug, projectId, {
        client_ids: clientIds,
        promote_member_ids: promoteIds,
      });
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Клиенты добавлены в проект" });
      onAdded();
      close();
    } catch (operationError: unknown) {
      console.error("Failed to add clients", operationError);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось добавить клиентов", message: "Попробуйте ещё раз." });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = clientIds.length + promoteIds.length;
  const nothingToAdd = !isLoading && !!data && data.clients.length === 0 && data.members.length === 0;

  return (
    <ModalCore isOpen={isOpen} handleClose={close} position={EModalPosition.CENTER} width={EModalWidth.XL}>
      <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6">
        <div>
          <h2 className="text-18 font-semibold text-primary">Добавить клиентов в проект</h2>
          <p className="mt-1 text-13 text-secondary">
            Добавленный клиент появится в списке проекта. Видеть он будет только те задачи и страницы, которые вы ему
            откроете.
          </p>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput);
          }}
        >
          <input
            aria-label="Поиск по имени или почте"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Имя или почта"
            className="min-w-0 flex-1 rounded border border-subtle bg-surface-1 p-2 text-13"
          />
          <Button type="submit" variant="secondary">
            Найти
          </Button>
        </form>

        {isLoading && <p className="text-13 text-secondary">Загрузка…</p>}
        {error && (
          <p role="alert" className="text-13 text-danger-primary">
            Не удалось загрузить список.{" "}
            <button type="button" className="underline" onClick={() => void mutate()}>
              Повторить
            </button>
          </p>
        )}
        {nothingToAdd && (
          <p className="rounded-md bg-layer-1 p-3 text-13 text-secondary">
            {search
              ? "Никого не найдено."
              : "Все клиенты пространства уже добавлены в проект. Роль «Клиент» назначается в настройках участников пространства."}
          </p>
        )}

        {data && data.clients.length > 0 && (
          <section aria-label="Клиенты пространства" className="space-y-1">
            <h3 className="text-13 font-medium text-primary">Клиенты пространства</h3>
            {data.clients.map((person) => (
              <Person
                key={person.id}
                person={person}
                checked={clientIds.includes(person.id)}
                onToggle={() => setClientIds(toggleId(clientIds, person.id))}
              />
            ))}
          </section>
        )}

        {data && data.can_promote && data.members.length > 0 && (
          <section aria-label="Участники пространства" className="space-y-1 border-t border-subtle pt-3">
            <h3 className="text-13 font-medium text-primary">Сделать клиентом участника пространства</h3>
            <p className="text-12 text-tertiary">
              Роль участника в пространстве станет «Клиент»: его участие в проектах будет закрыто, останется только то,
              что откроют для него администраторы.
            </p>
            {data.members.map((person) => (
              <Person
                key={person.id}
                person={{
                  ...person,
                  display_name: `${person.display_name || person.email} · ${roleName(person.role)}`,
                }}
                checked={promoteIds.includes(person.id)}
                onToggle={() => setPromoteIds(toggleId(promoteIds, person.id))}
              />
            ))}
          </section>
        )}

        <div className="flex justify-end gap-2 border-t border-subtle pt-3">
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={selectedCount === 0 || isSaving}
            loading={isSaving}
            onClick={() => void submit()}
          >
            {selectedCount > 0 ? `Добавить (${selectedCount})` : "Добавить"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
