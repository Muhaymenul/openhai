import { Markdown } from "@/components/chat/Markdown";
import styles from "../styles";
import { studyParts } from "./frameworks";
import { normalizeWorkspaceCitationHref } from "./workspace-links";

export function StudyMarkdown({
  content,
  highlightCode = true,
}: {
  content: string;
  highlightCode?: boolean;
}) {
  return (
    <div className={styles.studyContent}>
      {studyParts(content).map((part, index) =>
        part.type === "question" ? (
          <details className={styles.recallCard} key={index}>
            <summary>
              <span>{part.question}</span>
              <small>查看答案</small>
            </summary>
            <div>
              <Markdown
                content={part.answer}
                highlightCode={highlightCode}
                resolveLinkHref={normalizeWorkspaceCitationHref}
              />
            </div>
          </details>
        ) : (
          <Markdown
            key={index}
            content={part.content}
            highlightCode={highlightCode}
            resolveLinkHref={normalizeWorkspaceCitationHref}
          />
        ),
      )}
    </div>
  );
}
