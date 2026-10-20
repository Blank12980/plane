/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";

/** One quiet line instead of a tall illustration box: an empty list of links should not take up the page. */
export function LinksEmptyState() {
  const { t } = useTranslation();
  return <p className="text-13 text-tertiary">{t("workspace_empty_state.home_widget_quick_links.title")}</p>;
}
