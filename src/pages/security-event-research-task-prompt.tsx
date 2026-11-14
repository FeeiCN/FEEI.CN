import type {ReactNode} from 'react';
import {Redirect} from '@docusaurus/router';

export default function SecurityEventResearchTaskRedirect(): ReactNode {
  return <Redirect to="/security-incident-analysis-principles" />;
}
