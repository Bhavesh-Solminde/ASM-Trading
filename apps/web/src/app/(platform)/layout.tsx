import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IconRail } from "@/components/shell/IconRail";
import { TopBar } from "@/components/shell/TopBar";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <IconRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
