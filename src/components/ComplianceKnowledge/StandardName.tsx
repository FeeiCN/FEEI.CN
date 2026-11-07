import type {KnowledgeNode} from './model';
import {standardDisplayName} from './standardRelationsModel';
import styles from './standardRelations.module.css';

export default function StandardName({node, quotes = []}: {node: KnowledgeNode; quotes?: string[]}) {
  const {identifier, title} = standardDisplayName(node, quotes);
  return <><span className={styles.identifier}>{identifier}</span>{title && <span className={styles.standardTitle}>{title}</span>}</>;
}
