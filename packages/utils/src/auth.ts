/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
// gizmo imports
import type { TAuthErrorInfo } from "@plane/constants";
import { E_PASSWORD_STRENGTH, EErrorAlertType, EAuthErrorCodes } from "@plane/constants";

/**
 * @description Password strength levels
 */
export enum PasswordStrength {
  EMPTY = "empty",
  WEAK = "weak",
  FAIR = "fair",
  GOOD = "good",
  STRONG = "strong",
}

/**
 * Calculate password strength based on various criteria
 */
export const getPasswordStrength = (password: string): E_PASSWORD_STRENGTH => {
  if (!password || password === "" || password.length <= 0) {
    return E_PASSWORD_STRENGTH.EMPTY;
  }

  if (password.length < 8) {
    return E_PASSWORD_STRENGTH.LENGTH_NOT_VALID;
  }

  // Check all criteria
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()\-_+=\[\]{}|;:'",.<>?/]/.test(password);

  if (hasUpperCase && hasLowerCase && hasDigit && hasSpecialChar) {
    return E_PASSWORD_STRENGTH.STRENGTH_VALID;
  }

  return E_PASSWORD_STRENGTH.STRENGTH_NOT_VALID;
};

export type PasswordCriteria = {
  key: string;
  label: string;
  isValid: boolean;
};

/**
 * Get password criteria for validation display
 */
