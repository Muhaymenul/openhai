import { describe, expect, it } from "vitest";
import { uploadPendingPdfs } from "../../src/components/research/library/upload-queue";

describe("PDF import queue", () => {
  it("retries the failed and remaining requests without reimporting a successful PDF", async () => {
    const files = ["first.pdf", "second.pdf", "third.pdf"];
    const completed = new Set<string>();
    const requests: string[] = [];
    let unavailable = true;
    let completedEvents = 0;
    const importPdf = async (file: string) => {
      requests.push(file);
      if (file === "second.pdf" && unavailable)
        throw new Error("temporary failure");
    };
    const onImported = () => completedEvents++;
    await expect(
      uploadPendingPdfs(files, completed, importPdf, onImported),
    ).rejects.toThrow("temporary failure");
    expect([...completed]).toEqual(["first.pdf"]);
    expect(requests).toEqual(["first.pdf", "second.pdf"]);

    unavailable = false;
    await uploadPendingPdfs(files, completed, importPdf, onImported);
    expect(requests).toEqual([
      "first.pdf",
      "second.pdf",
      "second.pdf",
      "third.pdf",
    ]);
    expect([...completed]).toEqual(files);
    expect(completedEvents).toBe(3);
  });

  it("does not submit or notify again after the complete queue is retried", async () => {
    const completed = new Set(["paper.pdf"]);
    let calls = 0;
    await uploadPendingPdfs(
      ["paper.pdf"],
      completed,
      async () => {
        calls++;
      },
      () => {
        calls++;
      },
    );
    expect(calls).toBe(0);
  });
});
