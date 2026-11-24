import type { Metadata } from "next";
import { format } from "date-fns";
import { SettingsSection } from "@/components/settings/section";
import { ProfileForm } from "@/components/settings/profile-form";
import { db } from "@/lib/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const record = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } });

  return (
    <>
      <SettingsSection title="Profile" description="How you appear across Orbyte.">
        <ProfileForm name={user.name} email={user.email} />
      </SettingsSection>
      <SettingsSection title="Account">
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{format(record.createdAt, "MMMM d, yyyy")}</dd>
        </dl>
      </SettingsSection>
    </>
  );
}
