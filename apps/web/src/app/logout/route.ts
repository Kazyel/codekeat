import { NextResponse } from "next/server";

import { deleteDashboardSession } from "../lib/api-client";
import { readSessionToken, sessionCookies } from "../lib/session";

export async function POST(request: Request): Promise<NextResponse> {
  const token = await readSessionToken();
  if (token !== null) {
    await deleteDashboardSession(token);
  }
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(sessionCookies.session);
  return response;
}
