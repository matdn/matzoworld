"use client";

/* eslint-disable react-hooks/immutability */

import React, { useEffect, useMemo, useRef } from "react";
import { AnimationAction, AnimationClip, Euler, Group, Quaternion, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as THREE from "three";
import type { RapierRigidBody } from "@react-three/rapier";

const ENABLE_JUMP = false;

const fbxClipCache = new Map<string, AnimationClip>();
const fbxClipPromiseCache = new Map<string, Promise<AnimationClip | null>>();

function loadFbxFirstClip(url: string): Promise<AnimationClip | null> {
  const cached = fbxClipCache.get(url);
  if (cached) return Promise.resolve(cached);

  const inFlight = fbxClipPromiseCache.get(url);
  if (inFlight) return inFlight;

  const p = new Promise<AnimationClip | null>((resolve) => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        const clip = fbx.animations?.[0] ?? null;
        if (clip) fbxClipCache.set(url, clip);
        resolve(clip);
      },
      undefined,
      () => resolve(null)
    );
  }).finally(() => {
    fbxClipPromiseCache.delete(url);
  });

  fbxClipPromiseCache.set(url, p);
  return p;
}

type Props = {
  url: string;
  groupRef?: React.MutableRefObject<Group | null>;
  rigidBodyRef?: React.RefObject<RapierRigidBody | null>;
};

function fixMixamoWalkClip(clip: AnimationClip) {
  const qFix = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const q = new Quaternion();
  const v = new Vector3();

  for (const track of clip.tracks) {
    const isHipsQuat = /Hips\.quaternion$/.test(track.name);
    const isHipsPos = /Hips\.position$/.test(track.name);

    if (isHipsQuat) {
      const values = track.values as Float32Array;
      for (let i = 0; i < values.length; i += 4) {
        q.set(values[i + 0], values[i + 1], values[i + 2], values[i + 3]);
        q.premultiply(qFix);
        values[i + 0] = q.x;
        values[i + 1] = q.y;
        values[i + 2] = q.z;
        values[i + 3] = q.w;
      }
    }

    if (isHipsPos) {
      const values = track.values as Float32Array;
      for (let i = 0; i < values.length; i += 3) {
        v.set(values[i + 0], values[i + 1], values[i + 2]);
        v.applyQuaternion(qFix);
        values[i + 0] = v.x;
        values[i + 1] = v.y;
        values[i + 2] = v.z;
      }
    }
  }

  clip.resetDuration();
  return clip;
}

function removeRootMotion(clip: AnimationClip) {
  for (const track of clip.tracks) {
    if (/Hips\.position$/.test(track.name)) {
      const values = track.values as Float32Array;

      const baseX = values[0];
      const baseZ = values[2];

      for (let i = 0; i < values.length; i += 3) {
        values[i + 0] = baseX; // X figé
        values[i + 2] = baseZ; // Z figé
      }
    }
  }

  clip.resetDuration();
  return clip;
}

