// What an action page shows, instead of its form, to someone whose role cannot
// do that action: reached by a typed or old link, since the buttons to it are
// hidden. Saves filling in a form the server would refuse.
import { Link } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { Alert } from './Alert';

export function NoAccess({ title, action, section = { label: 'Stock', to: '/stock' } }: {
  /** The page's title, e.g. "Issue stock". */
  title: string;
  /** What the role cannot do, finishing "Your role cannot …", e.g. "issue stock". */
  action: string;
  /** Where the page sits and where "Back to" goes: Stock unless given. */
  section?: { label: string; to: string };
}) {
  return (
    <div>
      <PageHeader title={title} breadcrumb={[section, { label: title }]} />
      <Alert tone="info" title={`Your role cannot ${action}`} className="max-w-2xl">
        Ask a store controller or an administrator to do it, or to change your role. <Link to={section.to} className="btn-link">Back to {section.label.toLowerCase()}</Link>
      </Alert>
    </div>
  );
}
