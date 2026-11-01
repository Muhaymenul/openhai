import net from "node:net";
import { randomUUID } from "node:crypto";

export function paperflowRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const host = process.env.PAPERFLOW_HOST || "127.0.0.1";
  const port = Number(process.env.PAPERFLOW_PORT || 17437);
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.createConnection({ host, port });
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value as T);
    };
    socket.setTimeout(20_000, () =>
      finish(new Error("PaperFlow 连接超时，请检查本地分析服务。")),
    );
    socket.on("connect", () =>
      socket.write(JSON.stringify({ id, method, params }) + "\n"),
    );
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 16 * 1024 * 1024)
        return finish(new Error("PaperFlow 响应过大。"));
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as {
            id?: string;
            result?: T;
            error?: { message?: string };
          };
          if (message.id !== id) continue;
          if (message.error)
            return finish(
              new Error(
                (message.error.message || "PaperFlow 请求失败").replace(
                  /sk-[A-Za-z0-9_-]+/g,
                  "[已隐藏]",
                ),
              ),
            );
          return finish(undefined, message.result);
        } catch {
          return finish(new Error("PaperFlow 返回了无效协议数据。"));
        }
      }
    });
    socket.on("error", () =>
      finish(
        new Error("PaperFlow 分析服务未连接，请使用项目启动入口启动两个服务。"),
      ),
    );
    socket.on("close", () => {
      if (!settled) finish(new Error("PaperFlow 连接提前关闭。"));
    });
  });
}