function useKeysAZERTY() {
  const keys = useRef({ z: false, q: false, s: false, d: false, shift: false, space: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = true; 
      if (e.code === "KeyA") keys.current.q = true;
      if (e.code === "KeyS") keys.current.s = true; 
      if (e.code === "KeyD") keys.current.d = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.current.shift = true;
      if (e.code === "Space") keys.current.space = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyW") keys.current.z = false;
      if (e.code === "KeyA") keys.current.q = false;
      if (e.code === "KeyS") keys.current.s = false;
      if (e.code === "KeyD") keys.current.d = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.current.shift = false;
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

function computeClipSpeedFromRootMotion(clip: AnimationClip) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return 1.5;

  const v = track.values as Float32Array;
  if (v.length < 6) return 1.5;

  const x0 = v[0], z0 = v[2];
  const x1 = v[v.length - 3], z1 = v[v.length - 1];
  const dist = Math.hypot(x1 - x0, z1 - z0);

  const duration = clip.duration || 1;
  return dist / duration;
}

export default function Model({ url, groupRef, rigidBodyRef }: Props) {
  const internalRef = useRef<Group | null>(null);
  const tmpEuler = useMemo(() => new THREE.Euler(0, 0, 0), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  const gltf = useGLTF(url);
  const glbAnims = useAnimations(gltf.animations);
  const group = internalRef;

  const attachRefs = React.useCallback(
    (node: Group | null) => {
      internalRef.current = node;
      glbAnims.ref.current = node;
      if (groupRef) groupRef.current = node;
    },
    [glbAnims.ref, groupRef]
  );

  const walkState = useRef<{ clip: AnimationClip | null; loaded?: boolean }>({ clip: null });
  const runState = useRef<{ clip: AnimationClip | null; loaded?: boolean }>({ clip: null });
  const jumpState = useRef<{ clip: AnimationClip | null; loaded?: boolean }>({ clip: null });

  const walkSpeedRef = useRef(1.5); 
  useEffect(() => {
    let cancelled = false;

    void loadFbxFirstClip("/anims/walk.fbx").then((clip) => {
      if (!clip || cancelled) return;
      fixMixamoWalkClip(clip);
      walkSpeedRef.current = computeClipSpeedFromRootMotion(clip);
      removeRootMotion(clip);
      clip.name = "Walk";
      walkState.current.clip = clip;
      walkState.current.loaded = true;
    });

    void loadFbxFirstClip("/anims/Running.fbx").then((clip) => {
      if (!clip || cancelled) return;
      fixMixamoWalkClip(clip);
      removeRootMotion(clip);
      clip.name = "Run";
      runState.current.clip = clip;
      runState.current.loaded = true;
    });

    void loadFbxFirstClip("/anims/Jumping.fbx").then((clip) => {
      if (!clip || cancelled) return;
      fixMixamoWalkClip(clip);
      removeRootMotion(clip);
      clip.name = "Jump";
      jumpState.current.clip = clip;
      jumpState.current.loaded = true;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const { actions, names, mixer } = glbAnims;
  const extraActions = useRef<{ walk?: AnimationAction; run?: AnimationAction; jump?: AnimationAction }>({});
  const isJumping = useRef(false);
  const wasSpacePressed = useRef(false);
  const yawRef = useRef(0);

  useEffect(() => {
    if (!mixer) return;

    const tryBuildWalk = () => {
      const clip = walkState.current.clip;
      if (!clip || extraActions.current.walk) return;
      if (!group.current) return;
      extraActions.current.walk = mixer.clipAction(clip, group.current);
    };

    const tryBuildRun = () => {
      const clip = runState.current.clip;
      if (!clip || extraActions.current.run) return;
      if (!group.current) return;
      extraActions.current.run = mixer.clipAction(clip, group.current);
    };

    const tryBuildJump = () => {
      const clip = jumpState.current.clip;
      if (!clip || extraActions.current.jump) return;
      if (!group.current) return;
      extraActions.current.jump = mixer.clipAction(clip, group.current);
    };

    tryBuildWalk();
    const id = window.setInterval(() => {
      tryBuildWalk();
      tryBuildRun();
      tryBuildJump();
      if (extraActions.current.walk && extraActions.current.run && extraActions.current.jump) window.clearInterval(id);
    }, 100);

    return () => window.clearInterval(id);
  }, [mixer, group]);

  useEffect(() => {
    if (!mixer) return;

    const onFinished = (e: { type: string; action: AnimationAction }) => {
      // On ne réagit qu’à la fin du jump
      if (e.action !== extraActions.current.jump) return;
      isJumping.current = false;
      if (current.current === "jump") current.current = "idle";
    };

    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
    };
  }, [mixer]);

  const idleName = useMemo(() => {
    if (actions["handle"]) return "handle";
    return names[0] ?? null;
  }, [actions, names]);

  const current = useRef<"idle" | "walk" | "run" | "jump">("idle");

  useEffect(() => {
    if (!idleName) return;
    const idle = actions[idleName];
    if (!idle) return;

    idle.reset().play();
    current.current = "idle";
    return () => {
      idle.stop();
    };
  }, [actions, idleName]);

  const keys = useKeysAZERTY();

  const walkSpeed = 1.2;
  const runSpeed = 3.2;
  const rotationSpeed = 2.5; 
  const accel = 10; 
  const currentSpeed = useRef(0);

  function playIdle() {
    if (!idleName) return;
    const idle = actions[idleName];
    const walk = extraActions.current.walk;
    const run = extraActions.current.run;
    if (!idle) return;

    if (current.current !== "idle") {
      if (current.current === "jump") return;
      idle.reset().play();
      const prev = current.current === "walk" ? walk : current.current === "run" ? run : null;
      if (prev) idle.crossFadeFrom(prev, 0.15, false);
      current.current = "idle";
    }
  }

  


  function playWalk() {
    const walk = extraActions.current.walk;
    if (!walk) return;
    if (!idleName) return;
    if (current.current === "jump") return;

    const idle = actions[idleName];
    const run = extraActions.current.run;

    if (current.current !== "walk") {
      walk.reset().play();

      walk.setEffectiveTimeScale(1.5);

      const prev = current.current === "idle" ? idle : current.current === "run" ? run : null;
      if (prev) walk.crossFadeFrom(prev, 0.15, false);
      current.current = "walk";
    }
  }

  function playRun() {
    const run = extraActions.current.run;
    if (!run) return;
    if (!idleName) return;
    if (current.current === "jump") return;

    const idle = actions[idleName];
    const walk = extraActions.current.walk;

    if (current.current !== "run") {
      run.reset().play();
      run.setEffectiveTimeScale(1.0);

      const prev = current.current === "idle" ? idle : current.current === "walk" ? walk : null;
      if (prev) run.crossFadeFrom(prev, 0.15, false);
      current.current = "run";
    }
  }

  function playJump() {
    if (!ENABLE_JUMP) return;
    const jump = extraActions.current.jump;
    if (!jump) return;
    if (!idleName) return;

    const idle = actions[idleName];
    const walk = extraActions.current.walk;
    const run = extraActions.current.run;

    if (isJumping.current) return;

    const prevState = current.current;
    const prev = prevState === "idle" ? idle : prevState === "walk" ? walk : prevState === "run" ? run : null;

    isJumping.current = true;
    current.current = "jump";

    jump.reset();
    jump.clampWhenFinished = true;
    jump.setLoop(THREE.LoopOnce, 1);
    if (prev) jump.crossFadeFrom(prev, 0.1, false);
    jump.play();

    // Si on a un rigidbody, on peut donner un petit impulse vertical
    const body = rigidBodyRef?.current;
    if (body) {
      const lv = body.linvel();
      // évite de re-sauter si déjà en montée
      if (lv.y < 0.1) body.applyImpulse({ x: 0, y: 3.8, z: 0 }, true);
    }
  }

  useFrame((_, dt) => {
    const k = keys.current;

    dt = Math.min(dt, 0.05);

    if (!group.current) return;

    const body = rigidBodyRef?.current ?? null;

    if (k.q) yawRef.current += rotationSpeed * dt;
    if (k.d) yawRef.current -= rotationSpeed * dt;

    if (body) {
      tmpEuler.set(0, yawRef.current, 0);
      tmpQuat.setFromEuler(tmpEuler);
      body.setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w }, true);
    } else {
      group.current.rotation.y = yawRef.current;
    }

    const spacePressed = k.space;
    if (ENABLE_JUMP && spacePressed && !wasSpacePressed.current) playJump();
    wasSpacePressed.current = spacePressed;

    let forward = 0;
    if (k.z) forward = -1; 
    if (k.s) forward = 1;

    const moving = forward !== 0;
    const running = moving && forward === -1 && k.shift;
    const targetSpeed = running ? runSpeed : moving ? walkSpeed : 0;
    currentSpeed.current +=
      (targetSpeed - currentSpeed.current) * (1 - Math.exp(-accel * dt));

    if (isJumping.current) {
      return;
    }

    if (moving) {
      const angle = yawRef.current;

      if (body) {
        const lv = body.linvel();
        const vx = -Math.sin(angle) * forward * currentSpeed.current;
        const vz = -Math.cos(angle) * forward * currentSpeed.current;
        body.setLinvel({ x: vx, y: lv.y, z: vz }, true);
      } else {
        group.current.position.x -= Math.sin(angle) * forward * currentSpeed.current * dt;
        group.current.position.z -= Math.cos(angle) * forward * currentSpeed.current * dt;
      }

      if (running) playRun();
      else playWalk();
    } else {
      if (body) {
        const lv = body.linvel();
        body.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
      }
      playIdle();
    }
  });

  return (
    <group ref={attachRefs} dispose={null}>
      <primitive object={gltf.scene} />
    </group>
  );
}

useGLTF.preload("/models/model.glb");
