import { createConnection } from "node:net";

export function sendMessage(sockPath: string, msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    let data = "";

    socket.on("connect", () => {
      socket.write(JSON.stringify(msg));
    });

    socket.on("data", (chunk) => {
      data += chunk.toString();
    });

    socket.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid response from daemon"));
      }
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        reject(new Error("session not found"));
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      socket.destroy();
      reject(new Error("connection timeout"));
    }, 5000);
  });
}
