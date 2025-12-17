import { AnimationClip, Euler, Quaternion, Vector3 } from "three";

export function fixMixamoClip(clip: AnimationClip) {
  // Corrige l'offset de rotation Mixamo (souvent -90° en X)
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

export function removeRootMotionXZ(clip: AnimationClip) {
  // Neutralise le déplacement X/Z contenu dans l'anim (root motion)
  for (const track of clip.tracks) {
    if (/Hips\.position$/.test(track.name)) {
      const values = track.values as Float32Array;

      const baseX = values[0];
      const baseZ = values[2];

      for (let i = 0; i < values.length; i += 3) {
        values[i + 0] = baseX;
        values[i + 2] = baseZ;
      }
    }
  }

  clip.resetDuration();
  return clip;
}

export function computeClipSpeedFromRootMotion(clip: AnimationClip) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return 1.5;

  const values = track.values as Float32Array;
  if (values.length < 6) return 1.5;

  const x0 = values[0];
  const z0 = values[2];
  const x1 = values[values.length - 3];
  const z1 = values[values.length - 1];

  const dist = Math.hypot(x1 - x0, z1 - z0);
  const duration = clip.duration || 1;
  return dist / duration;
}
