import { ContentShell } from "@/components/content/ContentShell";

export default function ContentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ContentShell>{children}</ContentShell>;
}
