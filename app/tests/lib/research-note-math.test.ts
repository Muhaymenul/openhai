import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/chat/Markdown";
import { normalizeMath, mathAwarePreview } from "@/lib/chat/normalize-math";
import { insertNoteMath } from "@/components/research/learning/note-math";

function render(content: string) {
  return renderToStaticMarkup(createElement(Markdown, { content }));
}

describe("research note TeX preview", () => {
  it.each([
    String.raw`行内 $x_i^2$ 与 \(\frac{a}{b}\)。`,
    String.raw`$$
\sum_{i=1}^{n} x_i
$$`,
    String.raw`\[
\begin{aligned}
y &= ax + b \\
z &= cx + d
\end{aligned}
\]`,
    String.raw`\begin{align*}
y &= ax + b \\
z &= cx + d
\end{align*}`,
    String.raw`\begin{equation}
E = mc^2
\end{equation}`,
    String.raw`\[\text{平均值}=\frac{1}{n}\sum_{i=1}^{n}x_i\]`,
  ])("renders common delimiters and standalone environments: %s", (content) => {
    const html = render(content);
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(html).not.toContain("katex-error");
  });

  it("keeps prices literal while retaining valid numeric and variable formulae", () => {
    const content =
      "预算 $20 与 $30。公式 $5x$ 和 $2 + 2$，独立公式 $$5x + 2$$。";
    const html = render(content);
    expect(html).toContain("预算 $20 与 $30。");
    expect(html.match(/class="katex"/g)).toHaveLength(3);
    expect(normalizeMath("$5x$ 和 $2 + 2$\n\n$$\n5x\n$$")).toBe(
      "$5x$ 和 $2 + 2$\n\n$$\n5x\n$$",
    );
  });

  it("preserves code, links, escaped dollars and existing math without rewrapping", () => {
    const untouched = [
      String.raw`\$20 与 \$30。`,
      String.raw`\(\text{cost \$20}\)`,
      "`\\begin{align}x\\end{align}`",
      "```tex\n\\begin{align}\nx&=1\\\\\ny&=2\n\\end{align}\n```",
      "`$20 与 $30`",
      String.raw`[金额 $20 与 $30](https://example.com/math)`,
      String.raw`$$\text{cost \$20 and \$30}$$`,
    ].join("\n\n");
    expect(normalizeMath(untouched)).toBe(
      untouched.replace(
        String.raw`\(\text{cost \$20}\)`,
        () => String.raw`$$\text{cost \$20}$$`,
      ),
    );
    expect(render(untouched)).not.toContain("katex-error");
    expect(render(untouched)).toContain("<mtext>cost\u00a0$20</mtext>");
  });

  it("leaves unmatched and embedded bare environments for the author to edit", () => {
    const source = String.raw`原样 \(x，内嵌 \begin{align}y&=1\end{align}。`;
    expect(normalizeMath(source)).toBe(source);
  });

  it("keeps dangerous TeX URL and HTML commands untrusted", () => {
    const html = render(
      String.raw`$\href{javascript:alert(1)}{x}\htmlClass{unexpected-class}{y}$`,
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('class="unexpected-class"');
  });

  it("does not truncate a display equation or code fence inside reading-pane summaries", () => {
    const equation = "$$\n" + "a + ".repeat(150) + "b = c\n$$";
    const preview = mathAwarePreview(equation + "\n\n后文".repeat(100));
    expect(preview).toContain(equation);
    expect(render(preview)).not.toContain("katex-error");
    const code = "简介\n\n```tex\n" + "x=".repeat(400) + "\n```";
    expect(mathAwarePreview(code)).toBe("简介\n\n…");
  });
});

describe("formula source insertion", () => {
  it("wraps a selected expression and preserves all surrounding source", () => {
    const value = String.raw`推导 x_i + y_i。代码 \(literal\)`;
    const start = value.indexOf("x_i");
    const end = value.indexOf("。");
    const result = insertNoteMath(value, start, end, "inline");
    expect(result.value).toBe(String.raw`推导 $x_i + y_i$。代码 \(literal\)`);
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "x_i + y_i",
    );
  });

  it("inserts an editable display example at the caret without losing the suffix", () => {
    const result = insertNoteMath("前文后文", 2, 2, "display");
    expect(result.value).toMatch(/^前文\n\n\$\$\n/);
    expect(result.value).toMatch(/\n\$\$\n\n后文$/);
    expect(
      result.value.slice(result.selectionStart, result.selectionEnd),
    ).toContain(String.raw`\frac{1}{n}`);
    expect(render(result.value)).not.toContain("katex-error");
  });

  it("offers a multi-line aligned template that renders directly", () => {
    const result = insertNoteMath("", 0, 0, "aligned");
    expect(result.value).toContain(String.raw`\begin{aligned}`);
    expect(result.value).toContain(String.raw`\\`);
    expect(render(result.value)).toContain('class="katex-display"');
    expect(render(result.value)).not.toContain("katex-error");
  });

  it("converts a selected delimited formula without nesting its delimiters", () => {
    const source = String.raw`前文 \(x_i + y_i\) 后文`;
    const start = source.indexOf(String.raw`\(`);
    const end = source.indexOf(String.raw`\)`) + 2;
    const result = insertNoteMath(source, start, end, "display");
    expect(result.value).toContain("$$\nx_i + y_i\n$$");
    expect(result.value).toMatch(/^前文 /);
    expect(result.value).toMatch(/ 后文$/);
    expect(render(result.value)).not.toContain("katex-error");
  });

  it("wraps selected alignment source while keeping the entered TeX rows", () => {
    const source = String.raw`y &= ax + b \\
z &= cx + d`;
    const result = insertNoteMath(source, 0, source.length, "aligned");
    expect(result.value).toContain("\\begin{aligned}\n" + source);
    expect(render(result.value)).not.toContain("katex-error");
  });
});
