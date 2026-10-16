import { useEffect, useState } from 'react';
import { serverNow } from '../store/store';

/** Whole seconds left until a server deadline (epoch ms); 0 when there is none. Ticks every 250 ms. */
export function useCountdown(deadline: number | null): number {
  const compute = () =>
    deadline === null ? 0 : Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    if (deadline === null) return undefined;
    const id = setInterval(() => setLeft(compute()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  return left;
}
