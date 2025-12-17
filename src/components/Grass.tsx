"use client";

/* eslint-disable react-hooks/immutability */

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type Group,
} from "three";
import type { RapierRigidBody } from "@react-three/rapier";

type Props = {
  target: React.RefObject<Group | null>;
  body?: React.RefObject<RapierRigidBody | null>;
  size?: number;
  radius?: number;
  haloFalloff?: number;
  radialBendStrength?: number;
  height?: number;
  darkColor?: string;
  lightColor?: string;
  count?: number;
  bladeHeight?: number;
  bladeWidth?: number;
  windStrength?: number;
  windSpeed?: number;
};

export default function Grass({
  target,
  body,
  size = 50,
  radius = 2.5,
  haloFalloff = 0.95,
  radialBendStrength = 0.28,
  height = 0,
  darkColor = "#000000",
  lightColor = "#ffffff",
  count = 200000,
  bladeHeight = 0.6,
  bladeWidth = 0.05,
  windStrength = 0.08,
  windSpeed = 1.8,
}: Props) {
  const meshRef = useRef<InstancedMesh | null>(null);

  const geometry = useMemo(() => {
    const g = new PlaneGeometry(bladeWidth, bladeHeight, 1, 4);
    // Put the base of the blade at y=0 (instead of centered).
    g.translate(0, bladeHeight / 2, 0);

    const origins = new Float32Array(count * 3);
    const yaws = new Float32Array(count);
    const rands = new Float32Array(count);

    const half = size * 0.5;
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 2 - 1) * half;
      const z = (Math.random() * 2 - 1) * half;
      origins[i * 3 + 0] = x;
      origins[i * 3 + 1] = 0;
      origins[i * 3 + 2] = z;
      yaws[i] = Math.random() * Math.PI * 2;
      rands[i] = Math.random();
    }

    g.setAttribute("aBladeOrigin", new InstancedBufferAttribute(origins, 3));
    g.setAttribute("aYaw", new InstancedBufferAttribute(yaws, 1));
    g.setAttribute("aRand", new InstancedBufferAttribute(rands, 1));
    return g;
  }, [bladeHeight, bladeWidth, count, size]);

  const material = useMemo(() => {
    const uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uPlayerPosition: { value: new Vector3(0, 0, 0) },
        uPatchSize: { value: size },
        uRadius: { value: radius },
        uHaloFalloff: { value: haloFalloff },
        uRadialBendStrength: { value: radialBendStrength },
        uDark: { value: new Color(darkColor) },
        uLight: { value: new Color(lightColor) },
        uTime: { value: 0 },
        uWindStrength: { value: windStrength },
        uWindSpeed: { value: windSpeed },
      },
    ]);

    const mat = new ShaderMaterial({
      transparent: false,
      side: DoubleSide,
      fog: true,
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aBladeOrigin;
        attribute float aYaw;
        attribute float aRand;

        uniform vec3 uPlayerPosition;
        uniform float uPatchSize;
        uniform float uRadius;
        uniform float uHaloFalloff;
        uniform float uRadialBendStrength;
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uWindSpeed;

        varying vec2 vUv;
        varying float vDist;
        varying float vRand;

        varying vec3 vWorldPos;

        #include <fog_pars_vertex>

        vec2 rotate2d(vec2 v, float a) {
          float c = cos(a);
          float s = sin(a);
          return mat2(c, -s, s, c) * v;
        }

        void main() {
          vUv = uv;

          vec3 transformed = position;
          vec3 origin = aBladeOrigin;

          // Wrap origin within patch bounds relative to player
          float halfPatchSize = uPatchSize * 0.5;
          origin.x = mod(origin.x - uPlayerPosition.x + halfPatchSize, uPatchSize) - halfPatchSize;
          origin.z = mod(origin.z - uPlayerPosition.z + halfPatchSize, uPatchSize) - halfPatchSize;

          float dist = length(origin.xz);

          // Random height variation
          float heightScale = mix(0.55, 1.15, aRand);
          transformed.y *= heightScale;

          // Yaw rotate the blade around Y
          vec2 xz = rotate2d(vec2(transformed.x, transformed.z), aYaw);
          transformed.x = xz.x;
          transformed.z = xz.y;

          // Simple wind bend (stronger toward the tip)
          float tip = smoothstep(0.0, 1.0, transformed.y / (1.0 * heightScale));
          float sway = sin(uTime * uWindSpeed + origin.x * 0.35 + origin.z * 0.35 + aRand * 6.2831853);
          float bend = sway * uWindStrength * tip;
          transformed.x += bend;
          transformed.z += bend * 0.6;

          // Radial bend around the player (strongest near the player + at the tip)
          vec2 dir = origin.xz;
          float dirLen = length(dir);
          if (dirLen > 0.0001) dir /= dirLen;
          float radialT = exp(-dist * uHaloFalloff);
          radialT *= 1.0 - smoothstep(uRadius, uRadius * 1.15, dist);
          float radialBend = uRadialBendStrength * tip * radialT;
          transformed.x += dir.x * radialBend;
          transformed.z += dir.y * radialBend;

          // Place in the world around the player
          transformed.x += uPlayerPosition.x + origin.x;
          transformed.y += uPlayerPosition.y;
          transformed.z += uPlayerPosition.z + origin.z;

          vRand = aRand;
          vDist = length(origin.xz);

          vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
          vWorldPos = worldPosition.xyz;

          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;

          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uRadius;
        uniform float uHaloFalloff;
        uniform vec3 uDark;
        uniform vec3 uLight;

        varying vec2 vUv;
        varying float vDist;
        varying float vRand;

        varying vec3 vWorldPos;

        #include <fog_pars_fragment>

        void main() {
          // Blade silhouette (cutout)
          float edge = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
          float taper = mix(1.0, 0.25, vUv.y);
          float alpha = edge * taper;
          if (alpha < 0.08) discard;

          // Radial brightening around the player
          float d = max(vDist, 0.0);
          // More progressive falloff (smooth everywhere) + soft cutoff at uRadius
          float t = exp(-d * uHaloFalloff);
          t *= 1.0 - smoothstep(uRadius, uRadius * 1.15, d);

          // Only the tip takes the halo color; base stays black.
          float tipMask = smoothstep(0.32, 1.0, vUv.y);
          vec3 haloCol = mix(uDark, uLight, t);
          haloCol *= mix(0.85, 1.15, vRand);
          vec3 col = mix(vec3(0.0), haloCol, tipMask);

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      `,
    });

    return mat;
  }, [darkColor, haloFalloff, lightColor, radialBendStrength, radius, size, windSpeed, windStrength]);

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new Object3D();
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);

  const tmp = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const u = material.uniforms;
    if (!u) return;
    u.uTime.value = clock.getElapsedTime();

    const b = body?.current;
    if (b) {
      const t = b.translation();
      u.uPlayerPosition.value.set(t.x, height, t.z);
      return;
    }

    const g = target.current;
    if (!g) return;
    g.getWorldPosition(tmp);
    u.uPlayerPosition.value.set(tmp.x, height, tmp.z);
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
  );
}
