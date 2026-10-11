import type { ReactNode } from "react";

/** The calm, branded frame for setup, sign-in and forced password change. */
export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col gap-3">
        <p className="font-display text-3xl font-bold tracking-tight">
          vita<span className="text-primary">.</span>
        </p>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <div className="rounded-xl border bg-card p-6">{children}</div>
    </main>
  );
}
