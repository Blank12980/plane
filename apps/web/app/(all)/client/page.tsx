/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import DOMPurify from "dompurify";
import { Button } from "@plane/propel/button";
import { PlaneLockup } from "@plane/propel/icons";
import { getFileURL } from "@plane/utils";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser } from "@/hooks/store/user";
import { clientAccessService } from "@/services/client-access.service";
import { sanitizeClientHtml } from "@/helpers/client-content";

function ClientPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug.toString();
  const searchParams = useSearchParams();
  const { getWorkspaceBySlug } = useWorkspace();
  const { signOut } = useUser();
  const {
    data: resources,
    error,
    mutate,
  } = useSWR(["CLIENT_RESOURCES", slug], () => clientAccessService.resources(slug), {
    refreshInterval: 15000,
    shouldRetryOnError: false,
  });
  const selectedId = searchParams.get("resource") || resources?.[0]?.id;
  const { data: detail, error: detailError } = useSWR(
    selectedId ? ["CLIENT_RESOURCE", slug, selectedId] : null,
    () => clientAccessService.detail(slug, selectedId!),
    { refreshInterval: 15000, shouldRetryOnError: false }
  );
  const renderHtml = (html: string) => (
    <div
      className="max-w-none break-words text-primary prose [&_img]:max-w-full"
      dangerouslySetInnerHTML={{
        __html: sanitizeClientHtml(
          html,
          DOMPurify.sanitize,
          (assetId) => getFileURL(`/api/workspaces/${slug}/client-resources/${selectedId}/files/${assetId}/`) || ""
        ),
      }}
    />
  );

  return (
    <div className="flex h-full min-h-screen flex-col bg-surface-1 text-primary">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-subtle px-6 py-4">
        <div className="flex items-center gap-5">
          <PlaneLockup className="h-10 w-auto text-primary" />
          <div>
            <h1 className="font-semibold">{getWorkspaceBySlug(slug)?.name}</h1>
            <p className="text-13 text-secondary">Доступные задачи и страницы · Только просмотр</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/invitations">Приглашения</Link>
          <Button
            variant="ghost"
            onClick={() => {
              void signOut().catch((signOutError: unknown) => console.error("Sign out failed", signOutError));
            }}
          >
            Выйти
          </Button>
        </div>
      </header>
      {error ? (
        <div className="p-8" role="alert">
          Не удалось загрузить доступные материалы.{" "}
          <Button variant="secondary" onClick={() => void mutate()}>
            Повторить
          </Button>
        </div>
      ) : !resources ? (
        <LogoSpinner />
      ) : resources.length === 0 ? (
        <div className="m-auto max-w-lg p-8 text-center">
          <h2 className="text-20 font-semibold">Пока нет доступных материалов</h2>
          <p className="mt-3 text-secondary">
            Администратор пространства может открыть вам отдельные задачи и страницы. Они появятся здесь.
          </p>
          <Button className="mt-5" variant="secondary" onClick={() => void mutate()}>
            Проверить доступ
          </Button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 md:grid-cols-[20rem_1fr]">
          <nav
            aria-label="Доступные материалы"
            className="max-h-64 overflow-y-auto border-b border-subtle p-4 md:max-h-none md:border-r md:border-b-0"
          >
            {resources.map((resource) => (
              <Link
                key={resource.id}
                href={`/${slug}/client?resource=${resource.id}`}
                className={`mb-2 block rounded p-3 ${selectedId === resource.id ? "bg-layer-2" : "hover:bg-layer-1"}`}
              >
                <span className="text-11 text-secondary">
                  {resource.resource_type === "issue" ? "Задача" : "Страница"} · {resource.project_name}
                </span>
                <div className="mt-1 text-13">
                  {resource.identifier} {resource.name}
                </div>
              </Link>
            ))}
          </nav>
          <main className="min-w-0 overflow-y-auto p-6 md:p-10">
            {detailError ? (
              <p role="alert">Материал недоступен. Возможно, администратор закрыл доступ.</p>
            ) : !detail ? (
              <LogoSpinner />
            ) : (
              <article className="mx-auto max-w-4xl space-y-6">
                <h2 className="text-24 font-semibold">
                  {detail.identifier} {detail.name}
                </h2>
                {detail.status && (
                  <p className="text-13 text-secondary">
                    Статус: {detail.status}
                    {detail.target_date ? ` · Срок: ${detail.target_date}` : ""}
                  </p>
                )}
                {renderHtml(detail.description_html)}
                {detail.attachments.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="font-medium">Файлы</h3>
                    {detail.attachments.map((asset) => (
                      <a
                        className="block text-accent-primary underline"
                        key={asset.id}
                        href={getFileURL(asset.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {asset.name}
                      </a>
                    ))}
                  </section>
                )}
                {!!detail.comments?.length && (
                  <section className="space-y-4">
                    <h3 className="font-medium">Комментарии</h3>
                    {detail.comments.map((comment) => (
                      <div key={comment.id} className="rounded border border-subtle p-4">
                        <p className="mb-2 text-13 text-secondary">{comment.author}</p>
                        {renderHtml(comment.html)}
                      </div>
                    ))}
                  </section>
                )}
              </article>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

export default observer(ClientPage);
