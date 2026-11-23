import { useEffect, useState } from 'react';
import { clearSession, getConsumerSession, getSession } from '../services/api.js';

export function useConsumerSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cached = getSession();
    if (!cached) {
      setReady(true);
      return;
    }
    getConsumerSession()
      .then(result => setSession(result))
      .catch(() => {
        clearSession();
        setSession(null);
      })
      .finally(() => setReady(true));
  }, []);

  return { session, ready };
}
