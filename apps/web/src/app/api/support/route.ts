import { NextResponse, type NextRequest } from "next/server";
import { CreateTicketSchema } from "@asm/contracts";
import { createTicket, listTicketsForActor } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:ticket:${session.userId}`, 5, 600))) {
    return NextResponse.json(
      { error: "You have opened several tickets recently. Try again later." },
      { status: 429 },
    );
  }

  const parsed = CreateTicketSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the ticket." },
      { status: 400 },
    );
  }

  const ticket = await createTicket(session.userId, parsed.data);
  log.info({ evt: "support.ticket_created", ticketId: ticket.id }, "ticket created");

  return NextResponse.json({ id: ticket.id }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ tickets: await listTicketsForActor(session.userId, 20) });
}
