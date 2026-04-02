'use client';

import { useEffect, useState } from 'react';

function resolveInitialValue(initialValue) {
  return typeof initialValue === 'function' ? initialValue() : initialValue;
}

function readStoredValue(key) {
  if (typeof window === 'undefined') return undefined;

  const rawValue = window.localStorage.getItem(key);
  if (rawValue === null) return undefined;

  try {
    return JSON.parse(rawValue);
  } catch {
    return undefined;
  }
}

export function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => resolveInitialValue(initialValue));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedValue = readStoredValue(key);
    if (storedValue !== undefined) {
      setState(storedValue);
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [hydrated, key, state]);

  return [state, setState, hydrated];
}
