import { Badge } from '../ui/badge';

export function EnvironmentBadge() {
  const isDev = import.meta.env.DEV;
  const label = isDev ? 'Local dev' : 'Production build';

  return (
    <span title={`Environment derived from the Vite build mode: ${import.meta.env.MODE}`}>
      <Badge variant={isDev ? 'info' : 'warning'}>{label}</Badge>
    </span>
  );
}
