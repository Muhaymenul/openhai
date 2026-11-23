import { afterEach, describe, expect, it, vi } from "vitest";
import {
  researchApi,
  WORKSPACE_CHANGE_KEY,
} from "../../src/components/research/api";
import { deleteTrashedPapers } from "../../src/components/research/library/trash-actions";

const papers = [
  { id: "paper-one", title: "形成性反馈", version: 4 },
  { id: "paper-two", title: "自我调节学习", version: 8 },
  { id: "paper-three", title: "设计研究", version: 2 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recycle bin deletion actions", () => {
  it("deletes sequentially with the versions the reader confirmed", async () => {
    let inFlight = 0;
    let completedRequests = 0;
    const fetch = vi.fn(async () => {
      inFlight++;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight--;
      return Response.json({
        deletedId: papers[completedRequests++].id,
      });
    });
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();

    const result = await deleteTrashedPapers(papers, progress);

    expect(result).toEqual({
      deletedIds: papers.map((paper) => paper.id),
      cleanupPendingIds: [],
    });
    expect(progress.mock.calls.map(([, completed]) => completed)).toEqual([
      0, 1, 2,
    ]);
    expect(fetch.mock.calls).toHaveLength(3);
    for (const [index, paper] of papers.entries()) {
      expect(fetch).toHaveBeenNthCalledWith(
        index + 1,
        "/api/research/trash/" + paper.id,
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ version: paper.version }),
        }),
      );
    }
  });

  it("reports partial completion and stops before deleting the next paper", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ deletedId: papers[0].id }))
      .mockResolvedValueOnce(
        Response.json({ error: "文献已变更，请刷新后重试" }, { status: 409 }),
      );
    vi.stubGlobal("fetch", fetch);

    const result = await deleteTrashedPapers(papers, () => undefined);

    expect(result).toEqual({
      deletedIds: [papers[0].id],
      cleanupPendingIds: [],
      failed: { paper: papers[1], message: "文献已变更，请刷新后重试" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps unacknowledged deletions out of the completed result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("连接已中断")));

    const result = await deleteTrashedPapers(papers, () => undefined);

    expect(result).toEqual({
      deletedIds: [],
      cleanupPendingIds: [],
      failed: { paper: papers[0], message: "连接已中断" },
    });
  });

  it.each([{ deletedId: "another-paper" }, {}, null])(
    "does not treat HTTP 200 with an incorrect deletion receipt as success: %j",
    async (payload) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(payload));
      vi.stubGlobal("fetch", fetch);

      const result = await deleteTrashedPapers(papers, () => undefined);

      expect(result).toEqual({
        deletedIds: [],
        cleanupPendingIds: [],
        failed: {
          paper: papers[0],
          message: "未收到正确的删除确认，请刷新回收站后重试。",
        },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("reports pending disk cleanup separately from deleted library records", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ deletedId: papers[0].id, cleanupPending: true }),
        ),
    );

    const result = await deleteTrashedPapers([papers[0]], () => undefined);

    expect(result).toEqual({
      deletedIds: [papers[0].id],
      cleanupPendingIds: [papers[0].id],
    });
  });

  it("notifies other workspace tabs after a successful permanent deletion only", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem } });
    vi.stubGlobal("crypto", { randomUUID: () => "library-changed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    await researchApi("/trash/" + papers[0].id, { method: "DELETE" });
    expect(setItem).toHaveBeenCalledWith(
      WORKSPACE_CHANGE_KEY,
      "library-changed",
    );
    setItem.mockClear();
    await researchApi("/trash");
    expect(setItem).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "版本冲突" }, { status: 409 }),
        ),
    );
    await expect(
      researchApi("/trash/" + papers[0].id, { method: "DELETE" }),
    ).rejects.toThrow("版本冲突");
    expect(setItem).not.toHaveBeenCalled();
  });
});
