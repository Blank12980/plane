/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function sanitizeClientHtml(
  html: string,
  sanitize: (html: string) => string,
  resolveAsset?: (assetId: string) => string
): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const node of document.querySelectorAll("image-component")) {
    const image = document.createElement("img");
    image.setAttribute("src", node.getAttribute("src") || "");
    image.setAttribute("alt", node.getAttribute("alt") || "");
    node.replaceWith(image);
  }
  if (resolveAsset) {
    for (const node of document.querySelectorAll("[src], a[href]")) {
      const attribute = node.hasAttribute("src") ? "src" : "href";
      const url = node.getAttribute(attribute) || "";
      const assetId = url.match(/\/api\/assets\/v2\/[^?#]*\/([a-f0-9-]{36})\/?(?:[?#]|$)/i)?.[1];
      if (assetId) node.setAttribute(attribute, resolveAsset(assetId));
    }
  }
  return sanitize(document.body.innerHTML);
}
