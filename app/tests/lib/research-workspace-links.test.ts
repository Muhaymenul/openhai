import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudyMarkdown } from "../../src/components/research/study/StudyMarkdown";
import {
  normalizeWorkspaceCitationHref,
  workspaceCitationTarget,
} from "../../src/components/research/study/workspace-links";

describe("local workspace source links", () => {
  it("repairs only the explicit workspace-host citation typo, including the legacy paper alias", () => {
    expect(
      normalizeWorkspaceCitationHref(
        "https://workspace?paperId=real-paper&page=1",
      ),
    ).toBe("/workspace?paperId=real-paper&page=1");
    expect(
      normalizeWorkspaceCitationHref(
        "http://workspace/?paper=real-paper&amp;page=4",
      ),
    ).toBe("/workspace?paperId=real-paper&page=4");
    expect(
      workspaceCitationTarget("https://workspace?paperId=real-paper&page=1"),
    ).toEqual({ paperId: "real-paper", page: 1 });
    expect(
      workspaceCitationTarget("/workspace?paper=real-paper&page=4"),
    ).toEqual({ paperId: "real-paper", page: 4 });
  });

  it("leaves external sites and ambiguous or invalid source URLs unchanged", () => {
    for (const href of [
      "https://workspace.example?paperId=real-paper&page=1",
      "https://example.test/workspace?paperId=real-paper&page=1",
      "https://workspace@outside.test?paperId=real-paper&page=1",
      "https://outside.test@workspace?paperId=real-paper&page=1",
      "https://workspace:443?paperId=real-paper&page=1",
      "https://workspace/other?paperId=real-paper&page=1",
      "https://workspace?paperId=real-paper&paper=other-paper&page=1",
      "https://workspace?paperId=real-paper&page=1&redirect=outside",
      "https://workspace?paperId=real-paper&page=0",
      "https://workspace?paperId=real-paper&page=1.5",
      "https://workspace?paperId=../../outside&page=1",
      "https://workspace?paperId=real-paper&page=1#unrelated",
      "//workspace?paperId=real-paper&page=1",
    ]) {
      expect(normalizeWorkspaceCitationHref(href)).toBe(href);
      expect(workspaceCitationTarget(href)).toBeNull();
    }
  });

  it("renders repaired links in prose and folded answers while preserving external links and code examples", () => {
    const html = renderToStaticMarkup(
      createElement(StudyMarkdown, {
        highlightCode: false,
        content:
          "[原文](https://workspace?paperId=real-paper&page=1) [外部](https://workspace.example?paperId=real-paper&page=1)\n\n```text\n[代码示例](https://workspace?paperId=example-paper&page=3)\n```\n\n### 问题1：方法是什么？\n答案：[来源](http://workspace?paper=real-paper&page=4)",
      }),
    );
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)];
    expect(anchors.map((match) => match[1])).toEqual([
      "/workspace?paperId=real-paper&amp;page=1",
      "https://workspace.example?paperId=real-paper&amp;page=1",
      "/workspace?paperId=real-paper&amp;page=4",
    ]);
    expect(anchors[0][0]).not.toContain("target=");
    expect(anchors[1][0]).toContain('target="_blank"');
    expect(anchors[1][0]).toContain("noopener noreferrer");
    expect(html).toContain(
      "https://workspace?paperId=example-paper&amp;page=3",
    );
  });
});
