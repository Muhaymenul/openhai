import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface SyntaxNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SyntaxNode[];
}
type ProtectedRange = { start: number; end: number; type: string };

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const protectedTypes = new Set([
  "code",
  "inlineCode",
  "html",
  "link",
  "image",
  "definition",
  "linkReference",
  "imageReference",
  "math",
  "inlineMath",
]);

function protectedRanges(content: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  function visit(node: SyntaxNode) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      protectedTypes.has(node.type) &&
      start !== undefined &&
      end !== undefined
    ) {
      ranges.push({ start, end, type: node.type });
      return;
    }
    node.children?.forEach(visit);
  }
  visit(parser.parse(content));
  return ranges.sort((a, b) => a.start - b.start);
}

/** Escape only clear runs of prices, including the false math span between two prices. */
function preservePrices(content: string): string {
  const priceRun =
    /(?<![\\$])\$\d+(?:,\d{3})*(?:\.\d{1,2})?(?:\s*(?:[,，、/+–—-]|and|or|to|vs\.?|versus|和|与|至|到|及)\s*\$\d+(?:,\d{3})*(?:\.\d{1,2})?)+(?![\d$])/gi;
  if (!priceRun.test(content)) return content;
  const ranges = protectedRanges(content);
  priceRun.lastIndex = 0;
  return content.replace(priceRun, (match, offset: number) => {
    const end = offset + match.length;
    const protectedMatch = ranges.some(
      (range) =>
        range.start < end &&
        range.end > offset &&
        // remark-math can read "$20 与 $30" as one inline formula; it is a price run.
        !(
          range.type === "inlineMath" &&
          range.start >= offset &&
          range.end <= end
        ),
    );
    return protectedMatch ? match : match.replaceAll("$", "\\$");
  });
}

/** Preview-only compatibility: saved notes and exported Markdown keep the original TeX. */
export function normalizeMath(source: string): string {
  if (!/\\[([]|\\begin\{|\$\d/.test(source)) return source;
  const content = preservePrices(source);
  function convert(text: string) {
    return text.replace(
      /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]|(?<!\\)\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered)\}([\s\S]*?)\\end\{\3\}/g,
      (
        match,
        inline: string | undefined,
        display: string | undefined,
        environment: string | undefined,
        _environmentBody: string | undefined,
        offset: number,
      ) => {
        const math = (inline ?? display ?? match).trim();
        if (!math || /(?<!\\)\$/.test(math)) return match;
        // A single-$ micromark span closes at TeX's \$ too. Same-line $$ keeps
        // the expression inline while allowing literal dollar signs in \text.
        if (inline !== undefined)
          return math.includes("\\$") ? `$$${math}$$` : `$${math}$`;
        const before = text.slice(
          text.lastIndexOf("\n", offset - 1) + 1,
          offset,
        );
        const nextLine = text.indexOf("\n", offset + match.length);
        const after = text.slice(
          offset + match.length,
          nextLine < 0 ? text.length : nextLine,
        );
        // A bare environment is promoted only when it occupies its own paragraph.
        if (environment && (before.trim() || after.trim())) return match;
        // Keep equations embedded in list items and quotes in their container.
        if (before || after.trim()) return `$$${math}$$`;
        return `$$\n${math}\n$$`;
      },
    );
  }
  let cursor = 0;
  let result = "";
  for (const { start, end } of protectedRanges(content)) {
    result += convert(content.slice(cursor, start)) + content.slice(start, end);
    cursor = end;
  }
  return result + convert(content.slice(cursor));
}

/** Short reading-pane previews must not cut a formula or code fence in half. */
export function mathAwarePreview(source: string, limit = 550): string {
  const content = normalizeMath(source);
  if (content.length <= limit) return content;
  let end = limit;
  for (const range of protectedRanges(content)) {
    if (range.start < limit && range.end > limit) {
      end = range.start;
      // Keep a reasonably sized opening formula whole; its panel already caps visual height.
      if (end === 0 && range.type === "math" && range.end <= 4000)
        end = range.end;
      break;
    }
  }
  return content.slice(0, end).trimEnd() + "\n\n…";
}
