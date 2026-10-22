import { Link } from 'react-router-dom';

import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-6 py-16">
      <EmptyState
        className="w-full bg-surface"
        title="This page does not exist"
        description="The link may be old, or the page may not be part of this build."
        action={
          <Link to="/chat">
            <Button>Back to chat</Button>
          </Link>
        }
      />
    </div>
  );
}
