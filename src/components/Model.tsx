"use client";

import React, { useEffect, useMemo, useRef } from "react";
import {
  Group,
  Vector3,
  AnimationClip,
  Quaternion,
  Euler,
  LoopOnce,
} from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type Props = {
  url: string;
  groupRef?: React.RefObject<Group>;
};

function fixMixamoClip(clip: any) {
  // IMPORTANT: on ne touche PAS aux tracks ".position" (sinon le jump perd sa hauteur)
  // On corrige uniquement l'orientation via la rotation du Hips.
  const qFix = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const q = new Quaternion();

  for (const track of clip.tracks) {
    const isHipsQuat = /Hips\.quaternion$/.test(track.name);
    if (!isHipsQuat) continue;

    const values = track.values as number[];
    for (let i = 0; i < values.length; i += 4) {
      q.fromArray(values, i);
      q.premultiply(qFix);
      q.toArray(values, i);
    }
  }

  clip.resetDuration();
  return clip;
}

function removeRootMotionXZ(clip: any) {
  // On enlève X/Z, on garde Y.
  for (const track of clip.tracks) {
    if (/Hips\.position$/.test(track.name)) {
      const values = track.values as number[];
      const baseX = values[0];
      const baseZ = values[2];

      for (let i = 0; i < values.length; i += 3) {
        values[i + 0] = baseX;
        // Y conservé
        values[i + 2] = baseZ;
      }
    }
  }

  clip.resetDuration();
  return clip;
}

function normalizeHipsY(clip: any) {
  // Évite le "snap" initial vers le bas et empêche de finir sous le sol.
  const track = clip.tracks.find((t: any) => /Hips\.position$/.test(t.name));
  if (!track) return clip;

  const values = track.values as number[];

  // Rebase: première frame à 0
  const baseY = values[1];
  for (let i = 0; i < values.length; i += 3) {
    values[i + 1] -= baseY;
  }

  // Clamp: remonte si ça descend sous 0
  let minY = Infinity;
  for (let i = 0; i < values.length; i += 3) {
    minY = Math.min(minY, values[i + 1]);
  }
  if (minY < 0) {
    const lift = -minY;
    for (let i = 0; i < values.length; i += 3) {
      values[i + 1] += lift;
    }
  }

  clip.resetDuration();
  return clip;
}

