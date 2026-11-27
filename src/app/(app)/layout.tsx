import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { SIDEBAR_COOKIE } from "@/components/layout/constants";
import { listRecentActivity } from "@/server/activity";
import { requireUser } from "@/server/session";
import { accountEmailEnabled } from "@/server/system-mail";
import { VerifyEmailBanner } from "@/components/auth/verify-email-banner";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [cookieStore, activity] = await Promise.all([cookies(), listRecentActivity(user.id, 6)]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, image: user.image }}
      defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "1"}
      activity={activity}
    >
      {!user.emailVerified && accountEmailEnabled() && <VerifyEmailBanner email={user.email} />}
      {children}
    </AppShell>
  );
}
