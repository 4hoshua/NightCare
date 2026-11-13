import { useEffect, useState } from "react";

export function useAnimatedPresence(visible: boolean, exitMs: number) {
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) {
      setPresent(true);
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPresent(false);
      return;
    }
    const timer = setTimeout(() => setPresent(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, exitMs]);
  return visible || present;
}
