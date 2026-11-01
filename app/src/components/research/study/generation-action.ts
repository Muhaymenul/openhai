import { studyPrompt, type StudyFramework } from "./frameworks";

/** Bridge the synchronous click to the host's running state without duplicate requests. */
export function createStudyGenerationAction() {
  let pending = false;
  return (
    framework: StudyFramework,
    active: boolean,
    onGenerate: (prompt: string) => void,
  ): boolean => {
    if (active || pending) return false;
    pending = true;
    try {
      onGenerate(studyPrompt(framework));
      return true;
    } finally {
      // The host owns the async run; a rejected/no-op start must remain retryable.
      queueMicrotask(() => {
        pending = false;
      });
    }
  };
}
