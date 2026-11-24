import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, security and usage." className="mb-6" />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
