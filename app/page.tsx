"use client";

import React, { useState } from "react";
import Scene from "@/src/components/Scene";

type PlayerXZ = { x: number; z: number };

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function MiniMap({ pos, mapSize = 50 }: { pos: PlayerXZ; mapSize?: number }) {
  const half = mapSize / 2;
  const xNorm = clamp(pos.x / half, -1, 1);
  const zNorm = clamp(pos.z / half, -1, 1);

  const radiusPx = 60; // inner usable radius (fits .mwz-minimapInner)
  const xPx = xNorm * radiusPx;
  const yPx = -zNorm * radiusPx;

  // clamp to circle
  const len = Math.hypot(xPx, yPx);
  const maxLen = radiusPx;
  const k = len > maxLen ? maxLen / len : 1;

  const left = 80 + xPx * k;
  const top = 80 + yPx * k;

  return (
    <div className="mwz-minimap" aria-hidden>
      <div className="mwz-minimapInner" />
      <div className="mwz-minimapCross" />

      <div className="mwz-minimapLabel mwz-minimapLabelNW">Zone NW</div>
      <div className="mwz-minimapLabel mwz-minimapLabelNE">Zone NE</div>
      <div className="mwz-minimapLabel mwz-minimapLabelSW">Zone SW</div>
      <div className="mwz-minimapLabel mwz-minimapLabelSE">Zone SE</div>

      <div
        className="mwz-playerDot"
        style={{ left: left - 3, top: top - 3 }}
      />
    </div>
  );
}

export default function Page() {
  const [started, setStarted] = useState(false);
  const [playerPos, setPlayerPos] = useState<PlayerXZ>({ x: 0, z: 0 });

  return (
    <main className="mwz-root">
      <Scene
        started={started}
        onPlayerPosition={(p) => setPlayerPos({ x: p.x, z: p.z })}
      />

      {/* vignette: noir sur les bords, centre transparent */}
      <div className="mwz-vignette" />

      {/* UI jeu */}
      {!started ? (
        <div className="mwz-ui" aria-hidden>
          <div className="mwz-title">
            <div>the world of matzo</div>
            <strong>THE WORLD OF MATZO</strong>
          </div>

          <div className="mwz-hud">
            <div className="mwz-hudBox">
              <div style={{ opacity: 0.9, marginBottom: 6 }}>HUD</div>
              <div>Déplacement: ZQSD (WASD)</div>
              <div>Courir: Shift</div>
            </div>
          </div>

          <div className="mwz-foot">
            <div className="mwz-footBox">
              <div style={{ opacity: 0.95, marginBottom: 6 }}>Projet</div>
              <div>
                Une petite exploration 3D expérimentale: un personnage, une ambiance sombre, et un monde
                minimal.
              </div>
              <div style={{ opacity: 0.85 }}>Fais “Start” et avance doucement.</div>
            </div>
          </div>
        </div>
      ) : null}

      {!started ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "radial-gradient(circle at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.25) 42%, rgba(0,0,0,0.75) 75%, rgba(0,0,0,0.92) 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
        >
          <button
            type="button"
            onClick={() => setStarted(true)}
            style={{
              fontSize: 24,
              letterSpacing: 2,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.5)",
              padding: "14px 22px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            Start
          </button>
        </div>
      ) : null}

      <MiniMap pos={playerPos} mapSize={50} />
    </main>
  );
}
