"use client";

import { useEffect, useRef } from "react";

export type KeysAZERTY = {
  z: boolean;
  q: boolean;
  s: boolean;
  d: boolean;
  shift: boolean;
};

export function useKeysAZERTY() {
  const keys = useRef<KeysAZERTY>({ z: false, q: false, s: false, d: false, shift: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = true; 
      if (e.code === "KeyA") keys.current.q = true; 
      if (e.code === "KeyS") keys.current.s = true;
      if (e.code === "KeyD") keys.current.d = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.current.shift = true;
    };

    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = false;
      if (e.code === "KeyA") keys.current.q = false;
      if (e.code === "KeyS") keys.current.s = false;
      if (e.code === "KeyD") keys.current.d = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.current.shift = false;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return keys;
}
