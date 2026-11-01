"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { studyFrameworks, type StudyFramework } from "./frameworks";
import { createStudyGenerationAction } from "./generation-action";
import styles from "./study-actions.module.css";
import { StudyMarkdown } from "./StudyMarkdown";

export function StudyActions({
  active,
  onGenerate,
}: {
  active: boolean;
  onGenerate(prompt: string): void;
}) {
  const groupId = useId();
  const [framework, setFramework] = useState<StudyFramework>("cornell");
  const [generate] = useState(createStudyGenerationAction);
  const current = studyFrameworks[framework];
  return (
    <section
      className={styles.actions}
      data-study-actions
      aria-label="学习方式"
    >
      <fieldset className={styles.modes} disabled={active}>
        <legend className={styles.srOnly}>学习笔记方式</legend>
        {Object.entries(studyFrameworks).map(([value, entry]) => (
          <label className={styles.mode} key={value} title={entry.label}>
            <input
              type="radio"
              name={groupId}
              value={value}
              checked={framework === value}
              onChange={() => setFramework(value as StudyFramework)}
              aria-describedby={`${groupId}-preview`}
            />
            <span>{entry.title}</span>
          </label>
        ))}
      </fieldset>
      <div
        className={styles.preview}
        id={`${groupId}-preview`}
        aria-live="polite"
      >
        <p>{current.scenario}</p>
        <p>
          <span>将生成：</span>
          {current.output}
        </p>
      </div>
      <div className={styles.footer}>
        <details className={styles.examples}>
          <summary>
            查看示例与区别 <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className={styles.explanation}>
            <strong>三种方式有什么区别？</strong>
            <dl>
              {Object.entries(studyFrameworks).map(([value, entry]) => (
                <div key={value}>
                  <dt>
                    {entry.title}
                    <small>{entry.label}</small>
                  </dt>
                  <dd>{entry.scenario}</dd>
                </div>
              ))}
            </dl>
            <p>{current.title} · 格式示例</p>
            <div className={styles.examplePreview}>
              <StudyMarkdown content={current.example} highlightCode={false} />
            </div>
          </div>
        </details>
        <button
          className={styles.generate}
          type="button"
          disabled={active}
          onClick={() => generate(framework, active, onGenerate)}
          data-study-generate={framework}
        >
          <Sparkles size={13} aria-hidden="true" />
          {active ? "生成中…" : current.action}
        </button>
      </div>
    </section>
  );
}
