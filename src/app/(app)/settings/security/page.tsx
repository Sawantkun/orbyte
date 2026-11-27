import type { Metadata } from "next";
import { PasswordForm } from "@/components/settings/password-form";
import { SettingsSection } from "@/components/settings/section";
import { SessionsList } from "@/components/settings/sessions-list";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { describeIp, describeUserAgent, listActiveSessions } from "@/server/sessions";
import { getSession, requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const user = await requireUser();
  const session = await getSession();
  const sessions = await listActiveSessions(user.id, session?.session.id);

  return (
    <>
      <SettingsSection title="Password" description="Use at least 10 characters. A passphrase works well.">
        <PasswordForm />
      </SettingsSection>
      <SettingsSection title="Two-factor sign-in" description="Require a code from an authenticator app when you sign in.">
        <TwoFactorCard enabled={session?.user.twoFactorEnabled === true} />
      </SettingsSection>
      <SettingsSection title="Active sessions" description="Devices currently signed in to your account.">
        <SessionsList
          sessions={sessions.map((s) => ({
            id: s.id,
            device: describeUserAgent(s.userAgent),
            ipAddress: describeIp(s.ipAddress),
            lastActive: s.updatedAt,
            current: s.current,
          }))}
        />
      </SettingsSection>
    </>
  );
}
