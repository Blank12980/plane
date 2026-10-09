/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useDropzone } from "react-dropzone";
import { TwitterPicker } from "react-color";
import { Controller, useForm } from "react-hook-form";
import { Popover, Transition } from "@headlessui/react";
// gizmo imports
import { LABEL_COLOR_OPTIONS, MAX_FILE_SIZE } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkspaceTag } from "@plane/types";
import { EFileAssetType } from "@plane/types";
import { EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { getAssetIdFromUrl, getFileURL } from "@plane/utils";
// hooks
import { useWorkspaceTag } from "@/hooks/store/use-workspace-tag";
// services
import { FileService } from "@/services/file.service";

const fileService = new FileService();

const ACCEPTED_TAG_IMAGE_TYPES = {
  "image/jpeg": [],
  "image/jpg": [],
  "image/png": [],
  "image/webp": [],
  "image/gif": [],
};

type Props = {
  workspaceSlug: string;
  /** The tag to edit, or `null` to create a new one. */
  tag: TWorkspaceTag | null;
  isOpen: boolean;
  onClose: () => void;
};

type TFormValues = {
  name: string;
  color: string;
};

export const TagFormModal = observer(function TagFormModal(props: Props) {
  const { workspaceSlug, tag, isOpen, onClose } = props;
  const { t } = useTranslation();
  // store hooks
  const { createTag, updateTag, refreshTags } = useWorkspaceTag();
  // states
  const [newImage, setNewImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState(false);
  // form
  const {
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TFormValues>({ defaultValues: { name: "", color: "" } });

  // every time the modal opens it starts from the tag being edited, or blank for a new tag
  useEffect(() => {
    if (!isOpen) return;
    reset({ name: tag?.name ?? "", color: tag?.color ?? "" });
    setNewImage(null);
    setRemoveImage(false);
    setImageError(false);
  }, [isOpen, tag, reset]);

  const { getRootProps, getInputProps } = useDropzone({
    accept: ACCEPTED_TAG_IMAGE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: false,
    onDropAccepted: (files) => {
      setNewImage(files[0]);
      setRemoveImage(false);
      setImageError(false);
    },
    onDropRejected: () => setImageError(true),
  });

  const newImagePreview = useMemo(() => (newImage ? URL.createObjectURL(newImage) : undefined), [newImage]);
  useEffect(() => {
    return () => {
      if (newImagePreview) URL.revokeObjectURL(newImagePreview);
    };
  }, [newImagePreview]);

  const color = watch("color");
  const savedImageUrl = !removeImage && tag?.image_url ? getFileURL(tag.image_url) : undefined;
  const previewUrl = newImagePreview ?? savedImageUrl;

  const onSubmit = async (values: TFormValues) => {
    const payload = { name: values.name.trim(), color: values.color };
    try {
      const saved = tag ? await updateTag(workspaceSlug, tag.id, payload) : await createTag(workspaceSlug, payload);

      let imageChanged = false;
      let imageFailed = false;
      try {
        if (tag?.image_url && removeImage) {
          await fileService.deleteWorkspaceAsset(workspaceSlug, getAssetIdFromUrl(tag.image_url));
          imageChanged = true;
        }
        if (newImage) {
          // the API retires the previous image when a new one is attached
          await fileService.uploadWorkspaceAsset(
            workspaceSlug,
            { entity_type: EFileAssetType.TAG_IMAGE, entity_identifier: saved.id },
            newImage
          );
          imageChanged = true;
        }
      } catch (_error) {
        imageFailed = true;
      }
      if (imageChanged || imageFailed) await refreshTags(workspaceSlug);

      setToast({
        type: imageFailed ? TOAST_TYPE.ERROR : TOAST_TYPE.SUCCESS,
        title: imageFailed ? t("error") : t("success"),
        message: imageFailed
          ? t("workspace_settings.settings.tags.toasts.image_error")
          : t(
              tag
                ? "workspace_settings.settings.tags.toasts.updated"
                : "workspace_settings.settings.tags.toasts.created"
            ),
      });
      onClose();
    } catch (error: any) {
      const nameError = Array.isArray(error?.name) ? String(error.name[0]) : undefined;
      if (nameError) {
        setError("name", {
          message: nameError.includes("already exists") ? t("workspace_settings.settings.tags.name_exists") : nameError,
        });
        return;
      }
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("workspace_settings.settings.tags.toasts.error"),
      });
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <form
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event);
        }}
        className="space-y-5 p-5"
      >
        <h3 className="text-h5-medium text-primary">
          {t(tag ? "workspace_settings.settings.tags.edit_title" : "workspace_settings.settings.tags.create_title")}
        </h3>

        {/* name */}
        <div className="space-y-1">
          <label htmlFor="tag-name" className="text-body-xs-medium text-secondary">
            {t("name")}
          </label>
          <Controller
            control={control}
            name="name"
            rules={{
              validate: (value) => {
                const name = value.trim();
                if (!name) return t("workspace_settings.settings.tags.name_required");
                if (name.length > 100) return t("workspace_settings.settings.tags.name_too_long");
                return true;
              },
            }}
            render={({ field: { value, onChange, ref } }) => (
              <Input
                id="tag-name"
                ref={ref}
                value={value}
                onChange={onChange}
                hasError={Boolean(errors.name)}
                placeholder={t("workspace_settings.settings.tags.name_placeholder")}
                className="w-full"
              />
            )}
          />
          {errors.name?.message && <p className="text-body-xs-regular text-danger-primary">{errors.name.message}</p>}
        </div>

        {/* colour (optional) */}
        <div className="space-y-1">
          <span className="text-body-xs-medium text-secondary">
            {t("workspace_settings.settings.tags.color")}{" "}
            <span className="text-tertiary">({t("workspace_settings.settings.tags.color_optional")})</span>
          </span>
          <div className="flex items-center gap-3">
            <Popover className="relative">
              <Popover.Button className="flex size-8 items-center justify-center rounded-md border border-subtle focus:outline-none">
                <span
                  className="size-5 rounded-full border border-subtle"
                  style={color ? { backgroundColor: color } : undefined}
                />
              </Popover.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
              >
                <Popover.Panel className="absolute top-full left-0 z-20 mt-2">
                  <TwitterPicker
                    colors={LABEL_COLOR_OPTIONS}
                    color={color || undefined}
                    onChange={(selected) => setValue("color", selected.hex, { shouldDirty: true })}
                  />
                </Popover.Panel>
              </Transition>
            </Popover>
            {color && (
              <button
                type="button"
                className="text-body-xs-regular text-tertiary hover:text-secondary"
                onClick={() => setValue("color", "", { shouldDirty: true })}
              >
                {t("workspace_settings.settings.tags.no_color")}
              </button>
            )}
          </div>
        </div>

        {/* image (optional) */}
        <div className="space-y-1">
          <span className="text-body-xs-medium text-secondary">
            {t("workspace_settings.settings.tags.image")}{" "}
            <span className="text-tertiary">({t("workspace_settings.settings.tags.image_optional")})</span>
          </span>
          <div className="flex items-center gap-3">
            <div
              {...getRootProps()}
              className="flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-subtle bg-layer-2 hover:bg-layer-2-hover"
            >
              <input {...getInputProps()} />
              {previewUrl ? (
                <img src={previewUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="px-1 text-center text-body-xs-regular text-tertiary">
                  {t("workspace_settings.settings.tags.upload_image")}
                </span>
              )}
            </div>
            <div className="flex flex-col items-start gap-1">
              {previewUrl && (
                <button
                  type="button"
                  className="text-body-xs-regular text-tertiary hover:text-secondary"
                  onClick={() => {
                    setNewImage(null);
                    setRemoveImage(true);
                  }}
                >
                  {t("workspace_settings.settings.tags.remove_image")}
                </button>
              )}
              <p className="text-body-xs-regular text-tertiary">{t("workspace_settings.settings.tags.image_hint")}</p>
              {imageError && (
                <p className="text-body-xs-regular text-danger-primary">
                  {t("workspace_settings.settings.tags.image_invalid")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-subtle pt-4">
          <Button variant="secondary" size="lg" type="button" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
            {isSubmitting ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
