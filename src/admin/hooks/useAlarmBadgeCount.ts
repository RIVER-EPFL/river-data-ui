import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRiverDataProvider } from '../useRiverDataProvider';
import type { ActiveAlarm } from '../dataProvider';

const ACK_STORAGE_KEY = 'river-data-alarm-ack';
const REFRESH_INTERVAL = 60_000;

interface AckEntry {
  key: string;
  until: number;
}

function loadAcks(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY);
    if (!raw) return new Set();
    const entries: AckEntry[] = JSON.parse(raw);
    const now = Date.now();
    return new Set(
      entries.filter((e) => e.until === 0 || e.until > now).map((e) => e.key),
    );
  } catch {
    return new Set();
  }
}

function alarmKey(alarm: ActiveAlarm): string {
  return `${alarm.site_id}:${alarm.parameter_id}`;
}

export function useAlarmBadgeCount(): number {
  const dataProvider = useRiverDataProvider();
  const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
  const [ackKeys, setAckKeys] = useState<Set<string>>(loadAcks);

  const fetchAlarms = useCallback(async () => {
    try {
      const { data } = await dataProvider.getActiveAlarms();
      setAlarms(data.alarms);
    } catch {
      // silent
    }
  }, [dataProvider]);

  useEffect(() => {
    fetchAlarms();
    const interval = setInterval(() => {
      fetchAlarms();
      setAckKeys(loadAcks());
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchAlarms]);

  useEffect(() => {
    const refresh = () => setAckKeys(loadAcks());
    // Cross-tab localStorage changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACK_STORAGE_KEY) refresh();
    };
    // Same-tab ack changes (dispatched by AlarmNotificationPanel)
    window.addEventListener('storage', onStorage);
    window.addEventListener('alarm-ack-changed', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('alarm-ack-changed', refresh);
    };
  }, []);

  return useMemo(
    () => alarms.filter((a) => !ackKeys.has(alarmKey(a))).length,
    [alarms, ackKeys],
  );
}
