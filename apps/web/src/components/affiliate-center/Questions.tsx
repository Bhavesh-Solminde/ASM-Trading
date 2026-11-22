import type { ReactNode } from "react";
import { Icon } from "@/components/shell/Icon";
import styles from "./center.module.css";

export type Question = { question: string; answer: ReactNode };

export function Questions({ items }: { items: Question[] }) {
  return items.map(({ question, answer }) => (
    <details key={question} className={styles.faqItem}>
      <summary>{question}<Icon name="caret" className="size-4" /></summary>
      <p>{answer}</p>
    </details>
  ));
}
