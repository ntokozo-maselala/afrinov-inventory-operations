import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';

export function NotFound() {
  return (
    <div>
      <PageHeader title="Not found" breadcrumb={[{ label: 'Afrinov IMS', to: '/' }, { label: 'Not found' }]} />
      <div className="surface-card">
        <EmptyState
          title="We can't find that page"
          description="The link may be broken or the page may have been moved."
          action={<Link to="/"><Button variant="primary">Back to dashboard</Button></Link>}
        />
      </div>
    </div>
  );
}