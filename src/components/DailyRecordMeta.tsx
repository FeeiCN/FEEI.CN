import React from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import styles from './DailyRecordMeta.module.css';

function splitLocations(value: string): string[] {
  return [...new Set(
    value
      .split(/\s*→\s*/)
      .map((part) => part.trim())
      .filter(Boolean),
  )].slice(0, 4);
}

export default function DailyRecordMeta() {
  const {frontMatter} = useDoc();
  const values = frontMatter as Record<string, unknown>;
  const slug = typeof values.slug === 'string' ? values.slug : '';
  if (!/^\/\d{4}-\d{2}-\d{2}\/?$/.test(slug)) return null;

  const location = typeof values.location === 'string' ? values.location.trim() : '';
  const locations = splitLocations(location);
  if (locations.length === 0) return null;

  return (
    <div className={styles.dailyMeta} aria-label="当天地点">
      <span className={styles.routeLine}>
        {locations.map((place, index) => (
          <React.Fragment key={place}>
            {index > 0 && <span className={styles.routeArrow}>→</span>}
            <span className={styles.routePlace}>{place}</span>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}
