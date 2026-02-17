import type { ReactNode } from "react";

type SectionShellProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

export default function SectionShell({ sidebar, children }: SectionShellProps) {
  return (
    <section className="mx-auto mt-10 grid w-[min(1200px,94%)] gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-xl border border-black/8 bg-[#ececec] p-5">{sidebar}</aside>
      <div>{children}</div>
    </section>
  );
}
