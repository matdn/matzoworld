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
  const { camera, gl } = useThree();
  const cameraAngle = useRef(0); // Angle de rotation autour du personnage
  const isDragging = useRef(false);
  const lastMouseX = useRef(0);

  React.useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      lastMouseX.current = e.clientX;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - lastMouseX.current;
      cameraAngle.current -= deltaX * 0.005; // Sensibilité de rotation
      lastMouseX.current = e.clientX;
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const canvas = gl.domElement;
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [gl]);

  useFrame(() => {
    if (!target.current) return;

    const playerPos = target.current.position;
    const playerRot = target.current.rotation.y;

    // Calculer la position de la caméra avec l'angle de rotation
    const distance = 4;
    const height = 2;
    const totalAngle = playerRot + cameraAngle.current;
    
    const camX = playerPos.x - Math.sin(totalAngle) * distance;
    const camZ = playerPos.z - Math.cos(totalAngle) * distance;

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
