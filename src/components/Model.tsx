"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Group, Vector3, AnimationClip } from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { Quaternion, Euler } from "three";

type Props = {
  url: string;
  groupRef?: React.RefObject<Group>;
};

function fixMixamoWalkClip(clip: any) {
  // Le “couché” = typiquement un ±90° sur l’axe X
  const qFix = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const q = new Quaternion();
  const v = new Vector3();

  for (const track of clip.tracks) {
    // cible le bone racine Mixamo (le plus courant)
    const isHipsQuat = /Hips\.quaternion$/.test(track.name);
    const isHipsPos = /Hips\.position$/.test(track.name);

    if (isHipsQuat) {
      const values = track.values;
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i);
        q.premultiply(qFix); // applique la correction
        q.toArray(values, i);
      }
    }

    if (isHipsPos) {
      const values = track.values;
      for (let i = 0; i < values.length; i += 3) {
        v.fromArray(values, i);
        v.applyQuaternion(qFix); // corrige aussi le déplacement du hips
        v.toArray(values, i);
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
      if (e.code === "KeyW") keys.current.z = true;
      if (e.code === "KeyA") keys.current.q = true;
      if (e.code === "KeyS") keys.current.s = true;
      if (e.code === "KeyD") keys.current.d = true;
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

export default function Model({ url, groupRef }: Props) {
  const internalRef = useRef<Group>(null!);
  const group = groupRef || internalRef;

  // GLB (modèle + anim(s) incluse(s))
  const gltf = useGLTF(url);
  const glbAnims = useAnimations(gltf.animations, group);

  // Charger Walk.fbx (animation seule)
  const walkClip: AnimationClip | null = useMemo(() => {
    // Important: ce useMemo tourne côté client; on charge le FBX une fois.
    // On fait un petit "cache" maison simple.
    return null;
  }, []);

  const walkState = useRef<{
    clip: AnimationClip | null;
    loaded: boolean;
  }>({ clip: null, loaded: false });

  useEffect(() => {
    const loader = new FBXLoader();
    loader.load("/anims/walk.fbx", (fbx) => {
      const clip = fbx.animations?.[0];
      if (!clip) return;
      fixMixamoWalkClip(clip);
      clip.name = "Walk"; // nom stable côté code
      walkState.current.clip = clip;
      walkState.current.loaded = true;
    });
  }, []);

  // Mixer unique : on combine les clips GLB + walk FBX sur le même mixer
  const { actions, names, mixer } = glbAnims;

  const extraActions = useRef<{ walk?: any }>({});

  useEffect(() => {
    if (!mixer) return;

    // Crée une action “Walk” à partir du clip FBX (quand prêt)
    const tryBuildWalk = () => {
      const clip = walkState.current.clip;
      if (!clip || extraActions.current.walk) return;
      extraActions.current.walk = mixer.clipAction(clip, group.current);
    };

    // tente immédiatement + retente un peu (le temps que le FBX charge)
    tryBuildWalk();
    const id = window.setInterval(() => {
      tryBuildWalk();
      if (extraActions.current.walk) window.clearInterval(id);
    }, 100);

    return () => window.clearInterval(id);
  }, [mixer]);

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
  const dir = useMemo(() => new Vector3(), []);
  const speed = 2.2; // m/s (ajuste)
  const rotationSpeed = 2.5; // vitesse de rotation (rad/s)

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
      if (idle) walk.crossFadeFrom(idle, 0.15, false);
      current.current = "walk";
    }
  }

  useFrame((_, dt) => {
    const k = keys.current;

    // Q/D pour tourner
    if (k.q) {
      group.current.rotation.y += rotationSpeed * dt;
    }
    if (k.d) {
      group.current.rotation.y -= rotationSpeed * dt;
    }

    // Z/S pour avancer/reculer dans la direction où le personnage regarde
    let forward = 0;
    if (k.z) forward = 1; // avance
    if (k.s) forward = -1; // recule

    const moving = forward !== 0;

    if (moving) {
      // Déplacement dans la direction du personnage (rotation.y)
      const angle = group.current.rotation.y;
      group.current.position.x -= Math.sin(angle) * forward * speed * dt;
      group.current.position.z -= Math.cos(angle) * forward * speed * dt;

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
