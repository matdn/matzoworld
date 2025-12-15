"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Group, Vector3, AnimationClip, Quaternion, Euler } from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type Props = {
  url: string;
  groupRef?: React.RefObject<Group>;
};

function fixMixamoWalkClip(clip: any) {
  // Corrige l'offset de rotation Mixamo (souvent -90° en X)
  const qFix = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const q = new Quaternion();
  const v = new Vector3();

  for (const track of clip.tracks) {
    const isHipsQuat = /Hips\.quaternion$/.test(track.name);
    const isHipsPos = /Hips\.position$/.test(track.name);

    if (isHipsQuat) {
      const values = track.values as number[];
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i);
        q.premultiply(qFix);
        q.toArray(values, i);
      }
    }

    if (isHipsPos) {
      const values = track.values as number[];
      for (let i = 0; i < values.length; i += 3) {
        v.fromArray(values, i);
        v.applyQuaternion(qFix);
        v.toArray(values, i);
      }
    }
  }

  clip.resetDuration();
  return clip;
}

function removeRootMotion(clip: any) {
  // Neutralise le déplacement X/Z contenu dans l'anim (root motion)
  for (const track of clip.tracks) {
    if (/Hips\.position$/.test(track.name)) {
      const values = track.values as number[];

      const baseX = values[0];
      const baseZ = values[2];

      for (let i = 0; i < values.length; i += 3) {
        values[i + 0] = baseX; // X figé
        // Y conservé (values[i+1])
        values[i + 2] = baseZ; // Z figé
      }
    }
  }

  clip.resetDuration();
  return clip;
}

function useKeysAZERTY() {
  const keys = useRef({ z: false, q: false, s: false, d: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = true; // Z (AZERTY)
      if (e.code === "KeyA") keys.current.q = true; // Q (AZERTY)
      if (e.code === "KeyS") keys.current.s = true; // S
      if (e.code === "KeyD") keys.current.d = true; // D
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = false;
      if (e.code === "KeyA") keys.current.q = false;
      if (e.code === "KeyS") keys.current.s = false;
      if (e.code === "KeyD") keys.current.d = false;
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

function computeClipSpeedFromRootMotion(clip: any) {
    const track = clip.tracks.find((t: any) => /Hips\.position$/.test(t.name));
    if (!track) return 1.5; // fallback

    const v = track.values as number[];
    if (v.length < 6) return 1.5;

    // distance XZ entre début et fin
    const x0 = v[0], z0 = v[2];
    const x1 = v[v.length - 3], z1 = v[v.length - 1];
    const dist = Math.hypot(x1 - x0, z1 - z0);

    const duration = clip.duration || 1;
    return dist / duration; // "unités blender/three" par seconde
  }

export default function Model({ url, groupRef }: Props) {
  const internalRef = useRef<Group>(null!);
  const group = groupRef || internalRef;

  // GLB (modèle + anim(s) incluse(s))
  const gltf = useGLTF(url);
  const glbAnims = useAnimations(gltf.animations, group);

  // Charger Walk.fbx (animation seule)
  const walkState = useRef<{ clip: AnimationClip | null }>({ clip: null });
  const walkSpeedRef = useRef(1.5); 
  useEffect(() => {
    const loader = new FBXLoader();
    
    loader.load("/anims/walk.fbx", (fbx) => {
      const clip = fbx.animations?.[0];
      if (!clip) return;

      fixMixamoWalkClip(clip);
      
      removeRootMotion(clip);
      walkSpeedRef.current = computeClipSpeedFromRootMotion(clip);

      // 2) puis supprime le root motion pour rester in-place
      removeRootMotion(clip);

      clip.name = "Walk";
      walkState.current.clip = clip;
      walkState.current.loaded = true;
    });
  }, []);

  const { actions, names, mixer } = glbAnims;
  const extraActions = useRef<{ walk?: any }>({});

  useEffect(() => {
    if (!mixer) return;

    const tryBuildWalk = () => {
      const clip = walkState.current.clip;
      if (!clip || extraActions.current.walk) return;
      extraActions.current.walk = mixer.clipAction(clip, group.current);
    };

    tryBuildWalk();
    const id = window.setInterval(() => {
      tryBuildWalk();
      if (extraActions.current.walk) window.clearInterval(id);
    }, 100);

    return () => window.clearInterval(id);
  }, [mixer, group]);

  // Choisir l’anim “idle” du GLB (handle ou première)
  const idleName = useMemo(() => {
    if (actions["handle"]) return "handle";
    return names[0] ?? null;
  }, [actions, names]);

  const current = useRef<"idle" | "walk">("idle");

  useEffect(() => {
    if (!idleName) return;
    const idle = actions[idleName];
    if (!idle) return;

    idle.reset().play();
    current.current = "idle";
    return () => idle.stop();
  }, [actions, idleName]);

  const keys = useKeysAZERTY();

  const speed = 1.2; // vitesse max (m/s)
  const rotationSpeed = 2.5; // vitesse rotation (rad/s)
  const accel = 10; // lissage accel/decel (plus grand = plus sec)
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
    if (!walk) return;
    if (!idleName) return;

    const idle = actions[idleName];

    if (current.current !== "walk") {
      walk.reset().play();

      // Ajuste la vitesse des pas (anti "glisse")
      // -> augmente si tu avances trop vite par rapport aux pas
      // -> baisse si les pieds "courent" trop
      walk.setEffectiveTimeScale(1.1);

      if (idle) walk.crossFadeFrom(idle, 0.15, false);
      current.current = "walk";
    }
  }

  useFrame((_, dt) => {
    const k = keys.current;

    // rotation Q/D
    if (k.q) group.current.rotation.y += rotationSpeed * dt;
    if (k.d) group.current.rotation.y -= rotationSpeed * dt;

    // Z/S avancer/reculer (dans ton setup actuel)
    let forward = 0;
    if (k.z) forward = -1; // (comme dans ton code)
    if (k.s) forward = 1;

    const moving = forward !== 0;

    // lissage vitesse (évite glisse visuelle au démarrage/stop)
    const targetSpeed = moving ? speed : 0;
    currentSpeed.current +=
      (targetSpeed - currentSpeed.current) * (1 - Math.exp(-accel * dt));

    if (moving) {
      const angle = group.current.rotation.y;

      group.current.position.x -= Math.sin(angle) * forward * currentSpeed.current * dt;
      group.current.position.z -= Math.cos(angle) * forward * currentSpeed.current * dt;

      playWalk();
    } else {
      playIdle();
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={gltf.scene} />
    </group>
  );
}

useGLTF.preload("/models/character.glb");
