import React, {type CSSProperties, type ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type Tone = 'health' | 'career' | 'wealth' | 'life';
type Emphasis = 'featured' | 'recent' | 'standard' | 'legacy' | 'goal';

type AnnualReviewTableProps = {
  children: ReactNode;
};

type AnnualReviewRowProps = {
  age: string;
  children: ReactNode;
  emphasis?: Emphasis;
  href?: string;
  year: string;
};

type AnnualReviewCellProps = {
  children?: ReactNode;
  empty?: boolean;
  metric?: ReactNode;
  tone: Tone;
};

type AnnualReviewItemsProps = {
  children: ReactNode;
};

type AnnualReviewItemProps = {
  children: ReactNode;
  subtle?: ReactNode;
};

type AnnualReviewFactsProps = {
  children: ReactNode;
};

type AnnualReviewFactProps = {
  children: ReactNode;
  label: ReactNode;
};

type AnnualReviewTagListProps = {
  children: ReactNode;
};

type AnnualReviewTagProps = {
  achieved?: boolean;
  children: ReactNode;
  progress?: number;
  subtle?: boolean;
};

type AnnualReviewBridgeRowProps = {
  age?: string;
  children?: ReactNode;
  title?: ReactNode;
  year: string;
};

const toneClassNameMap: Record<Tone, string> = {
  health: styles.cellHealth,
  career: styles.cellCareer,
  wealth: styles.cellWealth,
  life: styles.cellLife,
};

const emphasisClassNameMap: Record<Emphasis, string> = {
  featured: styles.rowFeatured,
  recent: styles.rowRecent,
  standard: styles.rowStandard,
  legacy: styles.rowLegacy,
  goal: styles.rowGoal,
};

export function AnnualReviewTable({children}: AnnualReviewTableProps): ReactNode {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">
              <span className={styles.heading}>年份</span>
            </th>
            <th scope="col">
              <span className={styles.heading}>健康幸福</span>
            </th>
            <th scope="col">
              <span className={styles.heading}>事业有成</span>
            </th>
            <th scope="col">
              <span className={styles.heading}>财务自由</span>
            </th>
            <th scope="col">
              <span className={styles.heading}>人生丰富</span>
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AnnualReviewRow({
  age,
  children,
  emphasis = 'standard',
  href,
  year,
}: AnnualReviewRowProps): ReactNode {
  const content = (
    <>
      <span className={styles.year}>{year}</span>
      <span className={styles.age}>{age}</span>
    </>
  );

  return (
    <tr className={emphasisClassNameMap[emphasis]}>
      <th scope="row" className={styles.yearCell}>
        {href ? (
          <a className={styles.yearLink} href={href}>
            {content}
          </a>
        ) : (
          <span className={clsx(styles.yearLink, styles.yearLinkStatic)}>{content}</span>
        )}
      </th>
      {children}
    </tr>
  );
}

export function AnnualReviewBridgeRow({
  age,
  children,
  title = '过渡期',
  year,
}: AnnualReviewBridgeRowProps): ReactNode {
  return (
    <tr className={styles.bridgeRow}>
      <th scope="row" className={clsx(styles.yearCell, styles.bridgeYearCell)}>
        <span className={clsx(styles.yearLink, styles.yearLinkStatic)}>
          <span className={styles.year}>{year}</span>
          {age ? <span className={clsx(styles.age, styles.bridgeAge)}>{age}</span> : null}
        </span>
      </th>
      <td colSpan={4} className={styles.bridgeCell}>
        <div className={styles.bridgeContent}>
          <span className={styles.bridgeTitle}>{title}</span>
          {children ? <div className={styles.bridgeBody}>{children}</div> : null}
        </div>
      </td>
    </tr>
  );
}

export function AnnualReviewCell({
  children,
  empty = false,
  metric,
  tone,
}: AnnualReviewCellProps): ReactNode {
  return (
    <td className={clsx(styles.cell, toneClassNameMap[tone])}>
      {metric ? <div className={styles.metric}>{metric}</div> : null}
      {empty ? <span className={styles.empty}>—</span> : null}
      {!empty && children ? <div className={styles.content}>{children}</div> : null}
    </td>
  );
}

export function AnnualReviewItems({
  children,
}: AnnualReviewItemsProps): ReactNode {
  return <div className={styles.items}>{children}</div>;
}

export function AnnualReviewItem({
  children,
  subtle,
}: AnnualReviewItemProps): ReactNode {
  return (
    <div className={styles.item}>
      <div className={styles.itemMain}>{children}</div>
      {subtle ? <div className={styles.itemSubtle}>{subtle}</div> : null}
    </div>
  );
}

export function AnnualReviewFacts({
  children,
}: AnnualReviewFactsProps): ReactNode {
  return <div className={styles.facts}>{children}</div>;
}

export function AnnualReviewFact({
  children,
  label,
}: AnnualReviewFactProps): ReactNode {
  return (
    <div className={styles.fact}>
      <div className={styles.factLabel}>{label}</div>
      <div className={styles.factBody}>{children}</div>
    </div>
  );
}

export function AnnualReviewTagList({
  children,
}: AnnualReviewTagListProps): ReactNode {
  return <div className={styles.tagList}>{children}</div>;
}

export function AnnualReviewTag({
  achieved = false,
  children,
  progress,
  subtle = false,
}: AnnualReviewTagProps): ReactNode {
  const normalizedProgress = achieved
    ? 100
    : typeof progress === 'number'
      ? Math.max(0, Math.min(Math.round(progress), 99))
      : null;

  const isPending = normalizedProgress === 0;
  const isProgress = normalizedProgress !== null && normalizedProgress > 0 && normalizedProgress < 100;

  const style = normalizedProgress !== null
    ? ({'--tag-progress': `${normalizedProgress}%`} as CSSProperties)
    : undefined;

  return (
    <span
      className={clsx(
        styles.tag,
        subtle && styles.tagSubtle,
        achieved && styles.tagAchieved,
        isPending && styles.tagPending,
        isProgress && styles.tagProgress,
      )}
      style={style}
    >
      <span className={styles.tagText}>{children}</span>
    </span>
  );
}

export default AnnualReviewTable;
