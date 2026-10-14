import { Redirect } from "expo-router";

/** Entry route: the gatekeeper sends signed-out and locked users elsewhere before this settles. */
export default function Index() {
  return <Redirect href="/trade" />;
}
