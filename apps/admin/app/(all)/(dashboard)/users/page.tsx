/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Ban, KeyRound, Pencil, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { InstanceService, InstanceWorkspaceService } from "@plane/services";
import type { IInstanceUser, TInstanceAdminRole } from "@plane/types";
import { CustomSelect, Input, Loader } from "@plane/ui";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// hooks
import { useInstance, useUser } from "@/hooks/store";
// types
import type { Route } from "./+types/page";
// local
import { ConfirmModal } from "../mail/confirm-modal";
import { AccountModal } from "./account-modal";
import { BanModal } from "./ban-modal";
import { PasswordModal } from "./password-modal";
import { WorkspaceModal } from "./workspace-modal";

const instanceService = new InstanceService();
const workspaceService = new InstanceWorkspaceService();

const roleLabels: Record<TInstanceAdminRole | 0, string> = {
  0: "Пользователь",
  15: "Администратор",
  20: "Суперадминистратор",
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

const UsersPage = observer(function UsersPage(_props: Route.ComponentProps) {
  const { currentUser } = useUser();
  const { instanceAdmins, fetchInstanceAdmins } = useInstance();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState<string | null>(null);
  const [accountUser, setAccountUser] = useState<IInstanceUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<IInstanceUser | null>(null);
  const [workspaceUser, setWorkspaceUser] = useState<IInstanceUser | null>(null);
  const [banUser, setBanUser] = useState<IInstanceUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<IInstanceUser | null>(null);

  const { data, isLoading, mutate } = useSWR(["INSTANCE_USERS", search, cursor], () =>
    instanceService.users(search, cursor)
  );
  const { data: workspaceData } = useSWR("INSTANCE_WORKSPACES_FOR_USER_MANAGEMENT", () =>
    workspaceService.list(undefined, 1000)
  );

  const currentAdmin = instanceAdmins?.find((admin) => admin.user === currentUser?.id);
  const isSuperAdmin = currentAdmin?.role === 20;

  const updateRole = async (user: IInstanceUser, selectedRole: TInstanceAdminRole | 0) => {
    const nextRole = selectedRole === 0 ? null : selectedRole;
    if (nextRole === user.instance_admin_role) return;

    setRoleUpdatingUserId(user.id);
    try {
      if (nextRole === null) {
        if (!user.instance_admin_id) throw new Error("Instance administrator record was not found");
        await instanceService.deleteAdmin(user.instance_admin_id);
      } else if (user.instance_admin_id) {
        await instanceService.updateAdminRole(user.instance_admin_id, nextRole);
      } else {
        await instanceService.createAdmin(user.email, nextRole);
      }
      await Promise.all([fetchInstanceAdmins(), mutate()]);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Готово", message: "Глобальная роль обновлена" });
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось изменить глобальную роль",
        message: error?.error || error?.message || "Попробуйте ещё раз",
      });
    } finally {
      setRoleUpdatingUserId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      await instanceService.deleteUser(deleteUser.id);
      await mutate();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Пользователь удалён", message: deleteUser.email });
    } catch (error: any) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось удалить пользователя",
        message: error?.error || "Сначала передайте принадлежащие ему пространства и снимите глобальную роль",
      });
    }
  };

  return (
    <PageWrapper
      header={{
        title: "Пользователи экземпляра",
        description:
          "Все зарегистрированные пользователи Plane: учётные данные, глобальные права, пространства, блокировка, пароль и удаление.",
      }}
    >
      <AccountModal
        isOpen={Boolean(accountUser)}
        user={accountUser}
        handleClose={() => setAccountUser(null)}
        onSuccess={async () => {
          await mutate();
        }}
      />
      <PasswordModal isOpen={Boolean(passwordUser)} user={passwordUser} handleClose={() => setPasswordUser(null)} />
      <WorkspaceModal
        isOpen={Boolean(workspaceUser)}
        user={workspaceUser}
        workspaces={workspaceData?.results ?? []}
        handleClose={() => setWorkspaceUser(null)}
        onSuccess={async () => {
          await mutate();
        }}
      />
      <BanModal
        isOpen={Boolean(banUser)}
        user={banUser}
        handleClose={() => setBanUser(null)}
        onSuccess={async () => {
          await mutate();
        }}
      />
      <ConfirmModal
        isOpen={Boolean(deleteUser)}
        title="Удалить пользователя безвозвратно"
        description={`Учётная запись ${deleteUser?.email ?? ""} и связанные с ней личные данные будут удалены. Это действие нельзя отменить.`}
        confirmLabel="Удалить безвозвратно"
        handleClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
      />

      <div className="space-y-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            setCursor(undefined);
            setSearch(searchInput.trim());
          }}
        >
          <Input
            id="instance_user_search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Поиск по имени или email"
            className="w-full"
          />
          <Button type="submit" variant="primary" size="lg" prependIcon={<Search className="size-4" />}>
            Найти
          </Button>
        </form>

        {isLoading ? (
          <Loader className="space-y-3">
            <Loader.Item height="56px" />
            <Loader.Item height="56px" />
            <Loader.Item height="56px" />
          </Loader>
        ) : data?.results.length ? (
          <>
            <div className="overflow-x-auto rounded-md border border-subtle">
              <table className="w-full min-w-[1080px] text-13">
                <thead className="bg-layer-1 text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Пользователь</th>
                    <th className="px-4 py-2 text-left font-medium">Глобальная роль</th>
                    <th className="px-4 py-2 text-left font-medium">Пространства</th>
                    <th className="px-4 py-2 text-left font-medium">Активность</th>
                    <th className="px-4 py-2 text-left font-medium">Статус</th>
                    <th className="px-4 py-2 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {data.results.map((user) => {
                    const isCurrentUser = user.id === currentUser?.id;
                    const canManageAccount = !user.instance_admin_role || isSuperAdmin;
                    const canChangePassword = !user.instance_admin_role || isSuperAdmin;
                    const canBan = !isCurrentUser && !user.instance_admin_role;
                    const canDelete = isSuperAdmin && !isCurrentUser && !user.instance_admin_role;

                    return (
                      <tr key={user.id} className="text-primary">
                        <td className="px-4 py-3">
                          <div>
                            {user.display_name || `${user.first_name} ${user.last_name}`.trim() || user.email}
                            {isCurrentUser && <span className="ml-1 text-11 text-tertiary">(вы)</span>}
                          </div>
                          <div className="text-11 text-tertiary">{user.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          {isSuperAdmin ? (
                            <CustomSelect
                              value={user.instance_admin_role ?? 0}
                              onChange={(role: TInstanceAdminRole | 0) => void updateRole(user, role)}
                              label={
                                <span className="inline-flex items-center gap-1">
                                  {user.instance_admin_role && <ShieldCheck className="size-4" />}
                                  {roleLabels[user.instance_admin_role ?? 0]}
                                </span>
                              }
                              disabled={isCurrentUser || roleUpdatingUserId === user.id || user.is_banned}
                              buttonClassName="min-w-44"
                            >
                              <CustomSelect.Option value={0}>Пользователь</CustomSelect.Option>
                              <CustomSelect.Option value={15}>Администратор</CustomSelect.Option>
                              <CustomSelect.Option value={20}>Суперадминистратор</CustomSelect.Option>
                            </CustomSelect>
                          ) : (
                            <span
                              className={
                                user.instance_admin_role
                                  ? "inline-flex items-center gap-1 text-accent-primary"
                                  : "text-secondary"
                              }
                            >
                              {user.instance_admin_role && <ShieldCheck className="size-4" />}
                              {roleLabels[user.instance_admin_role ?? 0]}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-secondary">
                          {user.instance_admin_role ? "Все пространства" : user.workspace_count}
                        </td>
                        <td className="px-4 py-3 text-11 text-secondary">
                          <div>Регистрация: {dateFormatter.format(new Date(user.date_joined))}</div>
                          <div>
                            Последний вход:{" "}
                            {user.last_login_time
                              ? dateFormatter.format(new Date(user.last_login_time))
                              : "не выполнялся"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              user.is_banned
                                ? "text-danger-primary"
                                : user.is_active
                                  ? "text-success-primary"
                                  : "text-tertiary"
                            }
                            title={user.banned_reason || undefined}
                          >
                            {user.is_banned ? "Заблокирован" : user.is_active ? "Активен" : "Неактивен"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canManageAccount && (
                              <button
                                type="button"
                                title="Редактировать учётную запись"
                                aria-label="Редактировать учётную запись"
                                className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
                                onClick={() => setAccountUser(user)}
                              >
                                <Pencil className="size-4" />
                              </button>
                            )}
                            {!user.instance_admin_role && !user.is_banned && (
                              <button
                                type="button"
                                title="Добавить в пространство"
                                aria-label="Добавить в пространство"
                                className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
                                onClick={() => setWorkspaceUser(user)}
                              >
                                <UserPlus className="size-4" />
                              </button>
                            )}
                            {canChangePassword && (
                              <button
                                type="button"
                                title="Изменить пароль"
                                aria-label="Изменить пароль"
                                className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
                                onClick={() => setPasswordUser(user)}
                              >
                                <KeyRound className="size-4" />
                              </button>
                            )}
                            {canBan && (
                              <button
                                type="button"
                                title={user.is_banned ? "Разблокировать" : "Заблокировать"}
                                aria-label={user.is_banned ? "Разблокировать" : "Заблокировать"}
                                className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"
                                onClick={() => setBanUser(user)}
                              >
                                <Ban className="size-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                title="Удалить безвозвратно"
                                aria-label="Удалить безвозвратно"
                                className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"
                                onClick={() => setDeleteUser(user)}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-11 text-tertiary">Всего пользователей: {data.total_results}</div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!data.prev_page_results}
                  onClick={() => setCursor(data.prev_cursor)}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!data.next_page_results}
                  onClick={() => setCursor(data.next_cursor)}
                >
                  Далее
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-subtle px-4 py-10 text-center text-13 text-tertiary">
            Пользователи не найдены.
          </div>
        )}
      </div>
    </PageWrapper>
  );
});

export const meta: Route.MetaFunction = () => [{ title: "Пользователи - God Mode" }];

export default UsersPage;
