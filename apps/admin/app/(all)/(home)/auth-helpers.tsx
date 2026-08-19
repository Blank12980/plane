/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
// gizmo packages
import type { TAdminAuthErrorInfo } from "@plane/constants";
import { SUPPORT_EMAIL, EAdminAuthErrorCodes } from "@plane/constants";

export enum EErrorAlertType {
  BANNER_ALERT = "BANNER_ALERT",
  INLINE_FIRST_NAME = "INLINE_FIRST_NAME",
  INLINE_EMAIL = "INLINE_EMAIL",
  INLINE_PASSWORD = "INLINE_PASSWORD",
  INLINE_EMAIL_CODE = "INLINE_EMAIL_CODE",
}

const errorCodeMessages: {
  [key in EAdminAuthErrorCodes]: { title: string; message: (email?: string) => React.ReactNode };
} = {
  // admin
  [EAdminAuthErrorCodes.ADMIN_ALREADY_EXIST]: {
    title: `Администратор уже существует`,
    message: () => `Администратор уже существует. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME]: {
    title: `Требуются email, пароль и имя`,
    message: () => `Требуются email, пароль и имя. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.INVALID_ADMIN_EMAIL]: {
    title: `Неверный email администратора`,
    message: () => `Неверный email администратора. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.INVALID_ADMIN_PASSWORD]: {
    title: `Неверный пароль администратора`,
    message: () => `Неверный пароль администратора. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD]: {
    title: `Требуются email и пароль`,
    message: () => `Требуются email и пароль. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED]: {
    title: `Ошибка аутентификации`,
    message: () => `Ошибка аутентификации. Попробуйте ещё раз.`,
  },
  [EAdminAuthErrorCodes.ADMIN_USER_ALREADY_EXIST]: {
    title: `Администратор уже существует`,
    message: () => (
      <div>
        Администратор уже существует.&nbsp;
        <Link className="font-medium underline underline-offset-4 transition-all hover:font-bold" href={`/admin`}>
          Войти
        </Link>
        &nbsp;сейчас.
      </div>
    ),
  },
  [EAdminAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST]: {
    title: `Администратор не найден`,
    message: () => (
      <div>
        Администратор не найден.&nbsp;
        <Link className="font-medium underline underline-offset-4 transition-all hover:font-bold" href={`/admin`}>
          Войти
        </Link>
        &nbsp;сейчас.
      </div>
    ),
  },
  [EAdminAuthErrorCodes.ADMIN_USER_DEACTIVATED]: {
    title: `Аккаунт деактивирован`,
    message: () =>
      `Аккаунт деактивирован. Обратитесь к ${SUPPORT_EMAIL ? SUPPORT_EMAIL : "администратору"}.`,
  },
};

export const authErrorHandler = (errorCode: EAdminAuthErrorCodes, email?: string): TAdminAuthErrorInfo | undefined => {
  const bannerAlertErrorCodes = [
    EAdminAuthErrorCodes.ADMIN_ALREADY_EXIST,
    EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME,
    EAdminAuthErrorCodes.INVALID_ADMIN_EMAIL,
    EAdminAuthErrorCodes.INVALID_ADMIN_PASSWORD,
    EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD,
    EAdminAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED,
    EAdminAuthErrorCodes.ADMIN_USER_ALREADY_EXIST,
    EAdminAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST,
    EAdminAuthErrorCodes.ADMIN_USER_DEACTIVATED,
  ];

  if (bannerAlertErrorCodes.includes(errorCode))
    return {
      type: EErrorAlertType.BANNER_ALERT,
      code: errorCode,
      title: errorCodeMessages[errorCode]?.title || "Error",
      message: errorCodeMessages[errorCode]?.message(email) || "Something went wrong. Please try again.",
    };

  return undefined;
};
