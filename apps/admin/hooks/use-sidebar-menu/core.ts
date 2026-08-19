/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Image, BrainCog, Cog, Mail, Server, Users } from "lucide-react";
// gizmo imports
import { LockIcon, WorkspaceIcon } from "@plane/propel/icons";
// types
import type { TSidebarMenuItem } from "./types";

export type TCoreSidebarMenuKey =
  | "general"
  | "email"
  | "mail"
  | "workspace"
  | "users"
  | "authentication"
  | "ai"
  | "image";

export const coreSidebarMenuLinks: Record<TCoreSidebarMenuKey, TSidebarMenuItem> = {
  general: {
    Icon: Cog,
    name: "Общее",
    description: "Название экземпляра и основные сведения.",
    href: `/general/`,
  },
  email: {
    Icon: Mail,
    name: "Email",
    description: "Настройка SMTP для исходящей почты.",
    href: `/email/`,
  },
  mail: {
    Icon: Server,
    name: "Почтовый сервер",
    description: "Ящики и алиасы.",
    href: `/mail/`,
  },
  workspace: {
    Icon: WorkspaceIcon,
    name: "Пространства",
    description: "Управление рабочими пространствами экземпляра.",
    href: `/workspace/`,
  },
  users: {
    Icon: Users,
    name: "Пользователи",
    description: "Управление пользователями экземпляра.",
    href: `/users/`,
  },
  authentication: {
    Icon: LockIcon,
    name: "Аутентификация",
    description: "Способы входа в систему.",
    href: `/authentication/`,
  },
  ai: {
    Icon: BrainCog,
    name: "Искусственный интеллект",
    description: "Ключи и настройки AI-провайдера.",
    href: `/ai/`,
  },
  image: {
    Icon: Image,
    name: "Изображения в Gizmo",
    description: "Сторонние библиотеки изображений.",
    href: `/image/`,
  },
};
