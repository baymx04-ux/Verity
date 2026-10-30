import { useEffect, useState } from 'react';

import { WifiOff } from 'lucide-react';

export function OnlineStatusBanner() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 bg-warning text-warning-text text-xs font-medium"
    >
      <WifiOff className="size-4" aria-hidden="true" />
      <span>You appear to be offline. Some actions may not work until you reconnect.</span>
    </div>
  );
}
