import React, {useId} from 'react';
import styles from './styles.module.css';

interface Props {
  title: string;
  author?: string;
  children: React.ReactNode;
}

export default function VerticalPoem({title, author, children}: Props) {
  const id = useId();

  return (
    <section className={styles.poem}>
      <div role="region" aria-labelledby={`${id}-title`} tabIndex={0} className={styles.viewport}>
        <div className={styles.content}>
          <header className={styles.header}>
            <h1 id={`${id}-title`} className={styles.title}>{title}</h1>
            {author && <p className={styles.author}>{author}</p>}
          </header>
          <div className={styles.body}>{children}</div>
        </div>
      </div>
    </section>
  );
}
