import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PreferencesSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { queryClient, useBootstrap } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import type { Locale } from "./keys";
import { activeLocale, shouldSyncLocale } from "./locale-sync";

/**
 * Keeps the server's per-user locale (it sets the language of push notifications) equal to the app's language.
 * Fire and forget: a failure is swallowed and tried again at the next bootstrap, because the mismatch is still
 * there. Every hook runs on every render; only the values combine.
 */
export function useLocaleSync(sessionLive: boolean): void {
  const { i18n } = useTranslation();
  const appLocale = activeLocale(i18n.language);
  // Observes the cached bootstrap without fetching it (the trade screen owns the fetch).
  const { data, dataUpdatedAt } = useBootstrap(false);
  const serverLocale = data?.profile.locale;
  const inFlight = useRef<Locale | null>(null);

  useEffect(() => {
    if (!shouldSyncLocale({ serverLocale, appLocale, sessionLive, inFlight: inFlight.current })) return;
    inFlight.current = appLocale;
    api("/api/v1/account/preferences", { method: "PATCH", body: { locale: appLocale }, schema: PreferencesSchema })
      .then(({ locale }) => {
        // Refetch so the profile carries the new locale and this value is not sent again. Not when the server kept
        // another value, or the refetch would loop. (Patching the cache instead would re-seed the socket store.)
        if (locale === appLocale) refreshBootstrap(queryClient);
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = null;
      });
    // dataUpdatedAt: a failed send is retried when the next bootstrap lands, even though the locales are unchanged.
  }, [serverLocale, appLocale, sessionLive, dataUpdatedAt]);
}
