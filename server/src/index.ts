import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

app.register(cors);

app.get("/health", async () => {
  return { status: "ok" };
});

const start = async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: "0.0.0.0" });
};

start();
