import { redirect } from "next/navigation";

// The Approvals queue was split into /admin/deposits and /admin/withdrawals so
// each grows and paginates independently. The bell icon in the top bar, the
// dashboard link, and any bookmarked URL land here; forward everyone to the
// deposit queue by default.
export default function ApprovalsRedirect(): never {
  redirect("/admin/deposits");
}
