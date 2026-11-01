import section0 from "./section0.module.css";
import section1 from "./section1.module.css";
import section2 from "./section2.module.css";
import section3 from "./section3.module.css";
import design from "./design.module.css";
import polish from "./polish.module.css";
import shell from "./shell.module.css";
import compactReader from "./compact-reader.module.css";
import assistant from "./assistant.module.css";
import taste from "./taste.module.css";

// Combine module classes so responsive and shared rules retain their scope.
const styles: Record<string, string> = {};
for (const section of [
  section0,
  section1,
  section2,
  section3,
  design,
  polish,
  shell,
  compactReader,
  taste,
  assistant,
]) {
  for (const [name, className] of Object.entries(section)) {
    styles[name] = styles[name] ? styles[name] + " " + className : className;
  }
}
export default styles;