function useKeysAZERTY() {
  const keys = useRef({ z: false, q: false, s: false, d: false, space: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = true; // Z (AZERTY)
      if (e.code === "KeyA") keys.current.q = true; // Q
      if (e.code === "KeyS") keys.current.s = true; // S
      if (e.code === "KeyD") keys.current.d = true; // D
      if (e.code === "Space") keys.current.space = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = false;
      if (e.code === "KeyA") keys.current.q = false;
      if (e.code === "KeyS") keys.current.s = false;
      if (e.code === "KeyD") keys.current.d = false;
      if (e.code === "Space") keys.current.space = false;
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

export default function Model({ url, groupRef }: Props) {
  const internalRef = useRef<Group>(null!);
  const group = groupRef || internalRef;

  const gltf = useGLTF(url);
  const glbAnims = useAnimations(gltf.animations, group);
  const { actions, names, mixer } = glbAnims;

  // FBX clips
  const walkState = useRef<{ clip: AnimationClip | null }>({ clip: null });
  const jumpState = useRef<{ clip: AnimationClip | null }>({ clip: null });

  useEffect(() => {
    const loader = new FBXLoader();

    loader.load("/anims/walk.fbx", (fbx) => {
      const clip = fbx.animations?.[0];
      if (!clip) return;

      fixMixamoClip(clip);
      removeRootMotionXZ(clip);
      clip.name = "Walk";
      walkState.current.clip = clip;
    });

    loader.load("/anims/Jumping.fbx", (fbx) => {
      const clip = fbx.animations?.[0];
      if (!clip) return;

      fixMixamoClip(clip);
      removeRootMotionXZ(clip);
      normalizeHipsY(clip); // ✅ important pour éviter le snap bas / fin sous la grille
      clip.name = "Jump";
      jumpState.current.clip = clip;
    });
  }, []);

  // Actions extra
  const extraActions = useRef<{ walk?: any; jump?: any }>({});

  useEffect(() => {
    if (!mixer) return;

    const id = window.setInterval(() => {
      if (!extraActions.current.walk && walkState.current.clip) {
        extraActions.current.walk = mixer.clipAction(
          walkState.current.clip,
          group.current
        );
      }

      if (!extraActions.current.jump && jumpState.current.clip) {
        const a = mixer.clipAction(jumpState.current.clip, group.current);
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
        extraActions.current.jump = a;
      }

      if (extraActions.current.walk && extraActions.current.jump) {
        window.clearInterval(id);
      }
    }, 50);

    return () => window.clearInterval(id);
  }, [mixer, group]);

  // Idle du GLB
  const idleName = useMemo(() => {
    if (actions["handle"]) return "handle";
    return names[0] ?? null;
  }, [actions, names]);

  const current = useRef<"idle" | "walk" | "jump">("idle");
  const isJumping = useRef(false);

  useEffect(() => {
    if (!idleName) return;
    const idle = actions[idleName];
    if (!idle) return;

    idle.reset().play();
    current.current = "idle";
    return () => idle.stop();
  }, [actions, idleName]);

  // Fin du saut : écouter sur le mixer
  useEffect(() => {
    if (!mixer) return;

    const onFinished = (e: any) => {
      if (e?.action !== extraActions.current.jump) return;
      isJumping.current = false;
      current.current = "idle";
    };

    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [mixer]);

  const keys = useKeysAZERTY();

  // Mouvement
  const speed = 0.8;
  const rotationSpeed = 2.5;
  const accel = 10;
  const currentSpeed = useRef(0);

  function playIdle() {
    if (!idleName) return;
    const idle = actions[idleName];
    const walk = extraActions.current.walk;
    if (!idle) return;

    if (current.current !== "idle") {
      idle.reset().play();
      if (walk) idle.crossFadeFrom(walk, 0.15, false);
      current.current = "idle";
    }
  }

  function playWalk() {
    const walk = extraActions.current.walk;
    if (!walk || !idleName) return;
    if (isJumping.current) return;

    const idle = actions[idleName];

    if (current.current !== "walk") {
      walk.reset().play();
      walk.setEffectiveTimeScale(1.1);
      if (idle) walk.crossFadeFrom(idle, 0.15, false);
      current.current = "walk";
    }
  }

  function playJump() {
    const jump = extraActions.current.jump;
    if (!jump || isJumping.current) return;

    isJumping.current = true;

    // Stop net pour éviter des offsets bizarres au blend
    if (idleName && actions[idleName]) actions[idleName].stop();
    if (extraActions.current.walk) extraActions.current.walk.stop();

    jump.reset();
    jump.setLoop(LoopOnce, 1);
    jump.clampWhenFinished = true;
    jump.play();

    current.current = "jump";
  }

  useFrame((_, dt) => {
    const k = keys.current;

    // Jump
    if (k.space && !isJumping.current) playJump();

    // Rotation (bloquée pendant jump)
    if (!isJumping.current) {
      if (k.q) group.current.rotation.y += rotationSpeed * dt;
      if (k.d) group.current.rotation.y -= rotationSpeed * dt;
    }

    // Move Z/S
    let forward = 0;
    if (k.z) forward = -1;
    if (k.s) forward = 1;

    const moving = forward !== 0;

    const targetSpeed = moving && !isJumping.current ? speed : 0;
    currentSpeed.current +=
      (targetSpeed - currentSpeed.current) * (1 - Math.exp(-accel * dt));

    if (moving && !isJumping.current) {
      const angle = group.current.rotation.y;

      group.current.position.x -=
        Math.sin(angle) * forward * currentSpeed.current * dt;
      group.current.position.z -=
        Math.cos(angle) * forward * currentSpeed.current * dt;

      playWalk();
    } else {
      if (!isJumping.current) playIdle();
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={gltf.scene} />
    </group>
  );
}

useGLTF.preload("/models/character.glb");
