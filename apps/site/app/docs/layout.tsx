import type { ReactNode } from "react";
import { DocsSidebar, MobileDocsNav } from "@/components/DocsSidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
      <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-12">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-12 pr-4">
            <DocsSidebar />
          </div>
        </aside>

        <div className="min-w-0 py-8 lg:py-12">
          <div className="mb-8 lg:hidden">
            <MobileDocsNav />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
