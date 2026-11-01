import type { ResearchPaper } from "@/lib/research/types";
import styles from "./print.module.css";

/** Print the current reading record without pretending virtualized PDF pages
 * are the complete paper. The original PDF remains the full-text print path. */
export function PrintPaperHeading({ paper }: { paper?: ResearchPaper }) {
  if (!paper) return null;
  return (
    <section className={styles.printHeading} aria-label="打印论文信息">
      <p>教研阅记 · 阅读记录</p>
      <h1>{paper.title}</h1>
      <p>
        {paper.authors}
        {paper.year ? " · " + paper.year : ""} · {paper.pageCount} 页
      </p>
      <p>
        下方为当前阅读工作区的文字记录。打印论文全文及已保存批注，请先
        <a href={"/api/research/papers/" + paper.id + "/pdf"}>打开原 PDF</a>
        ，再使用 PDF 阅读器的打印功能。
      </p>
    </section>
  );
}
