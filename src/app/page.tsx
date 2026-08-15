import { redirect } from "next/navigation";

// Middleware already ensures only authenticated requests reach this far;
// the root route simply hands off to the Dashboard.
export default function RootPage() {
  redirect("/dashboard");
}
