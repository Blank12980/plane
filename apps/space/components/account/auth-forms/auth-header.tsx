/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// helpers
import { EAuthModes } from "@/types/auth";

type TAuthHeader = {
  authMode: EAuthModes;
};

type TAuthHeaderContent = {
  header: string;
  subHeader: string;
};

type TAuthHeaderDetails = {
  [mode in EAuthModes]: TAuthHeaderContent;
};

const Titles: TAuthHeaderDetails = {
  [EAuthModes.SIGN_IN]: {
    header: "Войдите, чтобы голосовать и комментировать",
    subHeader: "Помогите выбрать функции, которые стоит сделать.",
  },
  [EAuthModes.SIGN_UP]: {
    header: "Смотрите, комментируйте и не только",
    subHeader: "Зарегистрируйтесь или войдите, чтобы работать с элементами и страницами Gizmo.",
  },
};

export function AuthHeader(props: TAuthHeader) {
  const { authMode } = props;

  const getHeaderSubHeader = (mode: EAuthModes | null): TAuthHeaderContent => {
    if (mode) {
      return Titles[mode];
    }

    return {
      header: "Комментируйте и реагируйте на рабочие элементы",
      subHeader: "Используйте Gizmo, чтобы добавлять свои мысли к функциям.",
    };
  };

  const { header, subHeader } = getHeaderSubHeader(authMode);

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-20 leading-7 font-semibold text-primary">{header}</span>
        <span className="text-20 leading-7 font-semibold text-placeholder">{subHeader}</span>
      </div>
    </>
  );
}
