import { redirect } from "next/navigation";

import { readSession } from "./lib/session";

export default async function HomePage(): Promise<never> {
  const session = await readSession();
  redirect(session === null ? "/login" : "/dashboard");
}
