import { Link } from 'react-router-dom';

import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { FileSearch } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center px-6 py-16 text-center">
      <EmptyState
        className="w-full max-w-md"
        icon={<FileSearch className="size-12 text-action" aria-hidden="true" />}
        title="This page isn't here"
        description="The link may be old, or the page may not be part of this build."
        action={
          <Link to="/chat">
            <Button className="press-scale">Back to chat</Button>
          </Link>
        }
      />
    </div>
  );
}