export const getPasswordCriteria = (password: string): PasswordCriteria[] => [
  {
    key: "length",
    label: "Минимум 8 символов",
    isValid: password.length >= 8,
  },
  {
    key: "uppercase",
    label: "Минимум 1 заглавная буква",
    isValid: /[A-Z]/.test(password),
  },
  {
    key: "lowercase",
    label: "Минимум 1 строчная буква",
    isValid: /[a-z]/.test(password),
  },
  {
    key: "number",
    label: "Минимум 1 цифра",
    isValid: /[0-9]/.test(password),
  },
  {
    key: "special",
    label: "Минимум 1 спецсимвол",
    isValid: /[!@#$%^&*()\-_+=\[\]{}|;:'",.<>?/]/.test(password),
  },
];

// Error code messages
const errorCodeMessages: {
  [key in EAuthErrorCodes]: { title: string; message: (email?: string) => ReactNode };
} = {
  // global
  [EAuthErrorCodes.INSTANCE_NOT_CONFIGURED]: {
    title: `Экземпляр не настроен`,
    message: () => `Экземпляр не настроен. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.SIGNUP_DISABLED]: {
    title: `Регистрация отключена`,
    message: () => `Регистрация отключена. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.INVALID_PASSWORD]: {
    title: `Неверный пароль`,
    message: () => `Неверный пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.PASSWORD_TOO_WEAK]: {
    title: `Пароль слишком слабый`,
    message: () => `Используйте более надёжный пароль.`,
  },
  [EAuthErrorCodes.SMTP_NOT_CONFIGURED]: {
    title: `SMTP не настроен`,
    message: () => `SMTP не настроен. Обратитесь к администратору.`,
  },
  // email check in both sign up and sign in
  [EAuthErrorCodes.INVALID_EMAIL]: {
    title: `Неверный email`,
    message: () => `Неверный email. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EMAIL_REQUIRED]: {
    title: `Требуется email`,
    message: () => `Требуется email. Попробуйте ещё раз.`,
  },
  // sign up
  [EAuthErrorCodes.USER_ALREADY_EXIST]: {
    title: `Пользователь уже существует`,
    message: () => `Аккаунт уже зарегистрирован. Войдите.`,
  },
  [EAuthErrorCodes.REQUIRED_EMAIL_PASSWORD_SIGN_UP]: {
    title: `Требуются email и пароль`,
    message: () => `Требуются email и пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.AUTHENTICATION_FAILED_SIGN_UP]: {
    title: `Ошибка аутентификации`,
    message: () => `Ошибка аутентификации. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_EMAIL_SIGN_UP]: {
    title: `Неверный email`,
    message: () => `Неверный email. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED]: {
    title: `Требуются email и код`,
    message: () => `Требуются email и код. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_EMAIL_MAGIC_SIGN_UP]: {
    title: `Неверный email`,
    message: () => `Неверный email. Попробуйте ещё раз.`,
  },
  // sign in
  [EAuthErrorCodes.USER_ACCOUNT_DEACTIVATED]: {
    title: `Аккаунт деактивирован`,
    message: () => `Аккаунт деактивирован. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.USER_DOES_NOT_EXIST]: {
    title: `Пользователь не найден`,
    message: () => `Аккаунт не найден. Создайте его, чтобы начать.`,
  },
  [EAuthErrorCodes.REQUIRED_EMAIL_PASSWORD_SIGN_IN]: {
    title: `Требуются email и пароль`,
    message: () => `Требуются email и пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.AUTHENTICATION_FAILED_SIGN_IN]: {
    title: `Ошибка аутентификации`,
    message: () => `Ошибка аутентификации. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_EMAIL_SIGN_IN]: {
    title: `Неверный email`,
    message: () => `Неверный email. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED]: {
    title: `Требуются email и код`,
    message: () => `Требуются email и код. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_EMAIL_MAGIC_SIGN_IN]: {
    title: `Неверный email`,
    message: () => `Неверный email. Попробуйте ещё раз.`,
  },
  // Both Sign in and Sign up
  [EAuthErrorCodes.INVALID_MAGIC_CODE_SIGN_IN]: {
    title: `Ошибка аутентификации`,
    message: () => `Неверный код. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_MAGIC_CODE_SIGN_UP]: {
    title: `Ошибка аутентификации`,
    message: () => `Неверный код. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EXPIRED_MAGIC_CODE_SIGN_IN]: {
    title: `Код истёк`,
    message: () => `Код истёк. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EXPIRED_MAGIC_CODE_SIGN_UP]: {
    title: `Код истёк`,
    message: () => `Код истёк. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN]: {
    title: `Код истёк`,
    message: () => `Код истёк. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP]: {
    title: `Код истёк`,
    message: () => `Код истёк. Попробуйте ещё раз.`,
  },
  // Oauth
  [EAuthErrorCodes.OAUTH_NOT_CONFIGURED]: {
    title: `OAuth не настроен`,
    message: () => `OAuth не настроен. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.GOOGLE_NOT_CONFIGURED]: {
    title: `Google не настроен`,
    message: () => `Google не настроен. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.GITHUB_NOT_CONFIGURED]: {
    title: `GitHub не настроен`,
    message: () => `GitHub не настроен. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.GITLAB_NOT_CONFIGURED]: {
    title: `GitLab не настроен`,
    message: () => `GitLab не настроен. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.GOOGLE_OAUTH_PROVIDER_ERROR]: {
    title: `Ошибка провайдера Google`,
    message: () => `Ошибка провайдера Google. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.GITHUB_OAUTH_PROVIDER_ERROR]: {
    title: `Ошибка провайдера GitHub`,
    message: () => `Ошибка провайдера GitHub. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.GITLAB_OAUTH_PROVIDER_ERROR]: {
    title: `Ошибка провайдера GitLab`,
    message: () => `Ошибка провайдера GitLab. Попробуйте ещё раз.`,
  },
  // Reset Password
  [EAuthErrorCodes.INVALID_PASSWORD_TOKEN]: {
    title: `Недействительный токен пароля`,
    message: () => `Недействительный токен пароля. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.EXPIRED_PASSWORD_TOKEN]: {
    title: `Токен пароля истёк`,
    message: () => `Токен пароля истёк. Попробуйте ещё раз.`,
  },
  // Change password
  [EAuthErrorCodes.MISSING_PASSWORD]: {
    title: `Требуется пароль`,
    message: () => `Требуется пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INCORRECT_OLD_PASSWORD]: {
    title: `Неверный текущий пароль`,
    message: () => `Неверный текущий пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_NEW_PASSWORD]: {
    title: `Неверный новый пароль`,
    message: () => `Неверный новый пароль. Попробуйте ещё раз.`,
  },
  // set password
  [EAuthErrorCodes.PASSWORD_ALREADY_SET]: {
    title: `Пароль уже задан`,
    message: () => `Пароль уже задан. Попробуйте ещё раз.`,
  },
  // admin
  [EAuthErrorCodes.ADMIN_ALREADY_EXIST]: {
    title: `Администратор уже существует`,
    message: () => `Администратор уже существует. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME]: {
    title: `Требуются email, пароль и имя`,
    message: () => `Требуются email, пароль и имя. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_ADMIN_EMAIL]: {
    title: `Неверный email администратора`,
    message: () => `Неверный email администратора. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.INVALID_ADMIN_PASSWORD]: {
    title: `Неверный пароль администратора`,
    message: () => `Неверный пароль администратора. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD]: {
    title: `Требуются email и пароль`,
    message: () => `Требуются email и пароль. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED]: {
    title: `Ошибка аутентификации`,
    message: () => `Ошибка аутентификации. Попробуйте ещё раз.`,
  },
  [EAuthErrorCodes.ADMIN_USER_ALREADY_EXIST]: {
    title: `Администратор уже существует`,
    message: () => `Администратор уже существует. Войдите.`,
  },
  [EAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST]: {
    title: `Администратор не найден`,
    message: () => `Администратор не найден. Войдите.`,
  },
  [EAuthErrorCodes.MAGIC_LINK_LOGIN_DISABLED]: {
    title: `Вход по ссылке отключён`,
    message: () => `Вход по ссылке отключён. Используйте пароль.`,
  },
  [EAuthErrorCodes.PASSWORD_LOGIN_DISABLED]: {
    title: `Вход по паролю отключён`,
    message: () => `Вход по паролю отключён. Используйте ссылку из письма.`,
  },
  [EAuthErrorCodes.ADMIN_USER_DEACTIVATED]: {
    title: `Администратор деактивирован`,
    message: () => `Аккаунт администратора деактивирован. Обратитесь к администратору.`,
  },
  [EAuthErrorCodes.RATE_LIMIT_EXCEEDED]: {
    title: `Слишком много запросов`,
    message: () => `Слишком много запросов. Попробуйте позже.`,
  },
};

// Error handler
export const authErrorHandler = (errorCode: EAuthErrorCodes, email?: string): TAuthErrorInfo | undefined => {
  const bannerAlertErrorCodes = [
    EAuthErrorCodes.INSTANCE_NOT_CONFIGURED,
    EAuthErrorCodes.INVALID_EMAIL,
    EAuthErrorCodes.EMAIL_REQUIRED,
    EAuthErrorCodes.SIGNUP_DISABLED,
    EAuthErrorCodes.INVALID_PASSWORD,
    EAuthErrorCodes.SMTP_NOT_CONFIGURED,
    EAuthErrorCodes.USER_ALREADY_EXIST,
    EAuthErrorCodes.AUTHENTICATION_FAILED_SIGN_UP,
    EAuthErrorCodes.REQUIRED_EMAIL_PASSWORD_SIGN_UP,
    EAuthErrorCodes.INVALID_EMAIL_SIGN_UP,
    EAuthErrorCodes.INVALID_EMAIL_MAGIC_SIGN_UP,
    EAuthErrorCodes.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED,
    EAuthErrorCodes.USER_DOES_NOT_EXIST,
    EAuthErrorCodes.AUTHENTICATION_FAILED_SIGN_IN,
    EAuthErrorCodes.REQUIRED_EMAIL_PASSWORD_SIGN_IN,
    EAuthErrorCodes.INVALID_EMAIL_SIGN_IN,
    EAuthErrorCodes.INVALID_EMAIL_MAGIC_SIGN_IN,
    EAuthErrorCodes.MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED,
    EAuthErrorCodes.INVALID_MAGIC_CODE_SIGN_IN,
    EAuthErrorCodes.INVALID_MAGIC_CODE_SIGN_UP,
    EAuthErrorCodes.EXPIRED_MAGIC_CODE_SIGN_IN,
    EAuthErrorCodes.EXPIRED_MAGIC_CODE_SIGN_UP,
    EAuthErrorCodes.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN,
    EAuthErrorCodes.EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP,
    EAuthErrorCodes.OAUTH_NOT_CONFIGURED,
    EAuthErrorCodes.GOOGLE_NOT_CONFIGURED,
    EAuthErrorCodes.GITHUB_NOT_CONFIGURED,
    EAuthErrorCodes.GITLAB_NOT_CONFIGURED,
    EAuthErrorCodes.GOOGLE_OAUTH_PROVIDER_ERROR,
    EAuthErrorCodes.GITHUB_OAUTH_PROVIDER_ERROR,
    EAuthErrorCodes.GITLAB_OAUTH_PROVIDER_ERROR,
    EAuthErrorCodes.INVALID_PASSWORD_TOKEN,
    EAuthErrorCodes.EXPIRED_PASSWORD_TOKEN,
    EAuthErrorCodes.INCORRECT_OLD_PASSWORD,
    EAuthErrorCodes.INVALID_NEW_PASSWORD,
    EAuthErrorCodes.PASSWORD_ALREADY_SET,
    EAuthErrorCodes.ADMIN_ALREADY_EXIST,
    EAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME,
    EAuthErrorCodes.INVALID_ADMIN_EMAIL,
    EAuthErrorCodes.INVALID_ADMIN_PASSWORD,
    EAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD,
    EAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED,
    EAuthErrorCodes.ADMIN_USER_ALREADY_EXIST,
    EAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST,
    EAuthErrorCodes.USER_ACCOUNT_DEACTIVATED,
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
