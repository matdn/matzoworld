"use client";

import { useEffect, useState } from "react";
import { AnimationClip } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type Options = {
  name?: string;
  transform?: (clip: AnimationClip) => AnimationClip;
};

export function useFBXClip(url: string, options?: Options) {
  const [clip, setClip] = useState<AnimationClip | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new FBXLoader();

    loader.load(url, (fbx) => {
      if (cancelled) return;
      const raw = fbx.animations?.[0];
      if (!raw) return;

      const next = options?.transform ? options.transform(raw) : raw;
      if (options?.name) next.name = options.name;

      setClip(next);
    });

    return () => {
      cancelled = true;
    };
  }, [url, options?.name, options?.transform]);

  return clip;
}
