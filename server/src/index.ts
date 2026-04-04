import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import ratePusher from "./plugins/ratePusher";

const app = Fastify({ logger: true });

app.register(cors);
app.register(ratePusher);

app.get("/health", async () => {
  return { status: "ok" };
});

// ─── Invite Code Store (in-memory) ──────────────────────────

const inviteCodes = new Map<string, string>(); // groupId -> inviteCode

app.put<{ Params: { groupId: string }; Body: { code: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    const { code } = request.body;
    if (!code) return reply.status(400).send({ error: "code is required" });
    inviteCodes.set(groupId, code);
    return { status: "ok" };
  }
);

app.get<{ Params: { groupId: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    const code = inviteCodes.get(groupId);
    if (!code) return reply.status(404).send({ error: "no invite code set" });
    return { code };
  }
);

app.delete<{ Params: { groupId: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    inviteCodes.delete(groupId);
    return { status: "ok" };
  }
);

const start = async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: "0.0.0.0" });
};

start();
