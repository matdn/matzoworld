"use client";

import React, { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Quadrant = "NE" | "NW" | "SE" | "SW";

type Props = {
  count?: number;
  mapSize?: number;
  quadrant?: Quadrant;
  spacing?: number;
  cubeSize?: number;
  density?: number;
  jitter?: number;
  seed?: number;
};

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function quadrantBounds(mapSize: number, quadrant: Quadrant) {
  const half = mapSize / 2;

  const xMin = quadrant === "NW" || quadrant === "SW" ? -half : 0;
  const xMax = quadrant === "NW" || quadrant === "SW" ? 0 : half;

  const zMin = quadrant === "SW" || quadrant === "SE" ? -half : 0;
  const zMax = quadrant === "SW" || quadrant === "SE" ? 0 : half;

  return { xMin, xMax, zMin, zMax };
}

export default function InstancedCubes({
  count = 180,
  mapSize = 50,
  quadrant = "NE",
  spacing = 2,
  cubeSize = 1,
  density = 0.7,
  jitter = 0.85,
  seed = 1337,
}: Props) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const transforms = useMemo(() => {
    const bounds = quadrantBounds(mapSize, quadrant);
    const rng = makeRng(seed);

    const result: Array<{ p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }> = [];

    const width = Math.abs(bounds.xMax - bounds.xMin);
    const depth = Math.abs(bounds.zMax - bounds.zMin);

    const cols = Math.max(1, Math.floor(width / spacing));
    const rows = Math.max(1, Math.floor(depth / spacing));
    const maxCells = cols * rows;
    const n = Math.min(count, maxCells);

    const x0 = bounds.xMin + spacing * 0.5;
    const z0 = bounds.zMin + spacing * 0.5;
    const y = cubeSize * 0.5; // posé au sol

    const clampedDensity = Math.max(0, Math.min(1, density));
    const clampedJitter = Math.max(0, Math.min(1, jitter));
    const safeJitterMax = Math.max(0, (spacing - cubeSize) * 0.5) * clampedJitter;

    for (let i = 0; i < maxCells && result.length < n; i += 1) {
      if (rng() > clampedDensity) continue;

      const cx = i % cols;
      const cz = Math.floor(i / cols);

      const x = x0 + cx * spacing + (rng() * 2 - 1) * safeJitterMax;
      const z = z0 + cz * spacing + (rng() * 2 - 1) * safeJitterMax;

      result.push({
        p: new THREE.Vector3(x, y, z),
        r: new THREE.Euler(0, rng() * Math.PI * 2, 0),
        s: new THREE.Vector3(cubeSize, cubeSize, cubeSize),
      });
    }

    return result;
  }, [count, mapSize, quadrant, spacing, cubeSize, density, jitter, seed]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < transforms.length; i += 1) {
      const t = transforms[i];
      dummy.position.copy(t.p);
      dummy.rotation.copy(t.r);
      dummy.scale.copy(t.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, transforms.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#2a2a2a" roughness={0.9} metalness={0.05} />
    </instancedMesh>
  );
}
