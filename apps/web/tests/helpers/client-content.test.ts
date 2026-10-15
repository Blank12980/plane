/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { expect, test } from "vitest";
import DOMPurify from "dompurify";
import { sanitizeClientHtml } from "@/helpers/client-content";

test("client documents display editor images and remove executable markup", () => {
  const html = sanitizeClientHtml(
    '<p>Text</p><image-component src="/api/image/" alt="Diagram"></image-component><script>alert(1)</script><img src="bad" onerror="alert(1)"><a href="javascript:alert(1)">Link</a>',
    DOMPurify.sanitize
  );
  expect(html).toContain('<img src="/api/image/" alt="Diagram">');
  expect(html).not.toContain("<script");
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("javascript:");
});

test("document images use the resource grant to authorize each file", () => {
  const id = "e05b038e-81b4-4e4a-93c4-47d35937a70b";
  const html = sanitizeClientHtml(
    `<image-component src="/api/assets/v2/workspaces/team/projects/project/${id}/"></image-component>`,
    DOMPurify.sanitize,
    (assetId) => `/shared/grant/files/${assetId}/`
  );
  expect(html).toContain(`/shared/grant/files/${id}/`);
  expect(html).not.toContain("/api/assets/v2/");
});
