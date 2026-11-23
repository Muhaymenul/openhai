export type NoteMathKind = "inline" | "display" | "aligned";

const examples: Record<NoteMathKind, string> = {
  inline: "x^2 + y^2 = z^2",
  display: String.raw`\bar{x} = \frac{1}{n}\sum_{i=1}^{n}x_i`,
  aligned: String.raw`\begin{aligned}
y &= ax + b \\
z &= cx + d
\end{aligned}`,
};

function selectedExpression(selected: string): string {
  const delimiters = [
    ["$$", "$$"],
    ["$", "$"],
    [String.raw`\(`, String.raw`\)`],
    [String.raw`\[`, String.raw`\]`],
  ];
  for (const [opening, closing] of delimiters) {
    if (
      selected.startsWith(opening) &&
      selected.endsWith(closing) &&
      selected.length > opening.length + closing.length
    )
      return selected.slice(opening.length, -closing.length).trim();
  }
  return selected;
}

/** Insert source text at the editor selection; no rendered HTML enters a note. */
export function insertNoteMath(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: NoteMathKind,
) {
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const selected = value.slice(start, end);
  let expression = selected ? selectedExpression(selected) : examples[kind];
  if (selected && kind === "aligned" && !/\\begin\{/.test(expression))
    expression = `\\begin{aligned}\n${expression}\n\\end{aligned}`;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix =
    kind === "inline"
      ? "$"
      : `${before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""}$$\n`;
  const suffix =
    kind === "inline"
      ? "$"
      : `\n$$${after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : ""}`;
  return {
    value: before + prefix + expression + suffix + after,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + expression.length,
  };
}
