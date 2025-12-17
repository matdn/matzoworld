"use client";

/* eslint-disable react-hooks/immutability */

import dynamic from "next/dynamic";
import React, { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { Group, PointLight, Vector3 } from "three";
import { CapsuleCollider, CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import Model from "./Model";
import Grass from "./Grass";

const ENABLE_RAPIER = false;

const Canvas = dynamic(
  async () => (await import("@react-three/fiber")).Canvas,
  { ssr: false }
);

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function IntroCamera({
  enabled,
  target,
  body,
  duration = 3.2,
  onDone,
}: {
  enabled: boolean;
  target: React.RefObject<Group | null>;
  body?: React.RefObject<RapierRigidBody | null>;
  duration?: number;
  onDone: () => void;
}) {
  const { camera } = useThree();

  const startTimeRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const pivotRef = useRef(new Vector3());
  const endPosRef = useRef(new Vector3());
  const startThetaRef = useRef(0);
  const endThetaRef = useRef(0);
  const startRadiusRef = useRef(30);
  const endRadiusRef = useRef(5);
  const startYRef = useRef(10);
  const endYRef = useRef(2);

  useEffect(() => {
    if (!enabled) {
      startTimeRef.current = null;
      doneRef.current = false;
    }
  }, [enabled]);

  useFrame((state) => {
    if (!enabled) return;
    if (doneRef.current) return;

    const now = state.clock.getElapsedTime();

    if (startTimeRef.current === null) {
      startTimeRef.current = now;

      const b = body?.current;
      const pivot = b
        ? new Vector3(b.translation().x, b.translation().y, b.translation().z)
        : target.current?.position.clone() ?? new Vector3(0, 0, 0);
      pivotRef.current.copy(pivot);

      endPosRef.current.copy(camera.position);

      const endOffset = endPosRef.current.clone().sub(pivot);
      const endRadiusXZ = Math.hypot(endOffset.x, endOffset.z) || 0.001;
      const endTheta = Math.atan2(endOffset.z, endOffset.x);

      endThetaRef.current = endTheta;
      startThetaRef.current = endTheta + Math.PI * 1.5;
      endRadiusRef.current = endRadiusXZ;
      startRadiusRef.current = endRadiusXZ + 25;
      endYRef.current = endPosRef.current.y;
      startYRef.current = endPosRef.current.y + 12;

      camera.position.set(
        pivot.x + Math.cos(startThetaRef.current) * startRadiusRef.current,
        startYRef.current,
        pivot.z + Math.sin(startThetaRef.current) * startRadiusRef.current
      );
    }

    const t = (now - (startTimeRef.current ?? now)) / duration;
    const clamped = Math.max(0, Math.min(1, t));
    const k = easeInOutCubic(clamped);

    const pivot = pivotRef.current;
    const theta = startThetaRef.current + (endThetaRef.current - startThetaRef.current) * k;
    const radius = startRadiusRef.current + (endRadiusRef.current - startRadiusRef.current) * k;
    const y = startYRef.current + (endYRef.current - startYRef.current) * k;

    camera.position.set(
      pivot.x + Math.cos(theta) * radius,
      y,
      pivot.z + Math.sin(theta) * radius
    );
    camera.lookAt(pivot.x, pivot.y + 1, pivot.z);

    if (clamped >= 1) {
      camera.position.copy(endPosRef.current);
      camera.lookAt(pivot.x, pivot.y + 1, pivot.z);
      doneRef.current = true;
      onDone();
    }
  });

  return null;
}

function FollowCamera({
  target,
  body,
}: {
  target: React.RefObject<Group | null>;
  body?: React.RefObject<RapierRigidBody | null>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    const b = body?.current;
    const p = b ? b.translation() : target.current?.position;
    if (!p) return;

    const distance = 4;
    const height = 2;

    const camX = p.x + 2;
    const camY = p.y + height;
    const camZ = p.z + distance;

    camera.position.x += (camX - camera.position.x) * 0.08;
    camera.position.y += (camY - camera.position.y) * 0.08;
    camera.position.z += (camZ - camera.position.z) * 0.08;
    camera.lookAt(p.x, p.y + 1, p.z);
  });

  return null;
}

function FollowLight({
  target,
  body,
}: {
  target: React.RefObject<Group | null>;
  body?: React.RefObject<RapierRigidBody | null>;
}) {
  const lightRef = useRef<PointLight | null>(null);

  useFrame(() => {
    if (!lightRef.current) return;

    const b = body?.current;
    if (b) {
      const t = b.translation();
      lightRef.current.position.set(t.x, t.y + 3, t.z);
      return;
    }

    if (!target.current) return;
    const p = target.current.position;
    lightRef.current.position.set(p.x, p.y + 3, p.z);
  });

  return (
    <pointLight
      ref={lightRef}
      position={[0, 3, 0]}
      intensity={2.2}
      distance={20}
      decay={2}
    />
  );
}

export default function Scene({ started = true }: { started?: boolean }) {
  const modelRef = useRef<Group | null>(null);
  const playerBodyRef = useRef<RapierRigidBody | null>(null);
  const [introDone, setIntroDone] = useState(false);

  return (
    <Canvas
      dpr={1}
      gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
      camera={{ position: [2, 1.5, 3], fov: 45 }}
      style={{ background: "#000000" }}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        const onLost = (e: Event) => {
          e.preventDefault();
        };
        canvas.addEventListener("webglcontextlost", onLost as EventListener, false);
      }}
    >
      {/* <fog attach="fog" args={["#ffffff", 3, 14]} /> */}

      {/* lumière simple */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} />

      <FollowLight target={modelRef} body={playerBodyRef} />

      <IntroCamera
        enabled={started && !introDone}
        target={modelRef}
        body={playerBodyRef}
        onDone={() => setIntroDone(true)}
      />

      <Grass
        target={modelRef}
        body={playerBodyRef}
        size={50}
        radius={3.6}
        haloFalloff={1}
        radialBendStrength={0.5}
        height={0.25}
      />

      {started ? (
        <Sparkles
          count={100}
          size={3.2}
          speed={0.35}
          opacity={0.75}
          color="#ffffff"
          position={[0, 1.2, 0]}
          scale={[50, 6, 50]}
          noise={1}
        />
      ) : null}

      {/* fontaine au centre */}
      {/* <React.Suspense fallback={null}>
        <Fountain />
      </React.Suspense> */}

      {ENABLE_RAPIER ? (
        <Physics gravity={[0, -9.81, 0]}>
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[25, 0.05, 25]} position={[0, -0.05, 0]} friction={1} restitution={0} />
          </RigidBody>

          <RigidBody
            ref={playerBodyRef}
            colliders={false}
            position={[0, 2, 0]}
            enabledRotations={[false, true, false]}
            linearDamping={3}
            angularDamping={10}
            ccd
          >
            <CapsuleCollider args={[0.55, 0.35]} position={[0, 0.9, 0]} friction={1} restitution={0} />

            <React.Suspense fallback={null}>
              <Model url="/models/model.glb" groupRef={modelRef} rigidBodyRef={playerBodyRef} />
            </React.Suspense>
          </RigidBody>
        </Physics>
      ) : (
        <React.Suspense fallback={null}>
          <Model url="/models/model.glb" groupRef={modelRef} />
        </React.Suspense>
      )}

      {started && introDone ? <FollowCamera target={modelRef} body={playerBodyRef} /> : null}
    </Canvas>
  );
}
