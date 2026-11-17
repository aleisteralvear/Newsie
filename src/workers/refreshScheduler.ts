export interface NetworkCondition {
  online: boolean;
  isMeteredOrCellular: boolean;
}

export function shouldRunScheduledSync(
  intervalMinutes: number,
  wifiOnlyUpdates: boolean,
  network: NetworkCondition,
  isRefreshing: boolean,
): { allowed: boolean; reason?: string } {
  if (intervalMinutes <= 0) {
    return { allowed: false, reason: 'Manual refresh mode active.' };
  }
  if (isRefreshing) {
    return { allowed: false, reason: 'Refresh already in progress.' };
  }
  if (!network.online) {
    return { allowed: false, reason: 'Device is offline.' };
  }
  if (wifiOnlyUpdates && network.isMeteredOrCellular) {
    return {
      allowed: false,
      reason: 'Deferred because Wi-Fi-only updates are enabled.',
    };
  }
  return { allowed: true };
}

export function readBrowserNetworkCondition(): NetworkCondition {
  if (typeof navigator === 'undefined') {
    return { online: true, isMeteredOrCellular: false };
  }
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; type?: string };
  }).connection;
  const isMeteredOrCellular = Boolean(
    conn?.saveData || conn?.type === 'cellular',
  );
  return {
    online: navigator.onLine !== false,
    isMeteredOrCellular,
  };
}
