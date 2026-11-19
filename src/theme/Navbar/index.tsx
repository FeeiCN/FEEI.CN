import type {ReactNode} from 'react';
import OriginalNavbar from '@theme-original/Navbar';
import styles from './styles.module.css';

export default function Navbar(): ReactNode {
  return (
    <div className={styles.frame}>
      <OriginalNavbar />
    </div>
  );
}
