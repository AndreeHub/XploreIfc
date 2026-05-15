import { createServer } from "vite";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 5173;

const server = await createServer({
  server: {
    host: "127.0.0.1",
    port
  }
});

await server.listen();
server.printUrls();
setInterval(() => undefined, 2_147_483_647);
