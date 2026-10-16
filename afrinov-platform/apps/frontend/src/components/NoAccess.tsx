// What an action page shows, instead of its form, to someone whose role cannot
// do that action: reached by a typed or old link, since the buttons to it are
// hidden. Saves filling in a form the server would refuse.
import { Link } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { Alert } from './Alert';

export function NoAccess({ title, action }: {
  /** The page's title, e.g. "Issue stock". */
  title: string;
  /** What the role cannot do, finishing "Your role cannot …", e.g. "issue stock". */
  action: string;
}) {
  return (
    <div>
      <PageHeader title={title} breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: title }]} />
      <Alert tone="info" title={`Your role cannot ${action}`} className="max-w-2xl">
        Ask a store controller or an administrator to do it, or to change your role. <Link to="/stock" className="btn-link">Back to stock</Link>
      </Alert>
    </div>
  );
}
