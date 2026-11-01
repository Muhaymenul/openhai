import { z } from "zod";
import { FilesystemBusyError } from "../../filesystem-lock";
import { ResearchError } from "../store";
import {
  createPlannerTask,
  listPlannerTasks,
  plannerCalendar,
  plannerCreateSchema,
  plannerPatchSchema,
  updatePlannerTask,
} from "./core";

export async function handlePlannerRequest(
  request: Request,
  path: string[] = [],
) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host))
      throw new ResearchError("研究待办仅允许本机访问", 403);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const origin = request.headers.get("origin");
      if (
        (origin && origin !== `${url.protocol}//${host}`) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new ResearchError("跨来源保存已拒绝", 403);
    }
    z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))
      .max(1)
      .parse(path);
    const [id] = path;
    if (request.method === "GET" && !id)
      return json({ tasks: listPlannerTasks() });
    if (request.method === "GET" && id === "calendar")
      return new Response(plannerCalendar(), {
        headers: {
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'attachment; filename="research-tasks.ics"',
          "cache-control": "no-store",
        },
      });
    if (Number(request.headers.get("content-length") || 0) > 65536)
      throw new ResearchError("待办内容过长", 413);
    if (request.method === "POST" && !id)
      return json(
        {
          task: await createPlannerTask(
            plannerCreateSchema.parse(await request.json()),
          ),
        },
        201,
      );
    if (request.method === "PATCH" && id)
      return json({
        task: await updatePlannerTask(
          id,
          plannerPatchSchema.parse(await request.json()),
        ),
      });
    throw new ResearchError("待办操作不存在", 404);
  } catch (error) {
    if (error instanceof ResearchError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "请填写标题及有效的截止时间" }, 400);
    if (error instanceof FilesystemBusyError)
      return json({ error: "工作区正在保存，请稍后重试" }, 409);
    return json({ error: "待办未保存，请稍后重试" }, 500);
  }
}
