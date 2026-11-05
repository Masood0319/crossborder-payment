import { useEffect, useState } from 'react';
import { getSession } from '../services/api.js';

export function useConsumerSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(getSession());
    setReady(true);
  }, []);

  return { session, ready };
}
