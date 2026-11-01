import { describe, expect, it } from "vitest";
import {
  studyLabel,
  studyParts,
  studyPrompt,
  studyFrameworks,
  studyPurpose,
} from "../../src/components/research/study/frameworks";
import { createStudyGenerationAction } from "../../src/components/research/study/generation-action";

describe("research learning-note preview", () => {
  it("keeps self-test answers separate from question titles and retains page evidence", () => {
    const parts = studyParts(
      "# 自测\n\n### 问题1：研究证据是什么？\n答案：文本分析 [p.2]\n\n### 问题2：有什么边界？\n答案：不支持因果推断 [p.4]\n\n## 我的思考\n继续核对。\n",
    );
    expect(parts).toEqual([
      { type: "markdown", content: "# 自测\n" },
      {
        type: "question",
        question: "研究证据是什么？",
        answer: "文本分析 [p.2]",
      },
      {
        type: "question",
        question: "有什么边界？",
        answer: "不支持因果推断 [p.4]",
      },
      { type: "markdown", content: "## 我的思考\n继续核对。\n" },
    ]);
  });

  it("does not turn headings inside a code example into hidden answers", () => {
    const content =
      "示例格式：\n```md\n### 问题1：这只是语法\n答案：仍是示例。\n```\n\n真实正文。";
    expect(studyParts(content)).toEqual([{ type: "markdown", content }]);
  });

  it("keeps a partial streamed question visible when the answer has not arrived", () => {
    const parts = studyParts("### 问题1：未完成的问题");
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("markdown");
    expect(parts[0].type === "markdown" && parts[0].content).toContain(
      "未完成的问题",
    );
  });

  it("requires source grounding and uses labels only for a known framework prefix", () => {
    expect(studyPrompt("cornell")).toContain("[p.页码]");
    expect(studyPrompt("feynman")).toContain("不可作为论文证据");
    expect(studyPrompt("recall")).toContain("不要在问题标题内泄露答案");
    expect(studyLabel(studyPrompt("recall"))).toBe("自测问答");
    expect(studyLabel("自由提问 [学习笔记:recall]")).toBeNull();
  });

  it("uses plain mode names and local examples without changing historic labels or generation instructions", () => {
    expect(Object.keys(studyFrameworks)).toEqual([
      "cornell",
      "feynman",
      "recall",
    ]);
    const expected = [
      ["cornell", "整理重点", "康奈尔笔记", "整理重点笔记"],
      ["feynman", "通俗讲解", "费曼解释", "生成通俗讲解"],
      ["recall", "自测复习", "自测问答", "生成自测题"],
    ] as const;
    for (const [id, title, label, action] of expected) {
      const entry = studyFrameworks[id];
      expect(entry.title).toBe(title);
      expect(entry.label).toBe(label);
      expect(entry.action).toBe(action);
      expect(entry.scenario).toBeTruthy();
      expect(entry.output).toBeTruthy();
      expect(entry.example).toContain("[p.页码]");
      const prompt = studyPrompt(id);
      expect(prompt).toContain(`[学习笔记:${id}]`);
      expect(prompt).toContain(`请基于当前论文可用原文生成中文${label}。`);
      expect(prompt.endsWith(entry.instruction)).toBe(true);
      expect(prompt).not.toContain(entry.example);
      expect(studyLabel(prompt)).toBe(label);
      expect(studyPurpose(prompt)).toBe(title);
    }
    expect(studyPurpose("自由提问 [学习笔记:recall]")).toBeNull();
    expect(studyPurpose("[学习笔记:unknown]")).toBeNull();
  });

  it("generates only on explicit submission and blocks synchronous duplicates or an active run", async () => {
    const generate = createStudyGenerationAction();
    const submitted: string[] = [];
    const submit = (prompt: string) => submitted.push(prompt);
    expect(submitted).toEqual([]);
    expect(generate("cornell", true, submit)).toBe(false);
    expect(submitted).toEqual([]);
    expect(generate("feynman", false, submit)).toBe(true);
    expect(generate("recall", false, submit)).toBe(false);
    expect(submitted).toEqual([studyPrompt("feynman")]);
    await Promise.resolve();
    expect(generate("recall", false, submit)).toBe(true);
    expect(submitted).toEqual([studyPrompt("feynman"), studyPrompt("recall")]);
  });

  it("allows a retry after a failed synchronous submission", async () => {
    const generate = createStudyGenerationAction();
    expect(() =>
      generate("cornell", false, () => {
        throw new Error("not ready");
      }),
    ).toThrow("not ready");
    await Promise.resolve();
    const submitted: string[] = [];
    expect(generate("cornell", false, (prompt) => submitted.push(prompt))).toBe(
      true,
    );
    expect(submitted).toEqual([studyPrompt("cornell")]);
  });
});
