export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { streamChat, type ChatMessage } from "@/lib/chat-engine";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { messages: ChatMessage[]; userContext?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages array is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      streamChat(
        body.messages,
        session.user.id,
        body.userContext || "",
        {
          onToken(text) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          },
          onDone(fullText) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ done: true, fullText })}\n\n`)
            );
            controller.close();
          },
          onError(error) {
            console.error("[chat] Stream error:", error);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`
              )
            );
            controller.close();
          },
        }
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
