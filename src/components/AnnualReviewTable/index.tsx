import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

type Tone = 'health' | 'career' | 'wealth' | 'life';
type Emphasis = 'featured' | 'recent' | 'standard' | 'legacy';

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
  children: ReactNode;
  subtle?: boolean;
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
  children,
  subtle = false,
}: AnnualReviewTagProps): ReactNode {
  return (
    <span className={clsx(styles.tag, subtle && styles.tagSubtle)}>
      {children}
    </span>
  );
}

export default AnnualReviewTable;
