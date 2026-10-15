import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { ToggleSwitch } from "@plane/ui";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { SettingsControlItem } from "@/components/settings/control-item";
import { useUser } from "@/hooks/store/user";
import { notificationSoundEnabled, playNotificationSound, saveNotificationSound } from "@/helpers/notification-alerts";

export const NotificationSoundSettings = observer(function NotificationSoundSettings() {
  const { data: user } = useUser();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (user?.id) setEnabled(notificationSoundEnabled(user.id));
  }, [user?.id]);
  if (!user) return null;
  return (
    <SettingsControlItem
      title="Звук уведомлений"
      description="Звуковой сигнал о новых действиях в задачах и достижении лимита часов. Настройка действует в этом браузере."
      control={
        <ToggleSwitch
          value={enabled}
          size="sm"
          onChange={(value) => {
            try {
              saveNotificationSound(user.id, value);
              setEnabled(value);
              if (value) void playNotificationSound();
            } catch (error) {
              console.error(error);
              setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось сохранить настройку звука" });
            }
          }}
        />
      }
    />
  );
});
