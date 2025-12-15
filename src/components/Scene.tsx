"use client";

import dynamic from "next/dynamic";
import React, { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import Model from "./Model";

const Canvas = dynamic(
  async () => (await import("@react-three/fiber")).Canvas,
  { ssr: false }
);

function CameraController({ target }: { target: React.RefObject<any> }) {
  const { camera } = useThree();
  const offset = useRef(new Vector3(0, 2, 4)); // caméra derrière et au-dessus

  useFrame(() => {
    if (!target.current) return;

    const playerPos = target.current.position;
    const playerRot = target.current.rotation.y;

    // Calculer la position de la caméra derrière le personnage
    const distance = 4;
    const height = 2;
    const camX = playerPos.x - Math.sin(playerRot) * distance;
    const camZ = playerPos.z - Math.cos(playerRot) * distance;

    // Interpolation douce (lerp progressif)
    camera.position.x += (camX - camera.position.x) * 0.05;
    camera.position.y += (playerPos.y + height - camera.position.y) * 0.05;
    camera.position.z += (camZ - camera.position.z) * 0.05;

    // Regarder le personnage
    camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
  });

  return null;
}

export default function Scene() {
  const modelRef = useRef<any>(null);

  return (
    <Canvas
      shadows
      camera={{ position: [2, 1.5, 3], fov: 45 }}
      style={{ background: "#ffffff" }}
    >
      {/* lumière simple */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />

      {/* grille noire */}
      <gridHelper args={[50, 50, "#000000", "#000000"]} />

      {/* ton modèle */}
      <React.Suspense fallback={null}>
        <Model url="/models/model.glb" groupRef={modelRef} />
      </React.Suspense>

      <CameraController target={modelRef} />
    </Canvas>
  );
}
