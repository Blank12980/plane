/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
// gizmo imports
import { IS_FAVORITE_MENU_OPEN } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EPageAccess } from "@plane/types";
import { copyUrlToClipboard } from "@plane/utils";
// hooks
import { useCollaborativePageActions } from "@/hooks/use-collaborative-page-actions";
// store types
import type { TPageInstance } from "@/store/pages/base-page";
// local storage
import useLocalStorage from "./use-local-storage";

export type TPageOperations = {
  toggleLock: () => void;
  toggleAccess: () => void;
  toggleFavorite: () => void;
  openInNewTab: () => void;
  copyLink: () => void;
  duplicate: () => void;
  toggleArchive: () => void;
};

type Props = {
  page: TPageInstance;
};

export const usePageOperations = (
  props: Props
): {
  pageOperations: TPageOperations;
} => {
  const { page } = props;
  // derived values
  const {
    access,
    addToFavorites,
    archived_at,
    duplicate,
    is_favorite,
    is_locked,
    getRedirectionLink,
    removePageFromFavorites,
  } = page;
  // collaborative actions
  const { executeCollaborativeAction } = useCollaborativePageActions(props);
  // local storage
  const { setValue: toggleFavoriteMenu, storedValue: isFavoriteMenuOpen } = useLocalStorage<boolean>(
    IS_FAVORITE_MENU_OPEN,
    false
  );
  // page operations
  const pageOperations: TPageOperations = useMemo(() => {
    const pageLink = getRedirectionLink();

    return {
      copyLink: async () => {
        await copyUrlToClipboard(pageLink);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Ссылка скопирована",
          message: "Ссылка на страницу скопирована в буфер обмена.",
        });
      },
      duplicate: async () => {
        try {
          await duplicate();
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Готово",
            message: "Страница успешно дублирована.",
          });
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Ошибка",
            message: "Не удалось дублировать страницу. Попробуйте позже.",
          });
        }
      },
      move: async () => {},
      openInNewTab: () => window.open(pageLink, "_blank"),
      toggleAccess: async () => {
        const changedPageType = access === EPageAccess.PUBLIC ? "приватной" : "публичной";
        try {
          if (access === EPageAccess.PUBLIC)
            await executeCollaborativeAction({ type: "sendMessageToServer", message: "make-private" });
          else await executeCollaborativeAction({ type: "sendMessageToServer", message: "make-public" });
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Готово",
            message: `Страница стала ${changedPageType} и перенесена в соответствующий раздел.`,
          });
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "Ошибка",
            message: `Не удалось сделать страницу ${changedPageType}. Попробуйте ещё раз.`,
          });
        }
      },
      toggleArchive: async () => {
        if (archived_at) {
          try {
            await executeCollaborativeAction({ type: "sendMessageToServer", message: "unarchive" });
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница успешно восстановлена.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось восстановить страницу. Попробуйте позже.",
            });
          }
        } else {
          try {
            await executeCollaborativeAction({ type: "sendMessageToServer", message: "archive" });
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница успешно архивирована.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось архивировать страницу. Попробуйте позже.",
            });
          }
        }
      },
      toggleFavorite: async () => {
        if (is_favorite) {
          try {
            await removePageFromFavorites();
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница удалена из избранного.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось удалить страницу из избранного. Попробуйте позже.",
            });
          }
        } else {
          try {
            await addToFavorites();
            if (!isFavoriteMenuOpen) toggleFavoriteMenu(true);
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница добавлена в избранное.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось добавить страницу в избранное. Попробуйте позже.",
            });
          }
        }
      },
      toggleLock: async () => {
        if (is_locked) {
          try {
            await executeCollaborativeAction({ type: "sendMessageToServer", message: "unlock" });
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница разблокирована.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось разблокировать страницу. Попробуйте позже.",
            });
          }
        } else {
          try {
            await executeCollaborativeAction({ type: "sendMessageToServer", message: "lock" });
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Готово",
              message: "Страница заблокирована.",
            });
          } catch (_error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Ошибка",
              message: "Не удалось заблокировать страницу. Попробуйте позже.",
            });
          }
        }
      },
    };
  }, [
    access,
    addToFavorites,
    archived_at,
    duplicate,
    executeCollaborativeAction,
    getRedirectionLink,
    is_favorite,
    is_locked,
    isFavoriteMenuOpen,
    removePageFromFavorites,
    toggleFavoriteMenu,
  ]);
  return {
    pageOperations,
  };
};
