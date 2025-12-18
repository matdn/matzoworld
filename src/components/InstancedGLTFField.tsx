"use client";

import React, { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

type Quadrant = "NE" | "NW" | "SE" | "SW";

type Props = {
  url: string;
  count?: number;
  mapSize?: number;
  quadrant?: Quadrant;
  spacing?: number;
  density?: number;
  jitter?: number;
  seed?: number;
  scale?: number;
  scaleJitter?: number;
  drawDistance?: number;
  playerPositionRef?: React.RefObject<THREE.Vector3>;
  fadeRadius?: number;
  fadedOpacity?: number;
  hideNearRadius?: number;
  nearFadeWidth?: number;
  clearCenterX?: number;
  clearCenterZ?: number;
  clearRadius?: number;
};

function quadrantBounds(mapSize: number, quadrant: Quadrant) {
  const half = mapSize / 2;

  const xMin = quadrant === "NW" || quadrant === "SW" ? -half : 0;
  const xMax = quadrant === "NW" || quadrant === "SW" ? 0 : half;

  const zMin = quadrant === "SW" || quadrant === "SE" ? -half : 0;
  const zMax = quadrant === "SW" || quadrant === "SE" ? 0 : half;

  return { xMin, xMax, zMin, zMax };
}

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type InstanceTransform = {
  x: number;
  y: number;
  z: number;
  rotY: number;
  s: number;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export default function InstancedGLTFField({
  url,
  count = 220,
  mapSize = 50,
  quadrant = "NE",
  spacing = 2.2,
  density = 0.8,
  jitter = 0.9,
  seed = 42,
  scale = 1,
  scaleJitter = 0.15,
  drawDistance = 14,
  playerPositionRef,
  fadeRadius = 1.6,
  fadedOpacity = 0.18,
  hideNearRadius = 0.9,
  nearFadeWidth = 1.2,
  clearCenterX,
  clearCenterZ,
  clearRadius = 0,
}: Props) {
  const gltf = useGLTF(url);
  const { camera } = useThree();

  const sourceMeshes = useMemo(() => {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    return meshes;
  }, [gltf.scene]);

  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const opacityAttrRefs = useRef<Array<THREE.InstancedBufferAttribute | null>>([]);

  const patchedMaterials = useMemo(() => {
    // Clone and patch materials so we can multiply opacity per instance.
    return sourceMeshes.map((m) => {
      const srcMat = m.material;
      const mat = (Array.isArray(srcMat) ? srcMat[0] : srcMat).clone() as THREE.MeshStandardMaterial;
      // IMPORTANT: Avoid classic transparency sorting artifacts by using a dithered cutout.
      // We keep depthWrite enabled and approximate opacity via discards.
      mat.transparent = true;
      mat.depthWrite = true;
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;"
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;"
          );

        // Dithered fade (alpha-hash style) to avoid sorting problems.
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying float vInstanceOpacity;\n\nfloat mwz_bayer4(vec2 p) {\n  // 4x4 Bayer matrix, returns [0..1)\n  vec2 i = floor(mod(p, 4.0));\n  float x = i.x;\n  float y = i.y;\n  float b = 0.0;\n  if (x < 1.0) {\n    b = (y < 1.0) ? 0.0 : (y < 2.0) ? 12.0 : (y < 3.0) ? 3.0 : 15.0;\n  } else if (x < 2.0) {\n    b = (y < 1.0) ? 8.0 : (y < 2.0) ? 4.0 : (y < 3.0) ? 11.0 : 7.0;\n  } else if (x < 3.0) {\n    b = (y < 1.0) ? 2.0 : (y < 2.0) ? 14.0 : (y < 3.0) ? 1.0 : 13.0;\n  } else {\n    b = (y < 1.0) ? 10.0 : (y < 2.0) ? 6.0 : (y < 3.0) ? 9.0 : 5.0;\n  }\n  return (b + 0.5) / 16.0;\n}\n"
          )
          .replace(
            "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
            "float a = diffuseColor.a * vInstanceOpacity;\nfloat t = mwz_bayer4(gl_FragCoord.xy);\nif (a < t) discard;\ngl_FragColor = vec4( outgoingLight, 1.0 );"
          );
      };
      mat.needsUpdate = true;
      return mat;
    });
  }, [sourceMeshes]);

  const transforms = useMemo(() => {
    const rng = makeRng(seed);
    const bounds = quadrantBounds(mapSize, quadrant);

    const width = Math.abs(bounds.xMax - bounds.xMin);
    const depth = Math.abs(bounds.zMax - bounds.zMin);

    const cols = Math.max(1, Math.floor(width / spacing));
    const rows = Math.max(1, Math.floor(depth / spacing));
    const maxCells = cols * rows;
    const n = Math.min(count, maxCells);

    const x0 = bounds.xMin + spacing * 0.5;
    const z0 = bounds.zMin + spacing * 0.5;

    const d = clamp01(density);
    const j = clamp01(jitter);
    const sj = clamp01(scaleJitter);
    const safeJitterMax = Math.max(0, spacing * 0.5) * j;

    const result: InstanceTransform[] = [];

    const hasClear = typeof clearCenterX === "number" && typeof clearCenterZ === "number" && clearRadius > 0;
    const clearR2 = clearRadius * clearRadius;

    for (let i = 0; i < maxCells && result.length < n; i += 1) {
      if (rng() > d) continue;

      const cx = i % cols;
      const cz = Math.floor(i / cols);

      const x = x0 + cx * spacing + (rng() * 2 - 1) * safeJitterMax;
      const z = z0 + cz * spacing + (rng() * 2 - 1) * safeJitterMax;

      if (hasClear) {
        const ddx = x - (clearCenterX as number);
        const ddz = z - (clearCenterZ as number);
        if (ddx * ddx + ddz * ddz <= clearR2) continue;
      }

      // Random léger, mais jamais en dessous du scale de base
      const s = scale * (1 + rng() * sj);

      result.push({
        x,
        y: 0,
        z,
        rotY: rng() * Math.PI * 2,
        s,
      });
    }

    return result;
  }, [count, mapSize, quadrant, spacing, density, jitter, seed, scale, scaleJitter, clearCenterX, clearCenterZ, clearRadius]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const visibleIdxRef = useRef<number[]>([]);
  const lastCullRef = useRef({ t: 0, visibleCount: -1 });

  useLayoutEffect(() => {
    // init refs length
    meshRefs.current = new Array(sourceMeshes.length).fill(null);
    opacityAttrRefs.current = new Array(sourceMeshes.length).fill(null);
  }, [sourceMeshes.length]);

  useFrame((state) => {
    const now = state.clock.getElapsedTime();
    if (now - lastCullRef.current.t < 1 / 30) return; // ~30 Hz (smoother fade)
    lastCullRef.current.t = now;

    const d2 = drawDistance * drawDistance;

    // Near-camera fade: fully gone at hideR1, fully visible again at hideR0.
    const hideR1 = Math.max(0.01, hideNearRadius * scale);
    const hideR0 = hideR1 + Math.max(0.01, nearFadeWidth * scale);
    const hideR0_2 = hideR0 * hideR0;

    const playerPos = playerPositionRef?.current;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const pX = playerPos?.x ?? 0;
    const pZ = playerPos?.z ?? 0;
    const vX = pX - camX;
    const vZ = pZ - camZ;
    const segLen2 = vX * vX + vZ * vZ;
    const segLen = Math.sqrt(segLen2) || 0.0001;
    const invSegLen = 1 / segLen;
    const vnX = vX * invSegLen;
    const vnZ = vZ * invSegLen;

    const r = Math.max(0.01, fadeRadius * scale);
    const r0 = r * 0.55;
    const r1 = r;
    const minOp = Math.max(0.02, Math.min(1, fadedOpacity));

    const visibleIdx: number[] = [];
    const visibleOpacity: number[] = [];
    for (let i = 0; i < transforms.length; i += 1) {
      const t = transforms[i];
      const dx = t.x - camera.position.x;
      const dz = t.z - camera.position.z;
      const dy = t.y - camera.position.y;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > d2) continue;

      let op = 1;

      // Fade out when the camera gets close, until fully invisible.
      if (dist2 < hideR0_2) {
        const dist = Math.sqrt(Math.max(0, dist2));
        const k = (dist - hideR1) / Math.max(0.0001, hideR0 - hideR1);
        const nearFactor = Math.max(0, Math.min(1, k));
        op *= nearFactor;
      }

      // Fade trees that are between camera and player (approx in XZ).
      if (playerPos && segLen2 > 0.0001) {
        const wX = t.x - camX;
        const wZ = t.z - camZ;
        const proj = wX * vnX + wZ * vnZ;

        if (proj > 0.2 && proj < segLen - 0.2) {
          const px = wX - vnX * proj;
          const pz = wZ - vnZ * proj;
          const d = Math.hypot(px, pz);

          if (d < r1) {
            const u = (d - r0) / Math.max(0.0001, r1 - r0);
            const k = Math.max(0, Math.min(1, u));
            const occFactor = minOp + (1 - minOp) * k;
            op *= occFactor;
          }
        }
      }

      if (op < 0.02) continue; // fully disappear

      visibleIdx.push(i);
      visibleOpacity.push(op);
    }

    visibleIdxRef.current = visibleIdx;

    // write visible transforms to each instanced mesh
    for (let m = 0; m < meshRefs.current.length; m += 1) {
      const inst = meshRefs.current[m];
      const opacityAttr = opacityAttrRefs.current[m];
      if (!inst) continue;
      if (!opacityAttr) continue;

      for (let j = 0; j < visibleIdx.length; j += 1) {
        const t = transforms[visibleIdx[j]];
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.scale.set(t.s, t.s, t.s);
        dummy.updateMatrix();
        inst.setMatrixAt(j, dummy.matrix);
        opacityAttr.setX(j, visibleOpacity[j] ?? 1);
      }

      inst.count = visibleIdx.length;
      inst.instanceMatrix.needsUpdate = true;
      opacityAttr.needsUpdate = true;
    }

    lastCullRef.current.visibleCount = visibleIdx.length;
  });

  if (sourceMeshes.length === 0) return null;

  return (
    <group>
      {sourceMeshes.map((src, idx) => (
        <instancedMesh
          key={idx}
          ref={(node) => {
            meshRefs.current[idx] = node;
            if (node && !opacityAttrRefs.current[idx]) {
              const attr = new THREE.InstancedBufferAttribute(new Float32Array(transforms.length), 1);
              for (let i = 0; i < transforms.length; i += 1) attr.setX(i, 1);
              node.geometry.setAttribute("instanceOpacity", attr);
              opacityAttrRefs.current[idx] = attr;
            }
          }}
          args={[src.geometry, patchedMaterials[idx] ?? (src.material as unknown as THREE.Material), transforms.length]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow={false}
        />
      ))}
    </group>
  );
}

useGLTF.preload("/models/three.glb");
