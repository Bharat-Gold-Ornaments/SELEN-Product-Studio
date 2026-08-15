import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

const bodySchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    parsed = bodySchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  let passwordOk: boolean;
  try {
    passwordOk = verifyPassword(parsed.password);
  } catch (error) {
    // ADMIN_PASSWORD not configured on the server.
    console.error("Login attempted before ADMIN_PASSWORD was configured", error);
    return NextResponse.json(
      { error: "Authentication is not configured on the server yet." },
      { status: 500 }
    );
  }

  if (!passwordOk) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken();
  await setSessionCookie(token);

  return NextResponse.json({ ok: true });
}
