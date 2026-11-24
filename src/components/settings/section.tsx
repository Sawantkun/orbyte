export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-b border-border py-8 first:pt-0 last:border-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="max-w-lg">{children}</div>
    </section>
  );
}
