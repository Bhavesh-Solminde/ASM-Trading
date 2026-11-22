import { redirect } from "next/navigation";

export function GET() {
  redirect("/download/app/install");
}
